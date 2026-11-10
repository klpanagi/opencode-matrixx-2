/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
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

function createFakeClient(output: string): {
  client: NativeSubagentClient
  calls: { create: unknown[]; prompt: unknown[]; interrupt: unknown[] }
} {
  const calls = { create: [] as unknown[], prompt: [] as unknown[], interrupt: [] as unknown[] }
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
    context: async (_args: { sessionID: string }) => ({
      messages: [userMessage(), assistantMessage(output)],
    }),
  }
  return { client: { session }, calls }
}

function createHangingClient(calls: { create: unknown[]; prompt: unknown[]; interrupt: unknown[] }): NativeSubagentClient {
  return {
    session: {
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
      context: async (_args: { sessionID: string }) => {
        await new Promise((r) => setTimeout(r, 100))
        return { messages: [userMessage(), assistantMessage("late")] }
      },
    },
  }
}

const REPORT = JSON.stringify({
  stage: "tests",
  files_created: ["/out/login/tests/a.ts"],
  tests_run: 5,
  tests_passed: 5,
  tests_failed: 0,
  test_output: "",
  error: "",
})

describe("spawnStageSubagent (native)", () => {
  test("spawns with the legacy agent verbatim and parses the JSON report", async () => {
    //#given
    const { spawnStageSubagent } = await import("../../../src/tools/bdd-pipeline/subagent-runner")
    const { client, calls } = createFakeClient(REPORT)
    const skillResolver = () => ({ content: "SKILL-TEXT", error: null })

    //#when
    const result = await spawnStageSubagent({
      client,
      stage: "tests",
      prompt: "build tests",
      contractPath: "/out/contract.json",
      parentSessionID: "parent-1",
      outDir: "/out/login",
      skillResolver,
    })

    //#then
    expect(result.status).toBe("completed")
    expect(result.filesCreated).toEqual(["/out/login/tests/a.ts"])
    expect(result.testsRun).toBe(5)
    const body = calls.create[0] as Record<string, unknown>
    expect(body.agent).toBe("bdd-tests")
    expect(body.parentID).toBe("parent-1")
    expect(body.title).toBe("[bdd-pipeline] tests")
    const prompted = calls.prompt[0] as Record<string, unknown>
    expect(String(prompted.text)).toContain("SKILL-TEXT")
    expect(String(prompted.text)).toContain("build tests")
  })

  test("pre-aborted signal returns the aborted empty stage without spawning", async () => {
    //#given
    const { spawnStageSubagent } = await import("../../../src/tools/bdd-pipeline/subagent-runner")
    const { client, calls } = createFakeClient(REPORT)
    const controller = new AbortController()
    controller.abort()

    //#when
    const result = await spawnStageSubagent({
      client,
      stage: "frontend",
      prompt: "build ui",
      contractPath: "/out/contract.json",
      parentSessionID: "parent-1",
      outDir: "/out/login",
      abort: controller.signal,
    })

    //#then
    expect(result.status).toBe("failed")
    expect(result.error).toBe("aborted")
    expect(calls.create).toHaveLength(0)
  })

  test("abort during the wait interrupts the in-flight child", async () => {
    //#given
    const { spawnStageSubagent } = await import("../../../src/tools/bdd-pipeline/subagent-runner")
    const calls = { create: [] as unknown[], prompt: [] as unknown[], interrupt: [] as unknown[] }
    const client = createHangingClient(calls)
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 20)

    //#when
    const result = await spawnStageSubagent({
      client,
      stage: "backend",
      prompt: "build api",
      contractPath: "/out/contract.json",
      parentSessionID: "parent-1",
      outDir: "/out/login",
      abort: controller.signal,
    })

    //#then
    expect(result.status).toBe("failed")
    expect(result.error).toBe("aborted")
    expect(calls.interrupt.length).toBeGreaterThan(0)
  })

  test("spawn failure returns a failed stage with the error", async () => {
    //#given
    const { spawnStageSubagent } = await import("../../../src/tools/bdd-pipeline/subagent-runner")
    const { client } = createFakeClient(REPORT)
    const failing: NativeSubagentClient = {
      session: {
        ...client.session,
        create: async () => {
          throw new Error("no parent")
        },
      },
    }

    //#when
    const result = await spawnStageSubagent({
      client: failing,
      stage: "backend",
      prompt: "build api",
      contractPath: "/out/contract.json",
      parentSessionID: "parent-1",
      outDir: "/out/login",
    })

    //#then
    expect(result.status).toBe("failed")
    expect(result.error).toContain("no parent")
  })

  test("unparseable output returns failed with testOutput preserved", async () => {
    //#given
    const { spawnStageSubagent } = await import("../../../src/tools/bdd-pipeline/subagent-runner")
    const { client } = createFakeClient("just some prose without json")

    //#when
    const result = await spawnStageSubagent({
      client,
      stage: "tests",
      prompt: "build tests",
      contractPath: "/out/contract.json",
      parentSessionID: "parent-1",
      outDir: "/out/login",
    })

    //#then
    expect(result.status).toBe("failed")
    expect(result.error).toBe("subagent returned no parseable JSON report")
    expect(result.testOutput).toBe("just some prose without json")
  })
})
