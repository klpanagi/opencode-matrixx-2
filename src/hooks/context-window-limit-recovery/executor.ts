import type { ExperimentalConfig } from "../../config";
import { notify } from "../../shared/notify"
import type { Client } from "./client";
import { runSummarizeRetryStrategy } from "./summarize-retry-strategy";
import type { AutoCompactState } from "./types";

export { getLastAssistant } from "./message-builder";

export async function executeCompact(
  sessionID: string,
  msg: Record<string, unknown>,
  autoCompactState: AutoCompactState,
  client: Client,
  directory: string,
  experimental?: ExperimentalConfig,
): Promise<void> {
  void experimental

  if (autoCompactState.compactionInProgress.has(sessionID)) {
    notify("warn", "Compact In Progress: Recovery already running. Please wait or start new session if stuck.")
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
      client,
      directory,
      errorType: errorData?.errorType,
      messageIndex: errorData?.messageIndex,
    })
  } finally {
    autoCompactState.compactionInProgress.delete(sessionID);
  }
}
