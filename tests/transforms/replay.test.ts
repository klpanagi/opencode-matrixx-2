/**
 * D4 QA: transforms are pure and replayable — running registration twice over
 * the same input yields an identical registration set with no duplicate
 * side effects.
 */
import { describe, expect, test } from "bun:test"
import {
  type AgentTransformEditor,
  type AgentTransformInfo,
  registerAgentTransform,
} from "../../src/agents/agents.transform"
import { buildBuiltinCommandEntries, registerCommandTransform } from "../../src/features/builtin-commands/commands.transform"
import { registerSkillTransform } from "../../src/features/builtin-skills/skills.transform"
import { buildBuiltinMcpEntries, registerMcpTransform, toV2McpEntry } from "../../src/mcp/mcp.transform"

function createMapEditor() {
  const store = new Map<string, unknown>()
  const calls: Array<{ op: string; name: string }> = []
  const editor = {
    set(name: string, config: unknown): void {
      calls.push({ op: "set", name })
      store.set(name, config)
    },
    add(entry: unknown): void {
      const record = entry as Record<string, unknown>
      const name = String(record.name)
      calls.push({ op: "add", name })
      store.set(name, record)
    },
  }
  return { editor, store, calls }
}

function createAgentEditor() {
  const store = new Map<string, AgentTransformInfo>()
  let defaultAgent: string | undefined
  const editor: AgentTransformEditor = {
    update(id, fn): void {
      const current = store.get(id) ?? {
        request: {},
        mode: "subagent" as const,
        hidden: false,
        permissions: [],
      }
      fn(current)
      store.set(id, current)
    },
    remove(id): void {
      store.delete(id)
    },
    default(id): void {
      defaultAgent = id
    },
  }
  return { editor, store, getDefault: () => defaultAgent }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => [k, canonicalize(v)]),
    )
  }
  return value
}

function snapshot(store: Map<string, unknown>): string {
  return JSON.stringify(canonicalize([...store.entries()]))
}

describe("mcp transform replay", () => {
  test("double registration over one editor is identical", async () => {
    //#given
    const { entries } = buildBuiltinMcpEntries({ uvxAvailable: true })
    const { editor, store } = createMapEditor()
    const domain = { transform: async (cb: (e: typeof editor) => void) => { cb(editor); return {} } }

    //#when
    await registerMcpTransform(domain, entries)
    const first = snapshot(store)
    await registerMcpTransform(domain, entries)

    //#then
    expect(snapshot(store)).toBe(first)
    expect(store.size).toBe(3)
  })

  test("fresh editors converge on the same set", async () => {
    //#given
    const { entries } = buildBuiltinMcpEntries({ uvxAvailable: false })

    //#when
    const a = createMapEditor()
    const b = createMapEditor()
    await registerMcpTransform({ transform: async (cb) => { cb(a.editor); return {} } }, entries)
    await registerMcpTransform({ transform: async (cb) => { cb(b.editor); return {} } }, entries)

    //#then
    expect(snapshot(a.store)).toBe(snapshot(b.store))
    expect(a.store.get("document_reader")).toMatchObject({ disabled: true, type: "local" })
  })

  test("toV2McpEntry sanitizes V1 shapes", () => {
    //#given/when/then
    expect(toV2McpEntry({ type: "remote", url: "https://x", enabled: false })).toMatchObject({
      type: "remote",
      disabled: true,
    })
    expect(toV2McpEntry({ type: "local", command: ["uvx"], enabled: true, extra: undefined })).toEqual({
      type: "local",
      command: ["uvx"],
    })
    expect(toV2McpEntry({ type: "remote", url: "https://x", headers: "nope" })).toMatchObject({
      type: "remote",
    })
    expect(toV2McpEntry({ nonsense: 1 })).toBeUndefined()
  })
})

describe("command transform replay", () => {
  test("double registration over one editor is identical, disabled filtered", async () => {
    //#given
    const entries = buildBuiltinCommandEntries(["handoff"])
    expect(entries.handoff).toBeUndefined()
    const { editor, store } = createMapEditor()
    const domain = { transform: async (cb: (e: typeof editor) => void) => { cb(editor); return {} } }

    //#when
    const first = await registerCommandTransform(domain, entries)
    const snap = snapshot(store)
    const second = await registerCommandTransform(domain, entries)

    //#then
    expect(snapshot(store)).toBe(snap)
    expect(second.registered).toEqual(first.registered)
    expect(store.size).toBe(Object.keys(entries).length)
  })
})

describe("skill transform replay", () => {
  test("record and array forms converge; double registration identical", async () => {
    //#given
    const draft = {
      "my-skill": { description: "d", template: "t" },
    }
    const asArray = [{ name: "my-skill", description: "d", template: "t" }]

    //#when
    const a = createMapEditor()
    const b = createMapEditor()
    await registerSkillTransform({ transform: async (cb) => { cb(a.editor); return {} } }, draft)
    await registerSkillTransform({ transform: async (cb) => { cb(b.editor); return {} } }, asArray)
    const snap = snapshot(a.store)
    await registerSkillTransform({ transform: async (cb) => { cb(a.editor); return {} } }, draft)

    //#then
    expect(snapshot(b.store)).toBe(snap)
    expect(snapshot(a.store)).toBe(snap)
  })
})

describe("agent transform replay", () => {
  const draft = {
    morpheus: {
      model: { providerID: "anthropic", id: "opus" },
      system: "sys",
      permissions: [{ action: "shell", resource: "*", effect: "deny" as const }],
    },
    retired: { disabled: true },
  }

  test("persistent editor: second run adds nothing", async () => {
    //#given
    const { editor, store, getDefault } = createAgentEditor()
    const domain = { transform: async (cb: (e: AgentTransformEditor) => void) => { cb(editor); return {} } }

    //#when
    await registerAgentTransform(domain, { agents: draft, defaultAgent: "morpheus" })
    const first = snapshot(store)
    const result = await registerAgentTransform(domain, { agents: draft, defaultAgent: "morpheus" })

    //#then
    expect(snapshot(store)).toBe(first)
    expect(store.has("retired")).toBe(false)
    expect(getDefault()).toBe("morpheus")
    expect(result.failures).toEqual([])
    expect(store.get("morpheus")?.permissions).toHaveLength(1)
  })

  test("fresh editors converge on the same set", async () => {
    //#given/when
    const a = createAgentEditor()
    const b = createAgentEditor()
    await registerAgentTransform({ transform: async (cb) => { cb(a.editor); return {} } }, { agents: draft })
    await registerAgentTransform({ transform: async (cb) => { cb(b.editor); return {} } }, { agents: draft })

    //#then
    expect(snapshot(a.store)).toBe(snapshot(b.store))
  })

  test("editor failure surfaces in failures, other entries still register", async () => {
    //#given
    const { store } = createAgentEditor()
    const throwing = {
      update(id: string, _fn: (a: AgentTransformInfo) => void): void {
        if (id === "morpheus") throw new Error("host rejected")
        const rec: AgentTransformInfo = { request: {}, mode: "subagent", hidden: false, permissions: [] }
        store.set(id, rec)
      },
      remove: (_id: string): void => {},
      default: (_id: string | undefined): void => {},
    }

    //#when
    const result = await registerAgentTransform(
      { transform: async (cb) => { cb(throwing); return {} } },
      { agents: { ...draft, other: { system: "s" } } },
    )

    //#then
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].name).toBe("morpheus")
    expect(result.registered).toContain("other")
  })
})
