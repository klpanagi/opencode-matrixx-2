import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import type { MatrixxConfig } from "../../../src/config"
import { ContextCollector } from "../../../src/features/context-injection/injector"
import { buildKnowledgeHubDeps } from "../../../src/features/knowledge-hub/deps"
import { registerMessageHooks } from "../../../src/plugin/message-hooks"
import { _resetKnowledgeHubInjectorForTesting } from "../../../src/plugin/message-hooks/knowledge-hub-injector"
import type { MatrixxContext } from "../../../src/plugin/tool/context"

const INDEX_MARKER = "ROUTER-INDEX-CONTENT-abc123"

const tmpRoots: string[] = []
afterEach(() => {
  _resetKnowledgeHubInjectorForTesting()
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop() as string
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeRecordingCtx(): {
  ctx: MatrixxContext
  seen: Array<{ kind: string; cb: (event: never) => Promise<void> }>
} {
  //#given a session double that records every hook registration
  const seen: Array<{ kind: string; cb: (event: never) => Promise<void> }> = []
  const ctx = {
    session: {
      hook: async (kind: string, cb: (event: never) => Promise<void>) => {
        seen.push({ kind, cb })
        return { dispose: async () => {} }
      },
    },
  } as unknown as MatrixxContext
  return { ctx, seen }
}

function makeProjectWithHub(): { projectDir: string; hubDir: string } {
  const projectDir = mkdtempSync(path.join(tmpdir(), "kh-e2e-"))
  tmpRoots.push(projectDir)
  const hubDir = path.join(projectDir, "kb")
  mkdirSync(hubDir)
  writeFileSync(path.join(hubDir, "_index.md"), `# Hub\n\n${INDEX_MARKER}\n`)
  return { projectDir, hubDir }
}

function configFor(hubDir: string): MatrixxConfig {
  return {
    knowledge: {
      hubs: [
        {
          name: "kb",
          path: hubDir,
          index: "_index.md",
          scope: "global",
          mode: "router-only",
          exclude: [],
        },
      ],
    },
  } as MatrixxConfig
}

const userEvent = { sessionID: "ses_e2e", messages: [{ type: "user", text: "hello" }] }

describe("knowledge-hub end-to-end injection through the real registry", () => {
  test("injects root/index through registerMessageHooks with real deps", async () => {
    //#given a configured hub on disk and deps built from the real config
    const { projectDir, hubDir } = makeProjectWithHub()
    const collector = new ContextCollector()
    const deps = buildKnowledgeHubDeps(configFor(hubDir), projectDir, { hookEnabled: true, collector })
    expect(deps).toBeDefined()
    const { ctx, seen } = makeRecordingCtx()
    //#when registering through the real registry and firing every context callback
    const registrations = await registerMessageHooks(ctx, { knowledgeHub: deps })
    expect(registrations).toHaveLength(11)
    for (const entry of seen) {
      if (entry.kind !== "context") continue
      await entry.cb(userEvent as never)
    }
    //#then the collector holds the routed index with both absolute paths
    const merged = collector.getPending("ses_e2e").merged
    expect(merged).toContain("<knowledge-hub")
    expect(merged).toContain('root="')
    expect(merged).toContain('index="')
    expect(merged).toContain(hubDir)
    expect(merged).toContain(INDEX_MARKER)
  })

  test("registers 10 hooks and injects nothing without deps", async () => {
    //#given a fresh shared collector and no knowledge-hub deps
    const collector = new ContextCollector()
    const { ctx, seen } = makeRecordingCtx()
    //#when registering without deps and firing every context callback
    const registrations = await registerMessageHooks(ctx, { contextInjector: { collector } })
    expect(registrations).toHaveLength(10)
    for (const entry of seen) {
      if (entry.kind !== "context") continue
      await entry.cb(userEvent as never)
    }
    //#then nothing reaches the collector
    expect(collector.getPending("ses_e2e").merged).toBe("")
    expect(collector.getPending("ses_e2e").hasContent).toBe(false)
  })
})
