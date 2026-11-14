import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import type { MatrixxConfig } from "../../../src/config"
import { ContextCollector } from "../../../src/features/context-injection/injector"
import { buildKnowledgeHubDeps } from "../../../src/features/knowledge-hub/deps"

function configWithHubs(hubs: Array<{ name: string; path: string; index: string }>): MatrixxConfig {
  return {
    knowledge: {
      hubs: hubs.map((hub) => ({
        name: hub.name,
        path: hub.path,
        index: hub.index,
        scope: "global" as const,
        mode: "router-only" as const,
        exclude: [],
      })),
    },
  } as MatrixxConfig
}

describe("buildKnowledgeHubDeps", () => {
  test("returns deps when the hook is enabled and one hub is configured", () => {
    //#given a real hub directory with an index on disk
    const projectDir = mkdtempSync(path.join(tmpdir(), "kh-deps-"))
    const hubDir = path.join(projectDir, "kb")
    mkdirSync(hubDir)
    writeFileSync(path.join(hubDir, "_index.md"), "# index\n")
    //#when building deps
    const deps = buildKnowledgeHubDeps(configWithHubs([{ name: "kb", path: hubDir, index: "_index.md" }]), projectDir, {
      hookEnabled: true,
    })
    //#then the deps are defined and expose a real workspace
    expect(deps).toBeDefined()
    expect(deps?.workspaceDir).toBe(projectDir)
  })

  test("returns undefined when the hook is disabled", () => {
    //#given one configured hub
    const projectDir = mkdtempSync(path.join(tmpdir(), "kh-deps-off-"))
    //#when the hook is disabled
    const deps = buildKnowledgeHubDeps(configWithHubs([{ name: "kb", path: "kb", index: "_index.md" }]), projectDir, {
      hookEnabled: false,
    })
    //#then registration is skipped entirely
    expect(deps).toBeUndefined()
  })

  test("returns undefined when no hub is configured", () => {
    //#given an empty knowledge config
    const projectDir = mkdtempSync(path.join(tmpdir(), "kh-deps-empty-"))
    //#when building deps
    const deps = buildKnowledgeHubDeps(configWithHubs([]), projectDir, { hookEnabled: true })
    //#then there is nothing to inject
    expect(deps).toBeUndefined()
  })

  test("gates on configured hubs, not on disk, and resolves them lazily", () => {
    //#given a configured hub whose directory does not exist yet
    const projectDir = mkdtempSync(path.join(tmpdir(), "kh-deps-lazy-"))
    const hubDir = path.join(projectDir, "later")
    //#when building deps
    const deps = buildKnowledgeHubDeps(configWithHubs([{ name: "later", path: hubDir, index: "_index.md" }]), projectDir, {
      hookEnabled: true,
    })
    //#then construction succeeds without touching disk
    expect(deps).toBeDefined()
    expect(deps?.getHubs?.()).toEqual([])
  })

  test("getHubs returns LoadedHub entries with root, indexPath, indexPresent and pinnedFiles", () => {
    //#given a real hub directory with an index
    const projectDir = mkdtempSync(path.join(tmpdir(), "kh-deps-loaded-"))
    const hubDir = path.join(projectDir, "kb")
    mkdirSync(hubDir)
    writeFileSync(path.join(hubDir, "_index.md"), "# index\n")
    //#when the injector asks for hubs
    const deps = buildKnowledgeHubDeps(configWithHubs([{ name: "kb", path: hubDir, index: "_index.md" }]), projectDir, {
      hookEnabled: true,
    })
    const hubs = deps?.getHubs?.() ?? []
    //#then the unified LoadedHub shape is returned
    expect(hubs).toHaveLength(1)
    expect(hubs[0].root).toBe(hubDir)
    expect(hubs[0].indexPath).toBe(path.join(hubDir, "_index.md"))
    expect(hubs[0].indexPresent).toBe(true)
    expect(hubs[0].pinnedFiles).toEqual([])
  })

  test("carries an explicit collector through to the injector deps", () => {
    //#given a collector supplied by the caller
    const collector = new ContextCollector()
    const projectDir = mkdtempSync(path.join(tmpdir(), "kh-deps-collector-"))
    writeFileSync(path.join(projectDir, "_index.md"), "# index\n")
    //#when building deps
    const deps = buildKnowledgeHubDeps(
      configWithHubs([{ name: "kb", path: projectDir, index: "_index.md" }]),
      projectDir,
      { hookEnabled: true, collector },
    )
    //#then the same collector is used for injection
    expect(deps?.collector).toBe(collector)
  })
})
