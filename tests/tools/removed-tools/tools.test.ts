/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import type { MatrixxToolContext } from "../../../src/shared/tool/define-tool"
import { REMOVED_TOOL_NAMES } from "../../../src/tools/removed-tools/constants"
import {
  REMOVED_TOOL_GUARDS,
  buildRemovedToolMessage,
  createRemovedToolGuard,
} from "../../../src/tools/removed-tools/tools"

const mockContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  directory: "/tmp",
  worktree: "/tmp",
  abort: new AbortController().signal,
} as unknown as MatrixxToolContext

describe("removed-tool guard", () => {
  test("covers every removed delegation tool name", async () => {
    //#given
    const names = [...REMOVED_TOOL_NAMES]

    //#when
    const guards = names.map((name) => createRemovedToolGuard(name))

    //#then
    expect(names).toContain("task")
    expect(names).toContain("background_output")
    expect(names).toContain("background_cancel")
    expect(names).toContain("background_revive")
    expect(names).toContain("background_wait_all")
    expect(guards).toHaveLength(names.length)
    expect(REMOVED_TOOL_GUARDS).toHaveLength(names.length)
  })

  test("task guard points at native subagent and session readers", async () => {
    //#given
    const guard = createRemovedToolGuard("task")

    //#when
    const result = await guard.execute({}, mockContext)

    //#then
    const output = String(result)
    expect(output).toContain("removed")
    expect(output).toContain("subagent")
    expect(output).toContain("subagent_control")
    expect(output).toContain("session_read")
  })

  test("background guard points at subagent_control and session readers", async () => {
    //#given
    const guard = createRemovedToolGuard("background_output")

    //#when
    const result = await guard.execute({}, mockContext)

    //#then
    const output = String(result)
    expect(output).toContain("removed")
    expect(output).toContain("subagent_control")
    expect(output).toContain("session_read")
  })

  test("message builder names the removed tool", async () => {
    //#given
    const name = "background_cancel" as const

    //#when
    const message = buildRemovedToolMessage(name)

    //#then
    expect(message).toContain(name)
    expect(message).toContain("subagent")
    expect(message).toContain("load_skills")
    expect(message).not.toContain("background=")
  })
})
