/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  readNativeSubagentOutput,
  spawnNativeSubagent,
  waitNativeSubagent,
  type NativeSubagentClient,
} from "../../../src/shared/session/native-subagent"
import { getSessionTemperature } from "../../../src/shared/session/session-state"

function assistantMessage(text: string, finish = "stop") {
  return {
    id: "assistant-1",
    type: "assistant",
    time: { created: 2, completed: 3 },
    content: [{ type: "text", text }],
    finish,
  }
}

function userMessage() {
  return { id: "user-1", type: "user", time: { created: 1 }, text: "hello" }
}

function createRecordingClient(overrides?: Partial<NativeSubagentClient["session"]>): {
  client: NativeSubagentClient
  calls: { create: unknown[]; prompt: unknown[]; interrupt: unknown[]; context: unknown[] }
} {
  const calls = { create: [] as unknown[], prompt: [] as unknown[], interrupt: [] as unknown[], context: [] as unknown[] }
  const session = {
    create: async (body?: Record<string, unknown>) => {
      calls.create.push(body)
      return { id: "child-1" }
    },
    prompt: async (args: { sessionID: string } & Record<string, unknown>) => {
      calls.prompt.push(args)
      return {}
    },
    interrupt: async (args: { sessionID: string }) => {
      calls.interrupt.push(args)
      return {}
    },
    context: async (args: { sessionID: string }) => {
      calls.context.push(args)
      return { messages: [userMessage(), assistantMessage("done")] }
    },
    ...overrides,
  }
  return { client: { session: session }, calls }
}

describe("spawnNativeSubagent", () => {
  test("creates a child session with parentID and prompts it", async () => {
    //#given
    const { client, calls } = createRecordingClient()

    //#when
    const result = await spawnNativeSubagent(client, {
      agent: "mouse",
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514", temperature: 0.3 },
      prompt: "answer this",
      parentSessionID: "parent-1",
      title: "assembly-voter-anthropic-1",
    })

    //#then
    expect(result).toEqual({ ok: true, sessionID: "child-1" })
    expect(calls.create).toHaveLength(1)
    const body = calls.create[0] as Record<string, unknown>
    expect(body.parentID).toBe("parent-1")
    expect(body.title).toBe("assembly-voter-anthropic-1")
    expect(body.agent).toBe("mouse")
    expect(calls.prompt).toEqual([{ sessionID: "child-1", text: "answer this" }])
    expect(getSessionTemperature("child-1")).toBe(0.3)
  })

  test("returns ok:false when session creation throws", async () => {
    //#given
    const { client } = createRecordingClient({
      create: async () => {
        throw new Error("no parent")
      },
    })

    //#when
    const result = await spawnNativeSubagent(client, {
      agent: "mouse",
      prompt: "answer this",
      parentSessionID: "missing",
      title: "assembly-voter-x-1",
    })

    //#then
    expect(result.ok).toBe(false)
  })

  test("returns ok:false when prompting the child throws", async () => {
    //#given
    const { client } = createRecordingClient({
      prompt: async () => {
        throw new Error("prompt denied")
      },
    })

    //#when
    const result = await spawnNativeSubagent(client, {
      agent: "mouse",
      prompt: "answer this",
      parentSessionID: "parent-1",
      title: "assembly-voter-x-1",
    })

    //#then
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("prompt denied")
  })
})

describe("waitNativeSubagent", () => {
  test("resolves completed with the last assistant output", async () => {
    //#given
    const { client } = createRecordingClient()

    //#when
    const result = await waitNativeSubagent(client, { sessionID: "child-1", timeoutMs: 5000 })

    //#then
    expect(result.status).toBe("completed")
    expect(result.output).toBe("done")
  })

  test("polls until the assistant answer lands", async () => {
    //#given
    let polls = 0
    const { client } = createRecordingClient({
      context: async () => {
        polls += 1
        if (polls < 3) return { messages: [userMessage()] }
        return { messages: [userMessage(), assistantMessage("late answer")] }
      },
    })

    //#when
    const result = await waitNativeSubagent(client, {
      sessionID: "child-1",
      timeoutMs: 5000,
      pollIntervalMs: 5,
    })

    //#then
    expect(result.status).toBe("completed")
    expect(result.output).toBe("late answer")
    expect(polls).toBeGreaterThanOrEqual(3)
  })

  test("times out and interrupts the child", async () => {
    //#given
    const { client, calls } = createRecordingClient({
      context: async () => ({ messages: [userMessage()] }),
    })

    //#when
    const result = await waitNativeSubagent(client, {
      sessionID: "child-1",
      timeoutMs: 30,
      pollIntervalMs: 5,
    })

    //#then
    expect(result.status).toBe("timeout")
    expect(calls.interrupt).toEqual([{ sessionID: "child-1" }])
  })

  test("aborted signal interrupts and reports failed without hanging", async () => {
    //#given
    const { client, calls } = createRecordingClient({
      context: async () => ({ messages: [userMessage()] }),
    })
    const controller = new AbortController()
    controller.abort(new Error("interrupted"))

    //#when
    const result = await waitNativeSubagent(client, {
      sessionID: "child-1",
      timeoutMs: 5000,
      pollIntervalMs: 5,
      signal: controller.signal,
    })

    //#then
    expect(result.status).toBe("failed")
    expect(result.error).toBe("interrupted")
    expect(calls.interrupt).toEqual([{ sessionID: "child-1" }])
  })

  test("assistant error surfaces as failed", async () => {
    //#given
    const { client } = createRecordingClient({
      context: async () => ({
        messages: [
          userMessage(),
          { ...assistantMessage(""), error: "boom", finish: "error" },
        ],
      }),
    })

    //#when
    const result = await waitNativeSubagent(client, { sessionID: "child-1", timeoutMs: 5000 })

    //#then
    expect(result.status).toBe("failed")
    expect(result.error).toBe("boom")
  })
})

describe("readNativeSubagentOutput", () => {
  test("returns the newest assistant text", async () => {
    //#given
    const messages = [userMessage(), assistantMessage("first"), assistantMessage("second")]

    //#when
    const output = readNativeSubagentOutput(messages)

    //#then
    expect(output).toBe("second")
  })

  test("returns empty string when no assistant message exists", async () => {
    //#given
    const messages = [userMessage()]

    //#when
    const output = readNativeSubagentOutput(messages)

    //#then
    expect(output).toBe("")
  })
})
