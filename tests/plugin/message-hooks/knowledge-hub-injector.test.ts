import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { ContextCollector } from "../../../src/features/context-injector"
import type { MatrixxContext } from "../../../src/plugin/context"
import {
  _resetKnowledgeHubInjectorForTesting,
  applyKnowledgeHubInjector,
  clearKnowledgeHubSession,
  registerKnowledgeHubInjector,
  type FlatMessageHookEvent,
} from "../../../src/plugin/message-hooks/knowledge-hub-injector"
import type { SessionMessage } from "../../../src/shared/session-message"

const INDEX_MARKER = "ROUTER-INDEX-CONTENT-abc123"
const CORPUS_MARKER = "CORPUS-SECRET-CONTENT-xyz789"
const PINNED_MARKER = "PINNED-FILE-CONTENT-qrs456"

const tmpRoots: string[] = []
afterEach(() => {
  _resetKnowledgeHubInjectorForTesting()
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop() as string
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeCtx(): MatrixxContext {
  return { directory: tmpdir() } as unknown as MatrixxContext
}

function makeHub(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "kb-hub-"))
  tmpRoots.push(root)
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(root, name), content)
  }
  return root
}

function flatUserEvent(sessionID: string): FlatMessageHookEvent {
  return {
    sessionID,
    messages: [{ type: "user", text: "hello" } as SessionMessage],
  }
}

function hookDeps(root: string, extra: { mode?: "router-only" | "pinned"; pinnedFiles?: string[] } = {}) {
  const collector = new ContextCollector()
  return {
    collector,
    deps: {
      getHubs: () => [
        {
          name: "kb",
          path: root,
          index: "_index.md",
          scope: "global" as const,
          mode: extra.mode ?? ("router-only" as const),
          exclude: [],
        },
      ],
      pinnedFiles: extra.pinnedFiles,
      collector,
    },
  }
}

describe("knowledgeHubInjector flat port", () => {
  test("first transform registers router with directive", async () => {
    //#given a hub index on disk and a flat user message
    const root = makeHub({ "_index.md": `# Hub\n\n${INDEX_MARKER}\n`, "notes.md": CORPUS_MARKER })
    const { collector, deps } = hookDeps(root)
    //#when applying the flat port
    await applyKnowledgeHubInjector(flatUserEvent("ses-1"), makeCtx(), deps)
    //#then the router payload lands in the collector, same as the V1 transform
    expect(collector.hasPending("ses-1")).toBe(true)
    const pending = collector.consume("ses-1")
    expect(pending.hasContent).toBe(true)
    expect(pending.merged).toContain(INDEX_MARKER)
    expect(pending.merged).toContain("websearch")
    expect(pending.merged).toContain("@hub/path")
    expect(pending.merged).toContain('<knowledge-hub name="kb">')
  })

  test("second transform in same session does not re-register", async () => {
    //#given a hub and one consumed registration
    const root = makeHub({ "_index.md": INDEX_MARKER })
    const { collector, deps } = hookDeps(root)
    await applyKnowledgeHubInjector(flatUserEvent("ses-1"), makeCtx(), deps)
    collector.consume("ses-1")
    //#when applying the flat port again in the same session
    await applyKnowledgeHubInjector(flatUserEvent("ses-1"), makeCtx(), deps)
    //#then nothing new is registered
    expect(collector.hasPending("ses-1")).toBe(false)
  })

  test("never registers corpus file content", async () => {
    //#given a hub whose index differs from a deep-dive corpus file
    const root = makeHub({ "_index.md": INDEX_MARKER, "deep-dive.md": CORPUS_MARKER })
    const { collector, deps } = hookDeps(root)
    //#when applying the flat port
    await applyKnowledgeHubInjector(flatUserEvent("ses-1"), makeCtx(), deps)
    //#then only the index is registered
    const pending = collector.consume("ses-1")
    expect(pending.merged).toContain(INDEX_MARKER)
    expect(pending.merged).not.toContain(CORPUS_MARKER)
  })

  test("empty hubs register nothing", async () => {
    //#given no configured hubs and a flat user message
    const collector = new ContextCollector()
    //#when applying the flat port
    await applyKnowledgeHubInjector(flatUserEvent("ses-1"), makeCtx(), { collector, getHubs: () => [] })
    //#then the collector stays empty
    expect(collector.hasPending("ses-1")).toBe(false)
  })

  test("skips missing index without throwing", async () => {
    //#given a hub path that does not exist
    const missing = path.join(tmpdir(), "kb-does-not-exist-12345")
    const collector = new ContextCollector()
    //#when applying the flat port
    await applyKnowledgeHubInjector(flatUserEvent("ses-1"), makeCtx(), {
      collector,
      getHubs: () => [
        { name: "ghost", path: missing, index: "_index.md", scope: "global", mode: "router-only", exclude: [] },
      ],
    })
    //#then nothing is registered and nothing throws
    expect(collector.hasPending("ses-1")).toBe(false)
  })

  test("pinned mode registers only explicitly listed files", async () => {
    //#given a pinned-mode hub with an extra corpus file
    const root = makeHub({ "_index.md": INDEX_MARKER, "pinned.md": PINNED_MARKER, "other.md": CORPUS_MARKER })
    const { collector, deps } = hookDeps(root, { mode: "pinned", pinnedFiles: ["pinned.md"] })
    //#when applying the flat port
    await applyKnowledgeHubInjector(flatUserEvent("ses-1"), makeCtx(), deps)
    //#then the index and the pinned file register, the corpus file does not
    const pending = collector.consume("ses-1")
    expect(pending.merged).toContain(INDEX_MARKER)
    expect(pending.merged).toContain(PINNED_MARKER)
    expect(pending.merged).not.toContain(CORPUS_MARKER)
  })

  test("clearKnowledgeHubSession allows re-registration, mirroring compaction/delete reset", async () => {
    //#given a hub and one consumed registration
    const root = makeHub({ "_index.md": INDEX_MARKER })
    const { collector, deps } = hookDeps(root)
    await applyKnowledgeHubInjector(flatUserEvent("ses-1"), makeCtx(), deps)
    collector.consume("ses-1")
    //#when the session cache is cleared (native twin of the V1 session.deleted/compacted reset)
    clearKnowledgeHubSession("ses-1", collector)
    await applyKnowledgeHubInjector(flatUserEvent("ses-1"), makeCtx(), deps)
    //#then the router registers again
    expect(collector.hasPending("ses-1")).toBe(true)
    expect(collector.consume("ses-1").merged).toContain(INDEX_MARKER)
  })

  test("empty messages[] is a no-op that does not throw", async () => {
    //#given an empty flat message list
    const collector = new ContextCollector()
    const root = makeHub({ "_index.md": INDEX_MARKER })
    const { deps } = hookDeps(root)
    //#when applying the flat port
    await applyKnowledgeHubInjector({ sessionID: "ses-1", messages: [] }, makeCtx(), { ...deps, collector })
    //#then nothing is registered and nothing throws
    expect(collector.hasPending("ses-1")).toBe(false)
  })

  test("assistant message with content:[] and no user message does not crash", async () => {
    //#given only an assistant message with an empty content array
    const collector = new ContextCollector()
    const root = makeHub({ "_index.md": INDEX_MARKER })
    const { deps } = hookDeps(root)
    //#when applying the flat port
    await applyKnowledgeHubInjector(
      { sessionID: "ses-1", messages: [{ type: "assistant", content: [] } as SessionMessage] },
      makeCtx(),
      { ...deps, collector },
    )
    //#then nothing throws and nothing registers
    expect(collector.hasPending("ses-1")).toBe(false)
  })

  test("registers on context only, per its mapping-table row", async () => {
    //#given a recording session double
    const seen: Array<{ kind: string; cb: (event: never) => Promise<void> }> = []
    const ctx = {
      directory: tmpdir(),
      session: {
        hook: async (kind: string, cb: (event: never) => Promise<void>) => {
          seen.push({ kind, cb })
          return { dispose: async () => {} }
        },
      },
    } as unknown as MatrixxContext
    //#when registering the flat port
    const registrations = await registerKnowledgeHubInjector(ctx)
    //#then exactly one context registration exists
    expect(seen.map((s) => s.kind)).toEqual(["context"])
    expect(registrations).toHaveLength(1)
    //#when invoking the registered callback with an empty event
    await seen[0].cb({} as never)
    //#then it does not throw (Task 26 empty-input contract)
  })
})
