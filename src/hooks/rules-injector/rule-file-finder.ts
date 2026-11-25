import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  PROJECT_RULE_FILES,
  PROJECT_RULE_SUBDIRS,
} from "./constants";
import { findRuleFilesRecursive, safeRealpathSync } from "./rule-file-scanner";
import type { RuleFileCandidate } from "./types";

const discoveryCache = new Map<string, RuleFileCandidate[]>();
const MAX_DISCOVERY_CACHE_ENTRIES = 256;

function makeDiscoveryCacheKey(
  projectRoot: string | null,
  currentFile: string
): string {
  return `${projectRoot ?? ""}\0${currentFile}`;
}

export function clearRuleDiscoveryCache(): void {
  discoveryCache.clear();
}

export function invalidateRuleDiscoveryCacheForPath(realPath: string): void {
  for (const [key, candidates] of discoveryCache) {
    if (candidates.some((candidate) => candidate.realPath === realPath)) {
      discoveryCache.delete(key);
    }
  }
}

/**
 * Find all rule files for a given context.
 * Searches from currentFile upward to projectRoot for rule directories.
 *
 * Results are cached per `(projectRoot, currentFile)`; the rule-file watcher in
 * `injector.ts` invalidates them via `invalidateRuleDiscoveryCacheForPath`.
 * A rule file created after the first walk is picked up only after that
 * watcher signal, an explicit `clearRuleDiscoveryCache`, or LRU eviction.
 *
 * IMPORTANT: This searches EVERY directory from file to project root.
 * Not just the project root itself.
 *
 * @param projectRoot - Project root path (or null if outside any project)
 * @param currentFile - Current file being edited (for distance calculation)
 * @returns Array of rule file candidates sorted by distance
 */
export function findRuleFiles(
  projectRoot: string | null,
  currentFile: string,
): RuleFileCandidate[] {
  const cacheKey = makeDiscoveryCacheKey(projectRoot, currentFile);
  const cached = discoveryCache.get(cacheKey);
  if (cached) return cached;

  const candidates: RuleFileCandidate[] = [];
  const seenRealPaths = new Set<string>();

  // Search from current file's directory up to project root
  let currentDir = dirname(currentFile);
  let distance = 0;

  while (true) {
    // Search rule directories in current directory
    for (const [parent, subdir] of PROJECT_RULE_SUBDIRS) {
      const ruleDir = join(currentDir, parent, subdir);
      const files: string[] = [];
      findRuleFilesRecursive(ruleDir, files);

      for (const filePath of files) {
        const realPath = safeRealpathSync(filePath);
        if (seenRealPaths.has(realPath)) continue;
        seenRealPaths.add(realPath);

        candidates.push({
          path: filePath,
          realPath,
          isGlobal: false,
          distance,
        });
      }
    }

    // Stop at project root or filesystem root
    if (projectRoot && currentDir === projectRoot) break;
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
    distance++;
  }

  // Check for single-file rules at project root (e.g., .github/copilot-instructions.md)
  if (projectRoot) {
    for (const ruleFile of PROJECT_RULE_FILES) {
      const filePath = join(projectRoot, ruleFile);
      if (existsSync(filePath)) {
        try {
          const stat = statSync(filePath);
          if (stat.isFile()) {
            const realPath = safeRealpathSync(filePath);
            if (!seenRealPaths.has(realPath)) {
              seenRealPaths.add(realPath);
              candidates.push({
                path: filePath,
                realPath,
                isGlobal: false,
                distance: 0,
                isSingleFile: true,
              });
            }
          }
        } catch {
          // Skip if file can't be read
        }
      }
    }
  }


  // Sort by distance (closest first, then global rules last)
  candidates.sort((a, b) => {
    if (a.isGlobal !== b.isGlobal) {
      return a.isGlobal ? 1 : -1;
    }
    return a.distance - b.distance;
  });

  discoveryCache.set(cacheKey, candidates);
  if (discoveryCache.size > MAX_DISCOVERY_CACHE_ENTRIES) {
    const oldestKey = discoveryCache.keys().next().value;
    if (oldestKey !== undefined) {
      discoveryCache.delete(oldestKey);
    }
  }

  return candidates;
}
