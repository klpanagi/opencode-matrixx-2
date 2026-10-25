import type { MatrixxConfig } from "../config";
import { buildBuiltinCommandEntries } from "../features/builtin-commands";
import type { PluginComponents } from "./plugin-components-loader";

export async function applyCommandConfig(params: {
  config: Record<string, unknown>;
  pluginConfig: MatrixxConfig;
  ctx: { directory: string };
  pluginComponents: PluginComponents;
}): Promise<void> {
  const builtinCommands = buildBuiltinCommandEntries(params.pluginConfig.disabled_commands);
  const systemCommands = (params.config.command as Record<string, unknown>) ?? {};

  params.config.command = {
    ...builtinCommands,
    ...systemCommands,
    ...params.pluginComponents.commands,
    ...params.pluginComponents.skills,
  };
}
