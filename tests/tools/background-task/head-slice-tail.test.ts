/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test"
import { formatFullSession } from "../../../src/tools/background-task/full-session-format"

function msg(id: string, text: string) {
  return { id, type: "user", time: { created: Number(id.replace("m", "")) }, content: [{ type: "text", text }] }
}

const task: any = { id: "bg_x", sessionID: "ses_x", description: "d", status: "completed" }

describe("full-session tail slice", () => {
  test("returns TAIL messages when limit is set — 5 messages limit 2 gives last 2", async () => {
    //#given
    const messages = [msg("m1", "first"), msg("m2", "second"), msg("m3", "third"), msg("m4", "fourth"), msg("m5", "fifth-verdict")]
    const client: any = { session: { context: async () => ({ messages }) } }

    //#when
    const out = await formatFullSession(task, client, { includeThinking: false, messageLimit: 2, includeToolResults: false })

    //#then
    expect(out).toContain("fourth")
    expect(out).toContain("fifth-verdict")
    expect(out).not.toContain("first")
    expect(out).not.toContain("second")
  })

  test("edge cases: undefined limit returns all, oversize limit returns all, zero returns none", async () => {
    //#given
    const messages = [msg("m1", "first"), msg("m2", "second"), msg("m3", "third"), msg("m4", "fourth"), msg("m5", "fifth-verdict")]
    const client: any = { session: { context: async () => ({ messages }) } }

    //#when
    const allUndef = await formatFullSession(task, client, { includeThinking: false, messageLimit: undefined, includeToolResults: false })
    const allBig = await formatFullSession(task, client, { includeThinking: false, messageLimit: 99, includeToolResults: false })
    const none = await formatFullSession(task, client, { includeThinking: false, messageLimit: 0, includeToolResults: false })

    //#then
    expect(allUndef).toContain("first")
    expect(allUndef).toContain("fifth-verdict")
    expect(allBig).toContain("first")
    expect(allBig).toContain("fifth-verdict")
    expect(none).not.toContain("first")
    expect(none).not.toContain("fifth-verdict")
  })
})
