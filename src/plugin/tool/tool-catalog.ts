import type {
  AvailableCategory,
} from "../../agents/shared/dynamic-agent-prompt-builder"
import type { MatrixxConfig } from "../../config"
import { loadKnowledgeHubs } from "../../features/knowledge-hub/loader"
import { resolvePlanCap } from "../../features/mission-state/constants"
import { isTaskSystemEnabled } from "../../shared/config/task-system-gating"
import { log } from "../../shared/runtime/logger"
import type { NativePluginContext } from "../../shared/session/session-context-source"
import type { MatrixxToolDefinition } from "../../shared/tool/define-tool"
import { filterDisabledTools } from "../../shared/tool/disabled-tools"
import { type BuiltinSkill, createBuiltinSkills } from "../../skills"
import {
  CORE_PACK_ID,
  type InstalledPackSkill,
  loadInstalledPacks,
  resolveCorePackRoot,
  resolvePacksRoot,
} from "../../skills/packs"
import {
  builtinTools,
  createAssemblyTool,
  createAstGrepTools,
  createBddCreateContractTool,
  createBddParseGherkinTool,
  createBddPipelineTool,
  createBddValidateContractTool,
  createCommentScanTool,
  createDashboardFluxValidatorTool,
  createGithubSearchTools,
  createGlobTools,
  createGrepTools,
  createHandoffTools,
  createHashlineEditTool,
  createKnowledgeHubConfirmTool,
  createLookAt,
  createMarketSymbolValidatorTool,
  createNotepadAppendTool,
  createNotepadCreateTool,
  createNotepadListTool,
  createNotepadReadTool,
  createPdfExtractFiguresTool,
  createPlanCreateTool,
  createPlanDeleteTool,
  createPlanListTool,
  createPlanReadTool,
  createPlanUpdateTool,
  createPresetTool,
  createRemovedToolGuard,
  createSessionCleanupTool,

  createSessionManagerTools,
  createSilentFailureScannerTool,
  createSkillTool,
  createSlashcommandTool,
  createStalenessGapCheckerTool,
  createSubagentControl,
  createTaskCleanupTool,
  createTaskCreateTool,
  createTaskGetTool,
  createTaskList,
  createTaskUpdateTool,
  createUiuxTools,
  discoverCommandsSync,
  interactive_bash,
  REMOVED_TOOL_NAMES,
} from "../../tools"
import { createPlanTasksTool } from "../../tools/plan"
import { resolvePythonBin, UIUX_MAX_STDOUT_BYTES, UIUX_TIMEOUT_MS } from "../../tools/uiux"
import type { ToolsRecord } from "./context"
import type { SkillContext } from "./skill-context"
import {
  isConstructAgentEnabled,
  shouldEnableBddTools,
  shouldEnableKnowledgeHubConfirm,
  shouldEnableLookAt,
  shouldEnablePdfFigures,
  shouldEnablePresetTools,
  shouldEnableSessionCleanup,
  shouldEnableUiUxTools,
} from "./tool-policy"

export type ToolCatalogResult = {
  filteredTools: ToolsRecord
  taskSystemEnabled: boolean
}

export function createToolCatalog(args: {
  ctx: NativePluginContext
  pluginConfig: MatrixxConfig
  skillContext: SkillContext
  availableCategories: AvailableCategory[]
  systemDefaultModel?: () => Promise<string | undefined>
}): ToolCatalogResult {
  const { ctx, pluginConfig, skillContext } = args

  const removedToolGuards: Record<string, MatrixxToolDefinition> = Object.fromEntries(
    REMOVED_TOOL_NAMES.map((name) => [name, createRemovedToolGuard(name)]),
  )

  const isMultimodalLookerEnabled = isConstructAgentEnabled(pluginConfig.disabled_agents)
  const toolGating = pluginConfig.tool_gating
  const bddEnabled = shouldEnableBddTools(ctx.directory, toolGating?.bdd_tools)
  const pdfFiguresEnabled = shouldEnablePdfFigures(ctx.directory, toolGating?.pdf_figures)
  const lookAtEnabled = shouldEnableLookAt(ctx.directory, isMultimodalLookerEnabled, toolGating?.look_at)
  const knowledgeHubConfirmEnabled = shouldEnableKnowledgeHubConfirm(pluginConfig.knowledge?.hubs)
  const presetToolsEnabled = shouldEnablePresetTools(toolGating?.preset_tools)
  const lookAt = lookAtEnabled ? createLookAt(ctx) : null
  const bddToolsRecord: Record<string, MatrixxToolDefinition> = bddEnabled
    ? {
        bdd_create_contract: createBddCreateContractTool(),
        bdd_parse_gherkin: createBddParseGherkinTool(),
        bdd_pipeline_run: createBddPipelineTool({ client: ctx }),
        bdd_validate_contract: createBddValidateContractTool(),
      }
    : {}
  const pdfFiguresRecord: Record<string, MatrixxToolDefinition> = pdfFiguresEnabled
    ? { ...createPdfExtractFiguresTool() }
    : {}
  const presetRecord: Record<string, MatrixxToolDefinition> = presetToolsEnabled
    ? { ...createPresetTool({ pluginConfig, directory: ctx.directory }) }
    : {}
  const sessionCleanupRecord: Record<string, MatrixxToolDefinition> = shouldEnableSessionCleanup(
    toolGating?.session_cleanup,
  )
    ? { session_cleanup: createSessionCleanupTool(ctx) }
    : {}

  const skillPacksConfig = pluginConfig.skill_packs

  const uiuxToolsRecord: Record<string, MatrixxToolDefinition> = (() => {
    let coreSkillRoot: string | undefined
    try {
      coreSkillRoot =
        skillPacksConfig?.enabled === false
          ? undefined
          : resolveCorePackRoot(CORE_PACK_ID, skillPacksConfig?.root)
    } catch (error) {
      log("[matrixx] uiux tools unavailable: failed to resolve the core pack root", { error })
      return {}
    }
    if (!shouldEnableUiUxTools(coreSkillRoot, toolGating?.uiux_tools)) return {}
    if (!coreSkillRoot) {
      log("[matrixx] uiux tools unavailable: ui-ux-pro-max is not installed")
      return {}
    }
    try {
      return {
        ...createUiuxTools({
          coreSkillRoot,
          pythonBin: resolvePythonBin(skillPacksConfig) ?? "python3",
          timeoutMs: skillPacksConfig?.timeout_ms ?? UIUX_TIMEOUT_MS,
          maxStdoutBytes: skillPacksConfig?.max_stdout_bytes ?? UIUX_MAX_STDOUT_BYTES,
        }),
      }
    } catch (error) {
      log("[matrixx] uiux tools unavailable: failed to create the uiux tools", { error })
      return {}
    }
  })()

  const loadPackSkills = (): InstalledPackSkill[] => {
    if (skillPacksConfig?.enabled === false) return []
    try {
      return loadInstalledPacks({
        root: resolvePacksRoot({ root: skillPacksConfig?.root }),
        disabledPacks: skillPacksConfig?.disabled_packs,
        disabledSkills: skillPacksConfig?.disabled_skills,
      })
    } catch (error) {
      log("skill packs: failed to load installed packs", { error })
      return []
    }
  }

  const packSkills = loadPackSkills()

  const refreshSkills = (): BuiltinSkill[] => {
    try {
      return [
        ...createBuiltinSkills({ disabledSkills: skillContext.disabledSkills }),
        ...loadPackSkills(),
      ]
    } catch (error) {
      log("skill packs: refresh fell back to builtin skills", { error })
      return createBuiltinSkills({ disabledSkills: skillContext.disabledSkills })
    }
  }

  const skillTool = packSkills.length > 0
    ? createSkillTool({
        skills: [...skillContext.builtinSkills, ...packSkills],
        disabledSkills: skillContext.disabledSkills,
        refresh: refreshSkills,
      })
    : createSkillTool({
        skills: skillContext.builtinSkills,
        disabledSkills: skillContext.disabledSkills,
      })

  const commands = discoverCommandsSync(ctx.directory)
  const slashcommandTool = createSlashcommandTool({
    commands,
    skills: skillContext.builtinSkills,
  })

  const taskSystemEnabled = isTaskSystemEnabled(pluginConfig)
  const taskToolsRecord: Record<string, MatrixxToolDefinition> = taskSystemEnabled
    ? {
        task_create: createTaskCreateTool(pluginConfig, ctx),
        task_get: createTaskGetTool(pluginConfig, ctx),
        task_list: createTaskList(pluginConfig, ctx),
        task_update: createTaskUpdateTool(pluginConfig, ctx),
        task_cleanup: createTaskCleanupTool(pluginConfig, ctx),
      }
    : {}
  const hashlineEnabled = pluginConfig.experimental?.hashline_edit ?? false
  const hashlineToolsRecord: Record<string, MatrixxToolDefinition> = hashlineEnabled
    ? { edit: createHashlineEditTool() }
    : {}

  const planCap = resolvePlanCap(pluginConfig)
  const planToolsRecord: Record<string, MatrixxToolDefinition> = {
    plan_create: createPlanCreateTool(ctx, planCap),
    plan_read: createPlanReadTool(ctx, planCap),
    plan_list: createPlanListTool(ctx, planCap),
    plan_update: createPlanUpdateTool(ctx, undefined, planCap),
    plan_delete: createPlanDeleteTool(ctx),
    plan_tasks: createPlanTasksTool(ctx, planCap),
  }

  const notepadToolsRecord: Record<string, MatrixxToolDefinition> = {
    notepad_create: createNotepadCreateTool(ctx),
    notepad_read: createNotepadReadTool(ctx),
    notepad_append: createNotepadAppendTool(ctx),
    notepad_list: createNotepadListTool(ctx),
  }

  const assemblyEnabled = pluginConfig.assembly?.enabled !== false
  const assemblyTool = assemblyEnabled
    ? createAssemblyTool({
        client: ctx,
        pluginConfig,
      })
    : null

  const allTools: Record<string, MatrixxToolDefinition> = {
    ...builtinTools,
    ...createGrepTools(ctx),
    ...createGithubSearchTools(ctx),
    ...createGlobTools(ctx),
    ...createAstGrepTools(ctx),
    ...createCommentScanTool(ctx),
    ...createDashboardFluxValidatorTool(ctx),
    ...createMarketSymbolValidatorTool(ctx),
    ...createSilentFailureScannerTool(ctx),
    ...createStalenessGapCheckerTool(ctx),
    ...createSessionManagerTools(ctx, pluginConfig),
    ...createHandoffTools(ctx),
    ...(knowledgeHubConfirmEnabled
      ? {
          knowledge_hub_confirm: createKnowledgeHubConfirmTool(ctx, {
            getHubs: () => loadKnowledgeHubs(pluginConfig.knowledge ?? { hubs: [] }, ctx.directory),
          }),
        }
      : {}),
    ...pdfFiguresRecord,
    ...presetRecord,
    ...sessionCleanupRecord,
    ...uiuxToolsRecord,
    ...removedToolGuards,
    subagent_control: createSubagentControl(ctx),
    ...(lookAt ? { look_at: lookAt } : {}),
    skill: skillTool,
    slashcommand: slashcommandTool,
    interactive_bash,
    ...taskToolsRecord,
    ...hashlineToolsRecord,
    ...planToolsRecord,
    ...notepadToolsRecord,
    ...(assemblyTool ? { assembly: assemblyTool } : {}),
    ...bddToolsRecord,
  }

  const filteredTools = filterDisabledTools(allTools, pluginConfig.disabled_tools)

  return {
    filteredTools,
    taskSystemEnabled,
  }
}
