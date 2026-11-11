import { afterAll, describe, expect, it, mock } from "bun:test"

mock.module("../../../src/shared/text/system-directive", () => ({
  createSystemDirective: (type: string) => `[DIRECTIVE:${type}]`,
  SystemDirectiveTypes: {
    TODO_CONTINUATION: "TODO CONTINUATION",
    MATRIX_LOOP_LOOP: "MATRIX_LOOP LOOP",
    MISSION_CONTINUATION: "MISSION CONTINUATION",
    DELEGATION_REQUIRED: "DELEGATION REQUIRED",
    SINGLE_TASK_ONLY: "SINGLE TASK ONLY",
    COMPACTION_CONTEXT: "COMPACTION CONTEXT",
    CONTEXT_WINDOW_MONITOR: "CONTEXT WINDOW MONITOR",
    ORACLE_READ_ONLY: "ORACLE READ-ONLY",
  },
}))

afterAll(() => {
  mock.restore()
})

import { createCompactionContextInjector } from "../../../src/hooks/compaction-context-injector/hook"

describe("createCompactionContextInjector", () => {
  describe("Agent Verification State preservation", () => {
    it("includes Agent Verification State section in compaction prompt", async () => {
      //#given
      const injector = createCompactionContextInjector()

      //#when
      const prompt = injector()

      //#then
      expect(prompt).toContain("Agent Verification State")
      expect(prompt).toContain("Current Agent")
      expect(prompt).toContain("Verification Progress")
    })

    it("includes reviewer-agent continuity fields", async () => {
      //#given
      const injector = createCompactionContextInjector()

      //#when
      const prompt = injector()

      //#then
      expect(prompt).toContain("Previous Rejections")
      expect(prompt).toContain("Acceptance Status")
      expect(prompt).toContain("reviewer agents")
    })

    it("preserves file verification progress fields", async () => {
      //#given
      const injector = createCompactionContextInjector()

      //#when
      const prompt = injector()

      //#then
      expect(prompt).toContain("Pending Verifications")
      expect(prompt).toContain("Files already verified")
    })
  })

  it("restricts constraints to explicit verbatim statements", async () => {
    //#given
    const injector = createCompactionContextInjector()

    //#when
    const prompt = injector()

    //#then
    expect(prompt).toContain("Explicit Constraints (Verbatim Only)")
    expect(prompt).toContain("Do NOT invent")
    expect(prompt).toContain("Quote constraints verbatim")
  })

  describe("Delegated Agent Sessions", () => {
    it("keeps static prompt to 4 sections with delegated sessions via dynamic history only", async () => {
      //#given
      const injector = createCompactionContextInjector()

      //#when
      const prompt = injector()

      //#then
      // Delegated-session history injection was removed with background-agent (Phase 5);
      // the static prompt carries no delegated-sessions section.
      const sections = prompt.match(/^## \d\./gm) ?? []
      expect(sections).toHaveLength(4)
      expect(prompt).not.toContain("Delegated Agent Sessions")
      expect(prompt).not.toContain("RESUME, DON'T RESTART")
      expect(prompt).toContain("Agent Verification State")
    })

    it("never injects a delegated-sessions section (Phase 5: background history source removed)", async () => {
      //#given
      const injector = createCompactionContextInjector()

      //#when
      const prompt = injector("ses_parent")

      //#then
      expect(prompt).not.toContain("Active/Recent Delegated Sessions")
    })

    it("does not inject task history section when no entries exist", async () => {
      //#given
      const injector = createCompactionContextInjector()

      // when
      const prompt = injector("ses_empty")

      //#then
      expect(prompt).not.toContain("Active/Recent Delegated Sessions")
    })
  })
})
