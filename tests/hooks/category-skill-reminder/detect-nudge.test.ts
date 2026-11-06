/// <reference types="bun-types" />
import { describe, test, expect, beforeEach } from "bun:test"
import {
  _resetForTesting,
  clearSessionAgent,
  registerSubagentSession,
  updateSessionAgent,
} from "../../../src/features/session-state/state"
import { detectNudge } from "../../../src/hooks/category-skill-reminder/detector"
import { buildNudgeMessage } from "../../../src/hooks/category-skill-reminder/formatter"

describe("detectNudge pure detector", () => {
  beforeEach(() => {
    _resetForTesting()
  })

  test("hit: 3+ delegatable calls without delegation returns nudge event", () => {
    //#given
    const sessionID = "nudge-hit"
    updateSessionAgent(sessionID, "Morpheus")
    try {
      //#when
      const result = detectNudge({
        tool: "edit",
        sessionID,
        toolCallCount: 3,
        delegationUsed: false,
        reminderShown: false,
      })

      //#then
      expect(result).not.toBeNull()
      expect(result?.skill).toBe("construct")
      expect(result?.reason).toContain("delegation")
    } finally {
      clearSessionAgent(sessionID)
    }
  })

  test("miss: fewer than 3 calls returns null", () => {
    //#given
    const sessionID = "nudge-miss-count"
    updateSessionAgent(sessionID, "Morpheus")
    try {
      //#when
      const result = detectNudge({
        tool: "edit",
        sessionID,
        toolCallCount: 2,
        delegationUsed: false,
        reminderShown: false,
      })

      //#then
      expect(result).toBeNull()
    } finally {
      clearSessionAgent(sessionID)
    }
  })

  test("miss: delegation already used returns null", () => {
    //#given
    const sessionID = "nudge-miss-delegation"
    updateSessionAgent(sessionID, "Morpheus")
    try {
      //#when
      const result = detectNudge({
        tool: "edit",
        sessionID,
        toolCallCount: 5,
        delegationUsed: true,
        reminderShown: false,
      })

      //#then
      expect(result).toBeNull()
    } finally {
      clearSessionAgent(sessionID)
    }
  })

  test("miss: non-delegatable tool returns null", () => {
    //#given
    const sessionID = "nudge-miss-tool"
    updateSessionAgent(sessionID, "Morpheus")
    try {
      //#when
      const result = detectNudge({
        tool: "task",
        sessionID,
        toolCallCount: 5,
        delegationUsed: false,
        reminderShown: false,
      })

      //#then
      expect(result).toBeNull()
    } finally {
      clearSessionAgent(sessionID)
    }
  })

  test("miss: non-target agent returns null", () => {
    //#given
    const sessionID = "nudge-miss-agent"
    updateSessionAgent(sessionID, "operator")
    try {
      //#when
      const result = detectNudge({
        tool: "edit",
        sessionID,
        toolCallCount: 5,
        delegationUsed: false,
        reminderShown: false,
      })

      //#then
      expect(result).toBeNull()
    } finally {
      clearSessionAgent(sessionID)
    }
  })

  test("miss: nested subagent session returns null", () => {
    //#given
    const parentID = "nudge-parent"
    const subID = "nudge-subagent"
    updateSessionAgent(subID, "Morpheus")
    registerSubagentSession(subID, parentID)
    try {
      //#when
      const result = detectNudge({
        tool: "edit",
        sessionID: subID,
        toolCallCount: 5,
        delegationUsed: false,
        reminderShown: false,
      })

      //#then
      expect(result).toBeNull()
    } finally {
      clearSessionAgent(subID)
    }
  })

  test("miss: reminder already shown returns null", () => {
    //#given
    const sessionID = "nudge-miss-shown"
    updateSessionAgent(sessionID, "Morpheus")
    try {
      //#when
      const result = detectNudge({
        tool: "edit",
        sessionID,
        toolCallCount: 9,
        delegationUsed: false,
        reminderShown: true,
      })

      //#then
      expect(result).toBeNull()
    } finally {
      clearSessionAgent(sessionID)
    }
  })

  test("buildNudgeMessage renders skill and reason", () => {
    //#given
    const event = { skill: "construct", reason: "delegatable work without delegation (3+ calls)" }

    //#when
    const message = buildNudgeMessage(event)

    //#then
    expect(message).toContain("construct")
    expect(message).toContain(event.reason)
  })
})
