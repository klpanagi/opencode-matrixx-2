import type { BackgroundTask } from "../../features/background-agent"
import { formatDuration } from "../../shared"
import { truncateText } from "./truncate-text"

export function formatTaskStatus(task: BackgroundTask): string {
  let duration: string
  if (task.status === "pending" && task.queuedAt) {
    duration = formatDuration(task.queuedAt, undefined)
  } else if (task.startedAt) {
    duration = formatDuration(task.startedAt, task.completedAt)
  } else {
    duration = "N/A"
  }

  const promptPreview = truncateText(task.prompt, 500)

  let progressSection = ""
  if (task.progress?.lastTool) {
    progressSection = `\n| Last tool | ${task.progress.lastTool} |`
  }

  let lastMessageSection = ""
  if (task.progress?.lastMessage) {
    const truncated = truncateText(task.progress.lastMessage, 500)
    lastMessageSection = `

## Last Message

\`\`\`
${truncated}
\`\`\``
  }

   let statusNote = ""
   if (task.status === "pending") {
     statusNote = `

> **Queued**: Task has been created and is waiting to start.`
   } else if (task.status === "running") {
     statusNote = `

> **Note**: No need to wait explicitly - the system will notify you when this task completes.`
   } else if (task.status === "error") {
     statusNote = `

> **Failed**: The task encountered an error. Check the last message for details.`
   } else if (task.status === "interrupt") {
     statusNote = `

> **Interrupted**: The task was interrupted by a prompt error. The session may contain partial results.`
   } else if (task.status === "stopped") {
     statusNote = `

> **Stopped**: the session ended without a terminal result — partial output may exist.`
   } else if (task.status === "statusUncertain") {
     statusNote = `

> **Uncertain**: liveness could not be determined after restart; re-check with background_output.`
   }

  const durationLabel = task.status === "pending" ? "Queued for" : "Duration"
  const sessionIdLabel = task.sessionID ? `\`${task.sessionID}\`` : "—"

  return `# Task Status

| Field | Value |
|-------|-------|
| Task ID | \`${task.id}\` |
| Description | ${task.description} |
| Agent | ${task.agent} |
| Status | **${task.status}** |
| ${durationLabel} | ${duration} |
| Session ID | ${sessionIdLabel} |${progressSection}
${statusNote}
## Original Prompt

\`\`\`
${promptPreview}
\`\`\`${lastMessageSection}`
}
