import type { MatrixxConfig } from "../../config"
import type { KnowledgeHubInjectorDeps } from "../../plugin/message-hooks/knowledge-hub-injector"
import type { ContextCollector } from "../context-injection/injector"
import { loadKnowledgeHubs } from "./loader"

export interface BuildKnowledgeHubDepsOptions {
  hookEnabled: boolean
  collector?: ContextCollector
}

/**
 * Build the native injector deps from the real plugin config.
 *
 * Returns `undefined` when the hook is disabled or when no hub is
 * configured. The gate reads the configured hub count, never the disk:
 * hubs are loaded lazily on every injection so an index that appears
 * later still routes.
 */
export function buildKnowledgeHubDeps(
  pluginConfig: MatrixxConfig | undefined,
  projectDir: string,
  opts: BuildKnowledgeHubDepsOptions,
): KnowledgeHubInjectorDeps | undefined {
  if (!opts.hookEnabled) return undefined
  const knowledge = pluginConfig?.knowledge
  if ((knowledge?.hubs ?? []).length === 0) return undefined
  return {
    getHubs: () => loadKnowledgeHubs(knowledge ?? { hubs: [] }, projectDir),
    workspaceDir: projectDir,
    collector: opts.collector,
  }
}
