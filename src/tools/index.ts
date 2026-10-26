import {
  lsp_diagnostics,
  lsp_find_references,
  lsp_goto_definition,
  lsp_prepare_rename,
  lsp_rename,
  lsp_symbols,
  lspManager,
} from "./lsp"

export { createAstGrepTools } from "./ast-grep"
export { createBddCreateContractTool } from "./bdd-create-contract"
export { createBddParseGherkinTool } from "./bdd-parse-gherkin"
export { createBddPipelineTool } from "./bdd-pipeline"
export { createBddValidateContractTool } from "./bdd-validate-contract/tools"
export { createDashboardFluxValidatorTool } from "./dashboard-flux-validator"
export { createEvolutionTool } from "./evolution"
export { createGithubSearchTools } from "./github-search/tools"
export { createGlobTools } from "./glob/tools"
export { createGrepTools } from "./grep/tools"
export { createHandoffTools } from "./handoff"
export { interactive_bash, startBackgroundCheck as startTmuxCheck } from "./interactive-bash"
export { createKnowledgeHubConfirmTool } from "./knowledge-hub-confirm/tools"
export { createMarketSymbolValidatorTool } from "./market-symbol-validator"
export { createPdfExtractFiguresTool } from "./pdf-extract-figures/tools"
export { createPlanCreateTool } from "./plan/plan-create"
export { createPlanDeleteTool } from "./plan/plan-delete"
export { createPlanListTool } from "./plan/plan-list"
export { createPlanReadTool } from "./plan/plan-read"
export { createPlanUpdateTool } from "./plan/plan-update"
export { createPresetTool } from "./preset/tools"
export { createSessionCleanupTool } from "./session-cleanup"
export { createSessionManagerTools } from "./session-manager"
export { sessionExists } from "./session-manager/storage"
export { createSilentFailureScannerTool } from "./silent-failure-scanner"
export { createSkillTool } from "./skill"
export { createSlashcommandTool, discoverCommandsSync } from "./slashcommand"
export { createStalenessGapCheckerTool } from "./staleness-gap-checker"
export { lspManager }

import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../features/background-agent"
import {
  type BackgroundCancelClient,
  type BackgroundOutputManager,
  createBackgroundCancel,
  createBackgroundOutput,
  createBackgroundRevive,
  createBackgroundWaitAll,
} from "./background-task"

type OpencodeClient = PluginInput["client"]

export { createAssemblyTool } from "./assembly"
export { createDelegateTask } from "./delegate-task"
export { createHashlineEditTool } from "./hashline-edit"
export { createLookAt } from "./look-at"
export {
  createTaskCleanupTool,
  createTaskCreateTool,
  createTaskGetTool,
  createTaskList,
  createTaskUpdateTool,
} from "./task"

export function createBackgroundTools(
  manager: BackgroundManager,
  client: OpencodeClient,
  directory: string,
): Record<string, ToolDefinition> {
  const outputManager: BackgroundOutputManager = manager
  const cancelClient: BackgroundCancelClient = client
  return {
    background_output: createBackgroundOutput(outputManager, client),
    background_cancel: createBackgroundCancel(manager, cancelClient),
    background_revive: createBackgroundRevive(manager, directory),
    background_wait_all: createBackgroundWaitAll(manager),
  }
}

export const builtinTools: Record<string, ToolDefinition> = {
  lsp_goto_definition,
  lsp_find_references,
  lsp_symbols,
  lsp_diagnostics,
  lsp_prepare_rename,
  lsp_rename,
}
