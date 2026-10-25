import type { PluginInput } from "@opencode-ai/plugin";
import type { ExperimentalConfig } from "../../config";
import { log } from "../../shared/logger"
import type { Client } from "./client";
import { runSummarizeRetryStrategy } from "./recovery-strategy";
import type { AutoCompactState } from "./types";

export { getLastAssistant } from "./message-builder";

export async function executeCompact(
  sessionID: string,
  msg: Record<string, unknown>,
  autoCompactState: AutoCompactState,
  client: PluginInput["client"],
  directory: string,
  experimental?: ExperimentalConfig,
): Promise<void> {
  void experimental

  if (autoCompactState.compactionInProgress.has(sessionID)) {
    await (client as Client).tui
      .showToast({
        body: {
          title: "Compact In Progress",
          message:
            "Recovery already running. Please wait or start new session if stuck.",
          variant: "warning",
          duration: 5000,
        },
      })
      .catch((err) => { log("[auto-compact] Toast failed:", err) });
    return;
  }
  autoCompactState.compactionInProgress.add(sessionID);

  try {
    const errorData = autoCompactState.errorDataBySession.get(sessionID);

    // Reactive recovery only: retry summarize on token-limit errors.
    // Proactive/aggressive truncation belongs to DCP (/dcp-compress).
    await runSummarizeRetryStrategy({
      sessionID,
      msg,
      autoCompactState,
      client: client as Client,
      directory,
      errorType: errorData?.errorType,
      messageIndex: errorData?.messageIndex,
    })
  } finally {
    autoCompactState.compactionInProgress.delete(sessionID);
  }
}
