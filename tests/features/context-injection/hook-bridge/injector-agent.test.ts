/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test"
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { MESSAGE_STORAGE, PART_STORAGE } from "../../../../src/features/context-injection/hook-bridge/constants"
import { injectHookMessage } from "../../../../src/features/context-injection/hook-bridge/injector"

vi.mock("../../../../src/shared/config/opencode-storage-detection", () => ({
  isSqliteBackend: () => false,
  resetSqliteBackendCache: () => {},
}))

const SESSION_ID = "ses_test_general_never_emitted"

function readInjectedMeta(): Array<Record<string, unknown>> {
  const dir = join(MESSAGE_STORAGE, SESSION_ID)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")) as Record<string, unknown>)
}

function cleanup(): void {
  const dir = join(MESSAGE_STORAGE, SESSION_ID)
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      try {
        const meta = JSON.parse(readFileSync(join(dir, f), "utf-8")) as { id?: string }
        if (meta.id && existsSync(join(PART_STORAGE, meta.id))) {
          rmSync(join(PART_STORAGE, meta.id), { recursive: true, force: true })
        }
      } catch {
        // ignore cleanup parse errors
      }
    }
    rmSync(dir, { recursive: true, force: true })
  }
}

describe("injectHookMessage agent handling (issue #94)", () => {
  beforeEach(() => {
    cleanup()
  })

  afterEach(() => {
    cleanup()
  })

  it("omits agent field when no agent is known", () => {
    //#given no agent on the original message and no fallback
    //#when injecting
    const ok = injectHookMessage(SESSION_ID, "hook content here", {})

    //#then injection succeeds but the persisted message carries no agent
    expect(ok).toBe(true)
    const metas = readInjectedMeta()
    expect(metas).toHaveLength(1)
    expect(metas[0]).not.toHaveProperty("agent")
  })

  it("never persists agent 'general'", () => {
    //#given an explicit general agent
    //#when injecting
    const ok = injectHookMessage(SESSION_ID, "hook content here", { agent: "general" })

    //#then the persisted message omits the agent field
    expect(ok).toBe(true)
    const metas = readInjectedMeta()
    expect(metas).toHaveLength(1)
    expect(metas[0]).not.toHaveProperty("agent")
  })

  it("preserves a real agent", () => {
    //#given a real agent on the original message
    //#when injecting
    const ok = injectHookMessage(SESSION_ID, "hook content here", { agent: "morpheus" })

    //#then the agent is persisted
    expect(ok).toBe(true)
    const metas = readInjectedMeta()
    expect(metas).toHaveLength(1)
    expect(metas[0]).toHaveProperty("agent", "morpheus")
  })
})
