import type {
  AvailableCategory,
  AvailableSkill,
} from "../../agents/shared/dynamic-agent-prompt-builder"
import type { MatrixxConfig } from "../../config"
import type { BrowserAutomationProvider } from "../../config/schema/browser-automation"
import { resolveTasksConfig } from "../../shared/config/task-system-gating"
import type { NativePluginContext } from "../../shared/session/session-context-source"
import type { BuiltinSkill } from "../../skills"
import { setPollTimeoutMs } from "../../tools/delegate-task/timing"
import { createAvailableCategories } from "../tool/available-categories"
import type { ToolsRecord } from "../tool/context"
import { createSkillContext } from "../tool/skill-context"
import { createToolCatalog } from "../tool/tool-catalog"
import type { DomainManagers } from "./managers"

export type SetupToolsDomainResult = {
  filteredTools: ToolsRecord
  builtinSkills: BuiltinSkill[]
  availableSkills: AvailableSkill[]
  availableCategories: AvailableCategory[]
  browserProvider: BrowserAutomationProvider
  disabledSkills: Set<string>
  taskSystemEnabled: boolean
}

/** Tool domain: skill context, categories, and the filtered tool registry. */
export async function setupToolsDomain(args: {
  ctx: NativePluginContext
  pluginConfig: MatrixxConfig
  managers: Pick<DomainManagers, "backgroundManager">
  systemDefaultModel?: () => Promise<string | undefined>
}): Promise<SetupToolsDomainResult> {
  const { ctx, pluginConfig, managers, systemDefaultModel } = args

  const pollTimeout = resolveTasksConfig(pluginConfig).pollTimeoutMs
  if (pollTimeout !== undefined) {
    setPollTimeoutMs(pollTimeout)
  }

  const skillContext = await createSkillContext({
    directory: ctx.directory,
    pluginConfig,
  })

  const availableCategories = createAvailableCategories(pluginConfig)

  const { filteredTools, taskSystemEnabled } = createToolCatalog({
    ctx,
    pluginConfig,
    managers,
    skillContext,
    availableCategories,
    systemDefaultModel,
  })

  return {
    filteredTools,
    builtinSkills: skillContext.builtinSkills,
    availableSkills: skillContext.availableSkills,
    availableCategories,
    browserProvider: skillContext.browserProvider,
    disabledSkills: skillContext.disabledSkills,
    taskSystemEnabled,
  }
}

