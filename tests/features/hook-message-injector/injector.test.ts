import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test"
import type { OpencodeClient } from "../../../src/features/hook-message-injector/injector"
import {
  findFirstMessageWithAgentFromSDK,
  findNearestMessageWithFieldsFromSDK,
  injectHookMessage,
} from "../../../src/features/hook-message-injector/injector"

//#region Mocks

const mockIsSqliteBackend = vi.fn()

vi.mock("../../../src/shared/opencode-storage-detection", () => ({
  isSqliteBackend: mockIsSqliteBackend,
  resetSqliteBackendCache: () => {},
}))

//#endregion

//#region Test Helpers

function createMockClient(messages: Array<{
  agent?: string
  model?: { providerID?: string; modelID?: string; variant?: string }
  info?: {
    agent?: string
    model?: { providerID?: string; modelID?: string; variant?: string }
    providerID?: string
    modelID?: string
    tools?: Record<string, boolean>
  }
}>): {
  session: {
    context: (opts: { sessionID: string }) => Promise<typeof messages>
  }
} {
  return {
    session: {
      context: async () => messages,
    },
  }
}

//#endregion

describe("findNearestMessageWithFieldsFromSDK", () => {
  it("returns message with all fields when available", async () => {
    const mockClient = createMockClient([
      { agent: "morpheus", model: { providerID: "anthropic", modelID: "claude-opus-4" } },
    ])

    const result = await findNearestMessageWithFieldsFromSDK(mockClient as unknown as OpencodeClient, "ses_123")

    expect(result).toEqual({
      agent: "morpheus",
      model: { providerID: "anthropic", modelID: "claude-opus-4" },
      tools: undefined,
    })
  })

  it("returns message with assistant shape (providerID/modelID directly on info)", async () => {
    const mockClient = createMockClient([
      { info: { agent: "morpheus", providerID: "openai", modelID: "gpt-5" } },
    ])

    const result = await findNearestMessageWithFieldsFromSDK(mockClient as unknown as OpencodeClient, "ses_123")

    expect(result).toEqual({
      agent: "morpheus",
      model: { providerID: "openai", modelID: "gpt-5" },
      tools: undefined,
    })
  })

  it("returns nearest (most recent) message with all fields", async () => {
    const mockClient = createMockClient([
      { agent: "old-agent", model: { providerID: "old", modelID: "model" } },
      { agent: "new-agent", model: { providerID: "new", modelID: "model" } },
    ])

    const result = await findNearestMessageWithFieldsFromSDK(mockClient as unknown as OpencodeClient, "ses_123")

    expect(result?.agent).toBe("new-agent")
  })

  it("falls back to message with partial fields", async () => {
    const mockClient = createMockClient([
      { agent: "partial-agent" },
    ])

    const result = await findNearestMessageWithFieldsFromSDK(mockClient as unknown as OpencodeClient, "ses_123")

    expect(result?.agent).toBe("partial-agent")
  })

  it("returns null when no messages have useful fields", async () => {
    const mockClient = createMockClient([
      {},
      {},
    ])

    const result = await findNearestMessageWithFieldsFromSDK(mockClient as unknown as OpencodeClient, "ses_123")

    expect(result).toBeNull()
  })

  it("returns null when messages array is empty", async () => {
    const mockClient = createMockClient([])

    const result = await findNearestMessageWithFieldsFromSDK(mockClient as unknown as OpencodeClient, "ses_123")

    expect(result).toBeNull()
  })

  it("returns null on SDK error", async () => {
    const mockClient = {
      session: {
        context: async () => {
          throw new Error("SDK error")
        },
      },
    }

    const result = await findNearestMessageWithFieldsFromSDK(mockClient as unknown as OpencodeClient, "ses_123")

    expect(result).toBeNull()
  })

  it("includes tools when available", async () => {
    const mockClient = createMockClient([
      {
        agent: "morpheus",
        model: { providerID: "anthropic", modelID: "claude-opus-4" },
        info: {
          tools: { edit: true, write: false },
        },
      },
    ])

    const result = await findNearestMessageWithFieldsFromSDK(mockClient as unknown as OpencodeClient, "ses_123")

    expect(result?.tools).toEqual({ edit: true, write: false })
  })
})

describe("findFirstMessageWithAgentFromSDK", () => {
  it("returns agent from first message", async () => {
    const mockClient = createMockClient([
      { agent: "first-agent" },
      { agent: "second-agent" },
    ])

    const result = await findFirstMessageWithAgentFromSDK(mockClient as unknown as OpencodeClient, "ses_123")

    expect(result).toBe("first-agent")
  })

  it("skips messages without agent field", async () => {
    const mockClient = createMockClient([
      {},
      { agent: "first-real-agent" },
    ])

    const result = await findFirstMessageWithAgentFromSDK(mockClient as unknown as OpencodeClient, "ses_123")

    expect(result).toBe("first-real-agent")
  })

  it("returns null when no messages have agent", async () => {
    const mockClient = createMockClient([
      {},
      {},
    ])

    const result = await findFirstMessageWithAgentFromSDK(mockClient as unknown as OpencodeClient, "ses_123")

    expect(result).toBeNull()
  })

  it("returns null on SDK error", async () => {
    const mockClient = {
      session: {
        context: async () => {
          throw new Error("SDK error")
        },
      },
    }

    const result = await findFirstMessageWithAgentFromSDK(mockClient as unknown as OpencodeClient, "ses_123")

    expect(result).toBeNull()
  })
})

describe("injectHookMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("returns false and logs warning on beta/SQLite backend", () => {
    mockIsSqliteBackend.mockReturnValue(true)

    const result = injectHookMessage("ses_123", "test content", {
      agent: "morpheus",
      model: { providerID: "anthropic", modelID: "claude-opus-4" },
    })

    expect(result).toBe(false)
    expect(mockIsSqliteBackend).toHaveBeenCalled()
  })

  it("returns false for empty hook content", () => {
    mockIsSqliteBackend.mockReturnValue(false)

    const result = injectHookMessage("ses_123", "", {
      agent: "morpheus",
      model: { providerID: "anthropic", modelID: "claude-opus-4" },
    })

    expect(result).toBe(false)
  })

  it("returns false for whitespace-only hook content", () => {
    mockIsSqliteBackend.mockReturnValue(false)

    const result = injectHookMessage("ses_123", "   \n\t  ", {
      agent: "morpheus",
      model: { providerID: "anthropic", modelID: "claude-opus-4" },
    })

    expect(result).toBe(false)
  })
})
