// Group C notify regression — category-skill-reminder.
// Actual hook paths:
// - src/hooks/category-skill-reminder/hook.ts (createCategorySkillReminderHook, PostToolUse)
// - src/hooks/category-skill-reminder/formatter.ts (buildReminderMessage)
import { describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { _resetForTesting, clearSessionAgent, updateSessionAgent } from "../../../src/features/session-state/state"
import { createCategorySkillReminderHook } from "../../../src/hooks/category-skill-reminder/hook"
import { resetInjectionNotifier } from "../../../src/shared/injection-notifier"

type ToastOpts = {
  body: { title: string; message: string; variant: "info" | "success"; duration: number }
}

function makeCtx() {
  const seen: ToastOpts[] = []
  const ctx = {
    client: {
      tui: {
        showToast: async (o: ToastOpts) => {
          seen.push(o)
          return {}
        },
      },
    },
  } as unknown as PluginInput
  return { ctx, seen }
}

describe("category-skill-reminder notify (Task 5 Group C)", () => {
  test("transition → 1 toast; second reminder cycle → 0 new toasts", async () => {
    //#given a fresh notifier and a morpheus session
    _resetForTesting()
    resetInjectionNotifier()
    const { ctx, seen } = makeCtx()
    const hook = createCategorySkillReminderHook(ctx, [])
    const sessionID = "skill-notify-transition"
    updateSessionAgent(sessionID, "Morpheus")
    try {
      const output = { title: "", output: "result", metadata: {} }
      //#when 3 delegatable tool calls trigger the reminder
      await hook["tool.execute.after"]({ tool: "edit", sessionID, callID: "1" }, output)
      await hook["tool.execute.after"]({ tool: "edit", sessionID, callID: "2" }, output)
      await hook["tool.execute.after"]({ tool: "edit", sessionID, callID: "3" }, output)
      //#then reminder injected and exactly one toast fires
      expect(output.output).toContain("[Category+Skill Reminder]")
      expect(seen.length).toBe(1)
      //#when further tool calls occur (reminder already shown → idempotent)
      const output2 = { title: "", output: "result2", metadata: {} }
      await hook["tool.execute.after"]({ tool: "edit", sessionID, callID: "4" }, output2)
      await hook["tool.execute.after"]({ tool: "edit", sessionID, callID: "5" }, output2)
      await hook["tool.execute.after"]({ tool: "edit", sessionID, callID: "6" }, output2)
      //#then no second reminder and no second toast
      expect(output2.output).not.toContain("[Category+Skill Reminder]")
      expect(seen.length).toBe(1)
    } finally {
      clearSessionAgent(sessionID)
    }
  })

  test("non-target agent → 0 toasts", async () => {
    //#given an operator session (never a reminder target)
    _resetForTesting()
    resetInjectionNotifier()
    const { ctx, seen } = makeCtx()
    const hook = createCategorySkillReminderHook(ctx, [])
    const sessionID = "skill-notify-nontarget"
    updateSessionAgent(sessionID, "operator")
    try {
      const output = { title: "", output: "result", metadata: {} }
      //#when delegatable tools are used by a non-target agent
      await hook["tool.execute.after"]({ tool: "edit", sessionID, callID: "1" }, output)
      await hook["tool.execute.after"]({ tool: "edit", sessionID, callID: "2" }, output)
      await hook["tool.execute.after"]({ tool: "edit", sessionID, callID: "3" }, output)
      //#then no reminder and zero toasts
      expect(output.output).not.toContain("[Category+Skill Reminder]")
      expect(seen.length).toBe(0)
    } finally {
      clearSessionAgent(sessionID)
    }
  })
})
