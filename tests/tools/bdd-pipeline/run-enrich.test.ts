/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import { join } from "node:path"
import type { NativeSubagentClient } from "../../../src/shared/session/native-subagent"

function assistantMessage(text: string) {
  return {
    id: "assistant-1",
    type: "assistant",
    time: { created: 2, completed: 3 },
    content: [{ type: "text", text }],
    finish: "stop",
  }
}

function userMessage() {
  return { id: "user-1", type: "user", time: { created: 1 }, text: "go" }
}

function createFakeClient(): { client: NativeSubagentClient; calls: { create: unknown[]; prompt: unknown[] } } {
  const calls = { create: [] as unknown[], prompt: [] as unknown[] }
  const session = {
    create: async (body?: Record<string, unknown>) => {
      calls.create.push(body)
      return { id: "child-1" }
    },
    prompt: async (args: { sessionID: string } & Record<string, unknown>) => {
      calls.prompt.push(args)
      return {}
    },
    interrupt: async (_args: { sessionID: string }) => ({}),
    context: async (_args: { sessionID: string }) => ({
      messages: [userMessage(), assistantMessage("enriched")],
    }),
  }
  return { client: { session }, calls }
}

function writeContract(dir: string): string {
  const contract = {
    schemaVersion: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    sourceFile: "/test/login.feature",
    feature: { name: "User Login", tags: [] },
    scenarios: [
      {
        name: "Successful login",
        tags: [],
        steps: [
          { keyword: "Given", text: "the user is on the login page" },
          { keyword: "When", text: "the user enters valid credentials" },
          { keyword: "Then", text: "the user is redirected to the dashboard" },
        ],
      },
    ],
    annotations: {},
  }
  const path = join(dir, "contract.json")
  fs.writeFileSync(path, JSON.stringify(contract))
  return path
}

describe("runEnrich (native)", () => {
  test("spawns the mouse agent and validates the enriched contract", async () => {
    //#given
    const { runEnrich } = await import("../../../src/tools/bdd-pipeline/tools")
    const dir = fs.mkdtempSync(join(os.tmpdir(), "bdd-enrich-"))
    const contractPath = writeContract(dir)
    const { client, calls } = createFakeClient()
    const skillResolver = () => ({ content: undefined, error: null })

    //#when
    const result = await runEnrich(client, contractPath, {
      parentSessionID: "parent-1",
      skillResolver,
    })

    //#then
    expect(result.success).toBe(true)
    const body = calls.create[0] as Record<string, unknown>
    expect(body.agent).toBe("mouse")
    expect(body.parentID).toBe("parent-1")
    expect(body.title).toBe("[bdd-pipeline] contract enrich")
  })

  test("aborted signal returns failure without spawning", async () => {
    //#given
    const { runEnrich } = await import("../../../src/tools/bdd-pipeline/tools")
    const dir = fs.mkdtempSync(join(os.tmpdir(), "bdd-enrich-"))
    const contractPath = writeContract(dir)
    const { client, calls } = createFakeClient()
    const controller = new AbortController()
    controller.abort()

    //#when
    const result = await runEnrich(client, contractPath, {
      parentSessionID: "parent-1",
      abort: controller.signal,
    })

    //#then
    expect(result.success).toBe(false)
    expect(result.error).toBe("aborted")
    expect(calls.create).toHaveLength(0)
  })
})
