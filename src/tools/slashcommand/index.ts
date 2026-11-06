/** slashcommand barrel: explicit named re-exports of local modules only. */
export {
  discoverCommandsSync,
} from "./command-discovery"
export {
  formatCommandList,
  formatLoadedCommand,
} from "./command-output-formatter"
export {
  skillToCommandInfo,
} from "./skill-command-converter"
export {
  buildDescriptionFromItems,
  TOOL_DESCRIPTION_PREFIX,
} from "./slashcommand-description"
export {
  createSlashcommandTool,
  slashcommand,
} from "./slashcommand-tool"
export type {
  CommandInfo,
  CommandMetadata,
  CommandScope,
  PluginCommandClient,
  PluginCommandEntry,
  SlashcommandToolOptions,
} from "./types"
