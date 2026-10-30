import {
  lsp_diagnostics,
  lsp_find_references,
  lsp_goto_definition,
  lsp_prepare_rename,
  lsp_rename,
  lsp_symbols,
  lspManager,
} from "./lsp"

export { createAstGrepTools } from "./ast-grep/tools"
export { createBddCreateContractTool } from "./bdd-create-contract/tools"
export { createBddParseGherkinTool } from "./bdd-parse-gherkin/tools"
export { createBddPipelineTool } from "./bdd-pipeline/tools"
export { createBddValidateContractTool } from "./bdd-validate-contract/tools"
export { createDashboardFluxValidatorTool } from "./dashboard-flux-validator/tools"
export { createEvolutionTool } from "./evolution"
export { createGithubSearchTools } from "./github-search/tools"
export { createGlobTools } from "./glob/tools"
export { createGrepTools } from "./grep/tools"
export { createHandoffTools } from "./handoff/tools"
export { interactive_bash, startBackgroundCheck as startTmuxCheck } from "./interactive-bash"
export { createKnowledgeHubConfirmTool } from "./knowledge-hub-confirm/tools"
export { createMarketSymbolValidatorTool } from "./market-symbol-validator/tools"
export {
  createNotepadAppendTool,
  createNotepadCreateTool,
  createNotepadListTool,
  createNotepadReadTool,
} from "./notepad"
export { createPdfExtractFiguresTool } from "./pdf-extract-figures/tools"
export { createPlanCreateTool } from "./plan/plan-create"
export { createPlanDeleteTool } from "./plan/plan-delete"
export { createPlanListTool } from "./plan/plan-list"
export { createPlanReadTool } from "./plan/plan-read"
export { createPlanUpdateTool } from "./plan/plan-update"
export { createPresetTool } from "./preset/tools"
export { createSessionCleanupTool } from "./session-cleanup"
export { sessionExists } from "./session-manager/storage"
export { createSessionManagerTools } from "./session-manager/tools"
export { createSilentFailureScannerTool } from "./silent-failure-scanner"
export { createSkillTool } from "./skill/tools"
export { createSlashcommandTool, discoverCommandsSync } from "./slashcommand/tools"
export { createStalenessGapCheckerTool } from "./staleness-gap-checker"
export { lspManager }

import type { BackgroundManager } from "../features/background-agent"
import type { SessionContextCarrier } from "../shared/session-context-source"
import {
  type BackgroundOutputManager,
  createBackgroundCancel,
  createBackgroundOutput,
  createBackgroundRevive,
  createBackgroundWaitAll,
} from "./background-task"
import type { MatrixxToolDefinition } from "./shared/define-tool"

export { createAssemblyTool } from "./assembly/tools"
export { createDelegateTask, resolveSystemDefaultModel } from "./delegate-task"
export { createHashlineEditTool } from "./hashline-edit"
export { createLookAt } from "./look-at/tools"
export {
  createTaskCleanupTool,
  createTaskCreateTool,
  createTaskGetTool,
  createTaskList,
  createTaskUpdateTool,
} from "./task"

export function createBackgroundTools(
  manager: BackgroundManager,
  client: SessionContextCarrier,
  directory: string,
): Record<string, MatrixxToolDefinition> {
  const outputManager: BackgroundOutputManager = manager
  return {
    background_output: createBackgroundOutput(outputManager, client),
    background_cancel: createBackgroundCancel(manager, client),
    background_revive: createBackgroundRevive(manager, directory),
    background_wait_all: createBackgroundWaitAll(manager),
  }
}

export const builtinTools: Record<string, MatrixxToolDefinition> = {
  lsp_goto_definition,
  lsp_find_references,
  lsp_symbols,
  lsp_diagnostics,
  lsp_prepare_rename,
  lsp_rename,
}
