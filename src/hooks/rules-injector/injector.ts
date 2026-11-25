import { readFileSync, watch } from "node:fs";
import { relative, resolve } from "node:path";
import { log } from "../../shared/runtime/logger";
import type { SessionInjectedRulesCache } from "./cache";
import {
  clearRuleDiscoveryCache,
  findProjectRoot,
  findRuleFiles,
  invalidateRuleDiscoveryCacheForPath,
} from "./finder";
import {
  createContentHash,
  isDuplicateByContentHash,
  isDuplicateByRealPath,
  shouldApplyRule,
} from "./matcher";
import { parseRuleFrontmatter } from "./parser";
import { saveInjectedRules } from "./storage";
import type { RuleMetadata } from "./types";

type ToolExecuteOutput = {
  title: string;
  output: string;
  metadata: unknown;
};

type RuleToInject = {
  relativePath: string;
  matchReason: string;
  content: string;
  distance: number;
};

type DynamicTruncator = {
  truncate: (
    sessionID: string,
    content: string
  ) => Promise<{ result: string; truncated: boolean }>;
};

interface ParsedRuleEntry {
  metadata: RuleMetadata;
  body: string;
}

/**
 * Cache key: `${realPath}\0${cwd}`.
 * - `realPath`: file identity (handles symlinks)
 * - `cwd`: scopes the cache per workspace
 *
 * A hit is served without any filesystem call. Invalidation is watcher-driven
 * (`setupRuleWatcher`): the debounced watcher callback evicts the entry, so the
 * next read re-parses. This replaces the previous mtime/size `statSync` on
 * every hit, which dominated the hot edit loop while the watcher already owned
 * the invalidation signal.
 */
const parsedRuleCache = new Map<string, ParsedRuleEntry>();

const RULE_WATCHER_DEBOUNCE_MS = 1000;
const ruleWatchers = new Map<string, ReturnType<typeof watch>>();
const ruleWatcherDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

function makeRuleCacheKey(realPath: string, cwd: string): string {
  return `${realPath}\0${cwd}`;
}

function invalidateRuleCacheForPath(realPath: string): void {
  const prefix = `${realPath}\0`;
  for (const key of parsedRuleCache.keys()) {
    if (key.startsWith(prefix)) {
      parsedRuleCache.delete(key);
    }
  }
  invalidateRuleDiscoveryCacheForPath(realPath);
}

function setupRuleWatcher(realPath: string): void {
  if (ruleWatchers.has(realPath)) return;
  try {
    const watcher = watch(realPath, () => {
      const existing = ruleWatcherDebounceTimers.get(realPath);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        ruleWatcherDebounceTimers.delete(realPath);
        invalidateRuleCacheForPath(realPath);
      }, RULE_WATCHER_DEBOUNCE_MS);
      if (typeof (timer as { unref?: () => void }).unref === "function") {
        (timer as { unref?: () => void }).unref?.();
      }
      ruleWatcherDebounceTimers.set(realPath, timer);
    });
    watcher.on("error", () => {
      ruleWatchers.delete(realPath);
    });
    ruleWatchers.set(realPath, watcher);
  } catch {
    // fs.watch unavailable (e.g., WSL, restricted fs): entries stay cached
    // until `_resetRuleCacheForTesting` or process restart; no stat fallback.
  }
}

function getCachedParsedRule(
  filePath: string,
  realPath: string,
  cwd: string
): { metadata: RuleMetadata; body: string } {
  const key = makeRuleCacheKey(realPath, cwd);
  const cached = parsedRuleCache.get(key);
  if (cached) return cached;

  const rawContent = readFileSync(filePath, "utf-8");
  const { metadata, body } = parseRuleFrontmatter(rawContent);
  parsedRuleCache.set(key, { metadata, body });
  setupRuleWatcher(realPath);
  return { metadata, body };
}

export function _resetRuleCacheForTesting(): void {
  parsedRuleCache.clear();
  clearRuleDiscoveryCache();
  for (const watcher of ruleWatchers.values()) {
    try {
      watcher.close();
    } catch {
      // watcher may already be closed or never fully opened
    }
  }
  ruleWatchers.clear();
  for (const timer of ruleWatcherDebounceTimers.values()) {
    clearTimeout(timer);
  }
  ruleWatcherDebounceTimers.clear();
}

function resolveFilePath(
  workspaceDirectory: string,
  path: string
): string | null {
  if (!path) return null;
  if (path.startsWith("/")) return path;
  return resolve(workspaceDirectory, path);
}

export function createRuleInjectionProcessor(deps: {
  workspaceDirectory: string;
  truncator: DynamicTruncator;
  getSessionCache: (sessionID: string) => SessionInjectedRulesCache;
}): {
  processFilePathForInjection: (
    filePath: string,
    sessionID: string,
    output: ToolExecuteOutput
  ) => Promise<void>;
} {
  const { workspaceDirectory, truncator, getSessionCache } = deps;

  async function processFilePathForInjection(
    filePath: string,
    sessionID: string,
    output: ToolExecuteOutput
  ): Promise<void> {
    const resolved = resolveFilePath(workspaceDirectory, filePath);
    if (!resolved) return;

    const projectRoot = findProjectRoot(resolved);
    const cache = getSessionCache(sessionID);

    const ruleFileCandidates = findRuleFiles(projectRoot, resolved);
    const toInject: RuleToInject[] = [];
    let dirty = false;

    for (const candidate of ruleFileCandidates) {
      if (isDuplicateByRealPath(candidate.realPath, cache.realPaths)) continue;

      try {
        const { metadata, body } = getCachedParsedRule(
          candidate.path,
          candidate.realPath,
          workspaceDirectory
        );

        let matchReason: string;
        if (candidate.isSingleFile) {
          matchReason = "copilot-instructions (always apply)";
        } else {
          const matchResult = shouldApplyRule(metadata, resolved, projectRoot);
          if (!matchResult.applies) continue;
          matchReason = matchResult.reason ?? "matched";
        }

        const contentHash = createContentHash(body);
        if (isDuplicateByContentHash(contentHash, cache.contentHashes)) continue;

        const relativePath = projectRoot
          ? relative(projectRoot, candidate.path)
          : candidate.path;

        toInject.push({
          relativePath,
          matchReason,
          content: body,
          distance: candidate.distance,
        });

        cache.realPaths.add(candidate.realPath);
        cache.contentHashes.add(contentHash);
        dirty = true;
      } catch (error) {
        log("rules-injector: failed to process rule candidate", {
          path: candidate.path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (toInject.length === 0) return;

    toInject.sort((a, b) => a.distance - b.distance);

    for (const rule of toInject) {
      const { result, truncated } = await truncator.truncate(
        sessionID,
        rule.content
      );
      const truncationNotice = truncated
        ? `\n\n[Note: Content was truncated to save context window space. For full context, please read the file directly: ${rule.relativePath}]`
        : "";
      output.output += `\n\n[Rule: ${rule.relativePath}]\n[Match: ${rule.matchReason}]\n${result}${truncationNotice}`;
    }

    if (dirty) {
      saveInjectedRules(sessionID, cache);
    }
  }

  return { processFilePathForInjection };
}
