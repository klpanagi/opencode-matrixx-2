import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { MatrixxContext } from "../../plugin/context";

import type { createDynamicTruncator } from "../../shared/dynamic-truncator";
import { notifyInjection } from "../../shared/injection-notifier";
import { findAgentsMdUp, resolveFilePath } from "./finder";
import { loadInjectedPaths, saveInjectedPaths } from "./storage";

type DynamicTruncator = ReturnType<typeof createDynamicTruncator>;

function hashSnippet(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}

function getSessionCache(
  sessionCaches: Map<string, Set<string>>,
  sessionID: string,
): Set<string> {
  if (!sessionCaches.has(sessionID)) {
    sessionCaches.set(sessionID, loadInjectedPaths(sessionID));
  }
  return sessionCaches.get(sessionID) as Set<string>;
}

export async function processFilePathForAgentsInjection(input: {
  ctx: MatrixxContext;
  truncator: DynamicTruncator;
  sessionCaches: Map<string, Set<string>>;
  filePath: string;
  sessionID: string;
  output: { title: string; output: string; metadata: unknown };
}): Promise<void> {
  const resolved = resolveFilePath(input.ctx.directory, input.filePath);
  if (!resolved) return;

  const dir = dirname(resolved);
  const cache = getSessionCache(input.sessionCaches, input.sessionID);
  const agentsPaths = await findAgentsMdUp({ startDir: dir, rootDir: input.ctx.directory });

  let dirty = false;
  const injected: string[] = [];
  for (const agentsPath of agentsPaths) {
    const agentsDir = dirname(agentsPath);
    if (cache.has(agentsDir)) continue;

    try {
      const content = await readFile(agentsPath, "utf-8");
      const { result, truncated } = await input.truncator.truncate(
        input.sessionID,
        content,
      );
      const truncationNotice = truncated
        ? `\n\n[Note: Content was truncated to save context window space. For full context, please read the file directly: ${agentsPath}]`
        : "";
      input.output.output += `\n\n[Directory Context: ${agentsPath}]\n${result}${truncationNotice}`;
      cache.add(agentsDir);
      injected.push(agentsPath);
      dirty = true;
    } catch {}
  }

  if (dirty) {
    saveInjectedPaths(input.sessionID, cache);
    await notifyInjection(input.ctx, {
      sessionID: input.sessionID,
      injector: "directory-agents-injector",
      hash: hashSnippet(injected.join("|")),
      title: "Context injection",
      message: "Project guidance applied",
    });
  }
}
