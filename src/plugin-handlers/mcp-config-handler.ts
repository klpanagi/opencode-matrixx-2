import type { MatrixxConfig } from "../config";
import { buildBuiltinMcpEntries } from "../mcp";
import { setMcpStartupFailures } from "../mcp/mcp-startup-state";
import { isCommandAvailable } from "../mcp/mcp-validator";
import { log } from "../shared";
import type { PluginComponents } from "./plugin-components-loader";

type McpEntry = Record<string, unknown>;

function captureUserDisabledMcps(
  userMcp: Record<string, unknown> | undefined
): Set<string> {
  const disabled = new Set<string>();
  if (!userMcp) return disabled;

  for (const [name, value] of Object.entries(userMcp)) {
    if (
      value &&
      typeof value === "object" &&
      "enabled" in value &&
      (value as McpEntry).enabled === false
    ) {
      disabled.add(name);
    }
  }

  return disabled;
}

export async function applyMcpConfig(params: {
  config: Record<string, unknown>;
  pluginConfig: MatrixxConfig;
  pluginComponents: PluginComponents;
}): Promise<void> {
  const disabledMcps = params.pluginConfig.disabled_mcps ?? [];
  const userMcp = params.config.mcp as Record<string, unknown> | undefined;
  const userDisabledMcps = captureUserDisabledMcps(userMcp);

  // Capability resolved once at the edge; the builder itself never spawns.
  const { entries: builtinMcps, failures } = buildBuiltinMcpEntries({
    disabledMcps,
    websearch: params.pluginConfig.websearch,
    uvxAvailable: isCommandAvailable("uvx"),
  });

  const merged = {
    ...builtinMcps,
    ...(userMcp ?? {}),
    ...params.pluginComponents.mcpServers,
  } as Record<string, McpEntry>;

  for (const name of userDisabledMcps) {
    if (merged[name]) {
      merged[name] = { ...merged[name], enabled: false };
    }
  }

  const disabledSet = new Set(disabledMcps);
  for (const name of disabledSet) {
    delete merged[name];
  }

  if (failures.length > 0) {
    const summary = failures
      .map((f) => `${f.name}: ${f.error}`)
      .join("; ");
    log(`[mcp-config] MCP startup issues detected: ${summary}`, failures);
    setMcpStartupFailures(failures);
  }

  params.config.mcp = merged;
}
