/// <reference types="bun-types" />
import { describe, test, expect, beforeEach } from "bun:test"
import type { MatrixxContext } from "../../../src/plugin/context"
import {
  _resetForTesting,
  clearSessionAgent,
  registerSubagentSession,
  unregisterSubagentSession,
  updateSessionAgent,
} from "../../../src/features/session-state/state"
import { createCategorySkillReminderHook } from "../../../src/hooks/category-skill-reminder/hook"
import { resetInjectionNotifier } from "../../../src/shared/injection-notifier"

function makeCtx() {
  return {
    client: { tui: { showToast: async () => {} } },
  } as unknown as MatrixxContext
}

describe("category-skill-reminder activator wiring (Task 3)", () => {
  beforeEach(() => {
    _resetForTesting()
    resetInjectionNotifier()
  })

  test("repeat nudge within 60s is suppressed", async () => {
    //#given
    let now = 1_000_000
    const hook = createCategorySkillReminderHook(makeCtx(), [], { now: () => now })
    const sessionID = "dedup-session"
    updateSessionAgent(sessionID, "Morpheus")
    try {
      const out1 = { title: "", output: "r", metadata: {} }
      await hook["tool.execute.after"]({ tool: "edit", sessionID, callID: "1" }, out1)
      await hook["tool.execute.after"]({ tool: "edit", sessionID, callID: "2" }, out1)
      await hook["tool.execute.after"]({ tool: "edit", sessionID, callID: "3" }, out1)
      expect(out1.output).toContain("[Category+Skill Reminder]")
      const lenAfterFirst = out1.output.length

      //#when — reset per-session shown by compacting then re-trigger within window
      await hook.event({ type: "session.compacted", data: { sessionID } } as never)
      updateSessionAgent(sessionID, "Morpheus")
      now += 10_000
      const out2 = { title: "", output: "r", metadata: {} }
      await hook["tool.execute.after"]({ tool: "edit", sessionID, callID: "4" }, out2)
      await hook["tool.execute.after"]({ tool: "edit", sessionID, callID: "5" }, out2)
      await hook["tool.execute.after"]({ tool: "edit", sessionID, callID: "6" }, out2)

      //#then — suppressed by 60s dedup despite state reset
      expect(out2.output).not.toContain("[Category+Skill Reminder]")
      expect(lenAfterFirst).toBeGreaterThan(1)
    } finally {
      clearSessionAgent(sessionID)
    }
  })

  test("fail-open: throwing notify does not break tool output", async () => {
    //#given
    const badCtx = {
      client: {
        tui: {
          showToast: async () => {
            throw new Error("toast boom")
          },
        },
      },
    } as unknown as MatrixxContext
    const hook = createCategorySkillReminderHook(badCtx, [])
    const sessionID = "failopen-session"
    updateSessionAgent(sessionID, "Morpheus")
    try {
      const output = { title: "", output: "result", metadata: {} }

      //#when
      await hook["tool.execute.after"]({ tool: "edit", sessionID, callID: "1" }, output)
      await hook["tool.execute.after"]({ tool: "edit", sessionID, callID: "2" }, output)
      await hook["tool.execute.after"]({ tool: "edit", sessionID, callID: "3" }, output)

      //#then — no throw, output still usable
      expect(output.output).toContain("result")
    } finally {
      clearSessionAgent(sessionID)
    }
  })

  test("background/subagent sessions are skipped", async () => {
    //#given
    const hook = createCategorySkillReminderHook(makeCtx(), [])
    const sessionID = "bg-session"
    registerSubagentSession(sessionID, "parent-1")
    updateSessionAgent(sessionID, "Morpheus")
    try {
      const output = { title: "", output: "result", metadata: {} }

      //#when
      await hook["tool.execute.after"]({ tool: "edit", sessionID, callID: "1" }, output)
      await hook["tool.execute.after"]({ tool: "edit", sessionID, callID: "2" }, output)
      await hook["tool.execute.after"]({ tool: "edit", sessionID, callID: "3" }, output)

      //#then
      expect(output.output).not.toContain("[Category+Skill Reminder]")
    } finally {
      unregisterSubagentSession(sessionID)
      clearSessionAgent(sessionID)
    }
  })

  test("session.deleted clears state so a fresh session can nudge again", async () => {
    //#given
    let now = 5_000_000
    const hook = createCategorySkillReminderHook(makeCtx(), [], { now: () => now })
    const sessionID = "deleted-session"
    updateSessionAgent(sessionID, "Morpheus")
    try {
      const out1 = { title: "", output: "r", metadata: {} }
      await hook["tool.execute.after"]({ tool: "edit", sessionID, callID: "1" }, out1)
      await hook["tool.execute.after"]({ tool: "edit", sessionID, callID: "2" }, out1)
      await hook["tool.execute.after"]({ tool: "edit", sessionID, callID: "3" }, out1)
      expect(out1.output).toContain("[Category+Skill Reminder]")

      //#when — delete clears state, advance past 60s window
      await hook.event({ type: "session.deleted", data: { info: { id: sessionID } } } as never)
      updateSessionAgent(sessionID, "Morpheus")
      now += 61_000
      const out2 = { title: "", output: "r", metadata: {} }
      await hook["tool.execute.after"]({ tool: "edit", sessionID, callID: "4" }, out2)
      await hook["tool.execute.after"]({ tool: "edit", sessionID, callID: "5" }, out2)
      await hook["tool.execute.after"]({ tool: "edit", sessionID, callID: "6" }, out2)

      //#then
      expect(out2.output).toContain("[Category+Skill Reminder]")
    } finally {
      clearSessionAgent(sessionID)
    }
  })
})
