/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { VOTER_TIMEOUT_MS } from "../../../src/tools/assembly/constants"
import { spawnVoters } from "../../../src/tools/assembly/voter-spawner"
import { assistantMessage, createFakeAssemblyClient, userMessage } from "./fake-client"

const PROVIDERS = [
  { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
  { providerID: "openai", modelID: "gpt-4o" },
]

function voterTranscript(reasoning: string) {
  return [
    userMessage(),
    assistantMessage(`## Reasoning\n${reasoning}\n\n## Conclusion\nDone\n\n## Confidence\nHigh`),
  ]
}

describe("spawnVoters", () => {
  test("fans out one child per provider and maps completed results", async () => {
    //#given
    const { client, calls } = createFakeAssemblyClient([voterTranscript("r1"), voterTranscript("r2")])

    //#when
    const results = await spawnVoters(client, "what is 2+2?", PROVIDERS, "parent-1")

    //#then
    expect(results).toHaveLength(2)
    expect(results[0].status).toBe("completed")
    expect(results[0].modelLabel).toBe("anthropic:claude-sonnet-4-20250514")
    expect(results[0].reasoning).toContain("r1")
    expect(results[1].modelLabel).toBe("openai:gpt-4o")
    expect(calls.create).toHaveLength(2)
    for (const body of calls.create) {
      expect(body.parentID).toBe("parent-1")
      expect(body.agent).toBe("mouse")
    }
    expect((calls.create[0].model as Record<string, unknown>).providerID).toBe("anthropic")
    expect(calls.prompt).toHaveLength(2)
  })

  test("maps spawn failure to an error voter without hanging siblings", async () => {
    //#given
    const { client } = createFakeAssemblyClient([voterTranscript("r1")])
    const failing = {
      ...client.session,
      create: async () => {
        throw new Error("denied")
      },
    }
    const failingClient = { session: failing }

    //#when
    const results = await spawnVoters(failingClient, "q?", PROVIDERS, "parent-1")

    //#then
    expect(results).toHaveLength(2)
    for (const result of results) {
      expect(result.status).toBe("error")
      expect(result.error).toContain("denied")
    }
  })

  test("maps a hung voter to timeout with the legacy message", async () => {
    //#given
    const { client, calls } = createFakeAssemblyClient([[userMessage()], [userMessage()]])

    //#when
    const results = await spawnVoters(client, "q?", PROVIDERS, "parent-1", {
      timeoutMs: 40,
      pollIntervalMs: 5,
    })

    //#then
    expect(results[0].status).toBe("timeout")
    expect(results[0].error).toBe(`Voter 1 timed out after 40ms`)
    expect(calls.interrupt).toHaveLength(2)
  })

  test("maps interruption to the legacy was-interrupted message", async () => {
    //#given
    const { client } = createFakeAssemblyClient([[userMessage()]])
    const controller = new AbortController()
    controller.abort(new Error("interrupted"))

    //#when
    const results = await spawnVoters(client, "q?", PROVIDERS.slice(0, 1), "parent-1", {
      timeoutMs: VOTER_TIMEOUT_MS,
      pollIntervalMs: 5,
      signal: controller.signal,
    })

    //#then
    expect(results[0].status).toBe("error")
    expect(results[0].error).toBe("Voter 1 was interrupted")
  })
})
