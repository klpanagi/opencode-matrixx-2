import type { BackgroundManager } from "../../features/background-agent"
import {
  COMPACTING_SNIPPET_BUDGET,
  type CompactingSnippetInput,
  getCompactingSnippet,
} from "../../features/session-memory"
import {
  createSystemDirective,
  SystemDirectiveTypes,
} from "../../shared/system-directive"

export const MAX_TASK_HISTORY_CHARS = 1500;

const COMPACTION_CONTEXT_PROMPT = `${createSystemDirective(SystemDirectiveTypes.COMPACTION_CONTEXT)}

When summarizing this session, you MUST include the following sections in your summary:

## 1. Goal & Requests
- Original user requests (as stated) and the final goal expected

## 2. Progress & Remaining
- Work completed (files, features, fixes) and what still remains

## 3. Explicit Constraints (Verbatim Only)
- Quote constraints verbatim. Do NOT invent or modify; write "None" if absent

## 4. Agent Verification State (Critical for Reviewers)
- **Current Agent**: What agent is running
- **Verification Progress**: Files already verified/validated
- **Pending Verifications**: Files still needing verification
- **Previous Rejections**: If reviewer agent, what was rejected and why
- **Acceptance Status**: Current state of review process

This section is CRITICAL for reviewer agents to maintain continuity.
`

export interface CompactionMemoryOptions {
  enabled?: boolean
  snippet?: CompactingSnippetInput
}

export function createCompactionContextInjector(
  backgroundManager?: BackgroundManager,
  memoryOptions?: CompactionMemoryOptions,
) {
  return (sessionID?: string, memoryOverride?: CompactionMemoryOptions): string => {
    let prompt = COMPACTION_CONTEXT_PROMPT

    if (backgroundManager && sessionID) {
      const history = backgroundManager.taskHistory.formatForCompaction(sessionID)
      if (history) {
        const cappedHistory =
          history.length > MAX_TASK_HISTORY_CHARS
            ? `${history.slice(0, MAX_TASK_HISTORY_CHARS)}\n[... history truncated to 1500 chars]`
            : history
        prompt += `\n### Active/Recent Delegated Sessions\n${cappedHistory}\n`
      }
    }

    // Caller passes the resolved native-backend boolean
    // (resolveMemoryBackend(...) === "native" && native opt-in);
    // the enabled === true gate itself is unchanged.
    const memory = memoryOverride ?? memoryOptions
    if (memory?.enabled === true && memory.snippet !== undefined) {
      const budgeted = getCompactingSnippet(memory.snippet, COMPACTING_SNIPPET_BUDGET)
      if (budgeted) {
        prompt += `\n### Session Memory\n${budgeted}\n`
      }
    }

    return prompt
  }
}
