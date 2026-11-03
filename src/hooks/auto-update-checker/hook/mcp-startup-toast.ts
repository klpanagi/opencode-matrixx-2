import { getMcpStartupNotice } from "../../../mcps/mcp-startup-notice"
import { notify } from "../../../shared/notify"

/**
 * Surface disabled-MCP startup failures as a user-visible warning on the
 * session-created path. Silent when the startup state holds no failures.
 */
export async function showMcpStartupNoticeIfAny(): Promise<void> {
  const notice = getMcpStartupNotice()
  if (!notice) return
  notify("warn", notice)
}
