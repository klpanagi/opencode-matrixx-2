import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test"
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import type { SessionContextCarrier } from "../../../../src/features/context-injection/hook-bridge"
import {
  findFirstMessageWithAgentFromSDK,
  findNearestMessageWithFieldsFromSDK,
  injectHookMessage,
} from "../../../../src/features/context-injection/hook-bridge"
import { MESSAGE_STORAGE, PART_STORAGE } from "../../../../src/features/context-injection/hook-bridge/constants"

//#region Mocks

const mockIsSqliteBackend = vi.fn()

vi.mock("../../../../src/shared/config/opencode-storage-detection", () => ({
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

    const result = await findNearestMessageWithFieldsFromSDK(mockClient as unknown as SessionContextCarrier, "ses_123")

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

    const result = await findNearestMessageWithFieldsFromSDK(mockClient as unknown as SessionContextCarrier, "ses_123")

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

    const result = await findNearestMessageWithFieldsFromSDK(mockClient as unknown as SessionContextCarrier, "ses_123")

    expect(result?.agent).toBe("new-agent")
  })

  it("falls back to message with partial fields", async () => {
    const mockClient = createMockClient([
      { agent: "partial-agent" },
    ])

    const result = await findNearestMessageWithFieldsFromSDK(mockClient as unknown as SessionContextCarrier, "ses_123")

    expect(result?.agent).toBe("partial-agent")
  })

  it("returns null when no messages have useful fields", async () => {
    const mockClient = createMockClient([
      {},
      {},
    ])

    const result = await findNearestMessageWithFieldsFromSDK(mockClient as unknown as SessionContextCarrier, "ses_123")

    expect(result).toBeNull()
  })

  it("returns null when messages array is empty", async () => {
    const mockClient = createMockClient([])

    const result = await findNearestMessageWithFieldsFromSDK(mockClient as unknown as SessionContextCarrier, "ses_123")

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

    const result = await findNearestMessageWithFieldsFromSDK(mockClient as unknown as SessionContextCarrier, "ses_123")

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

    const result = await findNearestMessageWithFieldsFromSDK(mockClient as unknown as SessionContextCarrier, "ses_123")

    expect(result?.tools).toEqual({ edit: true, write: false })
  })
})

describe("findFirstMessageWithAgentFromSDK", () => {
  it("returns agent from first message", async () => {
    const mockClient = createMockClient([
      { agent: "first-agent" },
      { agent: "second-agent" },
    ])

    const result = await findFirstMessageWithAgentFromSDK(mockClient as unknown as SessionContextCarrier, "ses_123")

    expect(result).toBe("first-agent")
  })

  it("skips messages without agent field", async () => {
    const mockClient = createMockClient([
      {},
      { agent: "first-real-agent" },
    ])

    const result = await findFirstMessageWithAgentFromSDK(mockClient as unknown as SessionContextCarrier, "ses_123")

    expect(result).toBe("first-real-agent")
  })

  it("returns null when no messages have agent", async () => {
    const mockClient = createMockClient([
      {},
      {},
    ])

    const result = await findFirstMessageWithAgentFromSDK(mockClient as unknown as SessionContextCarrier, "ses_123")

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

    const result = await findFirstMessageWithAgentFromSDK(mockClient as unknown as SessionContextCarrier, "ses_123")

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

  it("returns false and logs warning on beta/SQLite backend", async () => {
    mockIsSqliteBackend.mockReturnValue(true)

    const result = await injectHookMessage("ses_123", "test content", {
      agent: "morpheus",
      model: { providerID: "anthropic", modelID: "claude-opus-4" },
    })

    expect(result).toBe(false)
    expect(mockIsSqliteBackend).toHaveBeenCalled()
  })

  it("returns false for empty hook content", async () => {
    mockIsSqliteBackend.mockReturnValue(false)

    const result = await injectHookMessage("ses_123", "", {
      agent: "morpheus",
      model: { providerID: "anthropic", modelID: "claude-opus-4" },
    })

    expect(result).toBe(false)
  })

  it("returns false for whitespace-only hook content", async () => {
    mockIsSqliteBackend.mockReturnValue(false)

    const result = await injectHookMessage("ses_123", "   \n\t  ", {
      agent: "morpheus",
      model: { providerID: "anthropic", modelID: "claude-opus-4" },
    })

    expect(result).toBe(false)
  })
})


//#region Async minified JSON writes

const SESSION_ID = "ses_t9_inject_hook_message"
const messageDir = join(MESSAGE_STORAGE, SESSION_ID)

function cleanupInjectedFiles(): void {
  if (!existsSync(messageDir)) return
  for (const file of readdirSync(messageDir)) {
    if (!file.endsWith(".json")) continue
    try {
      const meta = JSON.parse(readFileSync(join(messageDir, file), "utf-8")) as { id?: string }
      if (meta.id && existsSync(join(PART_STORAGE, meta.id))) {
        rmSync(join(PART_STORAGE, meta.id), { recursive: true, force: true })
      }
    } catch {
      // ignore cleanup parse errors
    }
  }
  rmSync(messageDir, { recursive: true, force: true })
}

describe("injectHookMessage async minified JSON writes", () => {
  beforeEach(() => {
    cleanupInjectedFiles()
    mockIsSqliteBackend.mockReturnValue(false)
  })

  afterEach(() => {
    cleanupInjectedFiles()
    vi.clearAllMocks()
  })

  it("writes message and part JSON asynchronously without indentation", async () => {
    //#given a non-empty hook payload on the JSON backend
    //#when injecting the hook message
    const ok = await injectHookMessage(SESSION_ID, "hook content here", {
      agent: "morpheus",
      model: { providerID: "anthropic", modelID: "claude-opus-4", variant: "max" },
      path: { cwd: "/home/user/project", root: "/" },
      tools: { task: true, read: true, write: true, edit: true, bash: true, grep: true, glob: true },
    })

    //#then a message file and its part file are written as compact valid JSON
    expect(ok).toBe(true)
    const messageFiles = readdirSync(messageDir).filter((file) => file.endsWith(".json"))
    expect(messageFiles).toHaveLength(1)
    const rawMeta = readFileSync(join(messageDir, messageFiles[0]), "utf-8")
    const meta = JSON.parse(rawMeta) as Record<string, unknown>
    expect(rawMeta).toBe(JSON.stringify(meta))
    expect(rawMeta).not.toContain("\n")

    const partDir = join(PART_STORAGE, String(meta.id))
    const partFiles = readdirSync(partDir).filter((file) => file.endsWith(".json"))
    expect(partFiles).toHaveLength(1)
    const rawPart = readFileSync(join(partDir, partFiles[0]), "utf-8")
    const part = JSON.parse(rawPart) as Record<string, unknown>
    expect(rawPart).toBe(JSON.stringify(part))
    expect(rawPart).not.toContain("\n")
    expect(part.text).toBe("hook content here")
  })

  it("reduces message metadata bytes by at least 1.3x versus 2-space indentation", async () => {
    //#given a hook payload with message metadata plus a text part
    //#when injecting the hook message
    await injectHookMessage(SESSION_ID, "hook content here", {
      agent: "morpheus",
      model: { providerID: "anthropic", modelID: "claude-opus-4", variant: "max" },
      path: { cwd: "/home/user/project", root: "/" },
      tools: { task: true, read: true, write: true, edit: true, bash: true, grep: true, glob: true },
    })

    //#then the message metadata shrinks by at least 1.3x and the part is smaller
    const messageFiles = readdirSync(messageDir).filter((file) => file.endsWith(".json"))
    const rawMeta = readFileSync(join(messageDir, messageFiles[0]), "utf-8")
    const meta = JSON.parse(rawMeta) as { id: string }
    const partDir = join(PART_STORAGE, String(meta.id))
    const partFiles = readdirSync(partDir).filter((file) => file.endsWith(".json"))
    const rawPart = readFileSync(join(partDir, partFiles[0]), "utf-8")

    const metaReduction =
      Buffer.byteLength(JSON.stringify(JSON.parse(rawMeta), null, 2)) /
      Buffer.byteLength(rawMeta)
    const partReduction =
      Buffer.byteLength(JSON.stringify(JSON.parse(rawPart), null, 2)) /
      Buffer.byteLength(rawPart)

    expect(metaReduction).toBeGreaterThanOrEqual(1.3)
    expect(partReduction).toBeGreaterThan(1)
  })
})

//#endregion