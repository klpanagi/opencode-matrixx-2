import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEFAULT_KNOWLEDGE_EXCLUDES } from "../../../src/config/schema/knowledge"
import { expandHubPath, loadKnowledgeHubs } from "../../../src/features/knowledge-hub/loader"

describe("expandHubPath", () => {
  it("expands a bare tilde to the home directory", () => {
    expect(expandHubPath("~")).toBe(os.homedir())
  })

  it("expands a tilde-prefixed path under the home directory", () => {
    expect(expandHubPath("~/docs/kb")).toBe(join(os.homedir(), "docs/kb"))
  })

  it("expands $VAR and ${VAR} from process.env", () => {
    process.env.KH_TEST_VAR = "myval"
    try {
      expect(expandHubPath("$KH_TEST_VAR/sub", "/base")).toBe(join("/base", "myval/sub"))
      expect(expandHubPath("${KH_TEST_VAR}/sub", "/base")).toBe(join("/base", "myval/sub"))
    } finally {
      delete process.env.KH_TEST_VAR
    }
  })

  it("expands a missing variable to an empty string", () => {
    delete process.env.KH_DEFINITELY_MISSING_VAR
    expect(expandHubPath("prefix-$KH_DEFINITELY_MISSING_VAR-suffix", "/base")).toBe(
      join("/base", "prefix--suffix")
    )
  })
})

describe("loadKnowledgeHubs", () => {
  it("skips a hub whose root directory is missing without throwing", () => {
    const loaded = loadKnowledgeHubs(
      { hubs: [{ name: "ghost", path: "/nonexistent-kh-9f31/root", index: "_index.md", scope: "global", mode: "router-only", exclude: [] }] },
      tmpdir()
    )
    expect(loaded).toEqual([])
  })

  it("keeps a hub whose index file is missing, flagged indexPresent: false", () => {
    //#given a hub root without its index file
    const root = mkdtempSync(join(tmpdir(), "kh-noindex-"))
    //#when loading the hubs
    const loaded = loadKnowledgeHubs(
      { hubs: [{ name: "noindex", path: root, index: "_index.md", scope: "global", mode: "router-only", exclude: [] }] }
    )
    //#then the hub survives with its index flagged absent, so a later-appearing index still injects
    expect(loaded).toHaveLength(1)
    expect(loaded[0].root).toBe(root)
    expect(loaded[0].indexPath).toBe(join(root, "_index.md"))
    expect(loaded[0].indexPresent).toBe(false)
    expect(loaded[0].pinnedFiles).toEqual([])
  })

  it("loads a valid hub and merges excludes deduped", () => {
    const root = mkdtempSync(join(tmpdir(), "kh-valid-"))
    writeFileSync(join(root, "_index.md"), "# index")
    const loaded = loadKnowledgeHubs(
      {
        hubs: [
          { name: "kb", path: root, index: "_index.md", scope: "global", mode: "router-only", exclude: ["*.env", "custom/**"] },
        ],
      }
    )
    expect(loaded).toHaveLength(1)
    expect(loaded[0].root).toBe(root)
    expect(loaded[0].indexPath).toBe(join(root, "_index.md"))
    expect(loaded[0].indexPresent).toBe(true)
    expect(loaded[0].pinnedFiles).toEqual([])
    expect(loaded[0].exclude).toContain("custom/**")
    for (const entry of DEFAULT_KNOWLEDGE_EXCLUDES) {
      expect(loaded[0].exclude).toContain(entry)
    }
    expect(loaded[0].exclude.filter((e) => e === "*.env")).toHaveLength(1)
  })

  it("accepts a bare hubs array and resolves relative paths against projectDir", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kh-proj-"))
    const hubDir = join(projectDir, "kb")
    mkdirSync(hubDir)
    writeFileSync(join(hubDir, "_index.md"), "# index")
    const loaded = loadKnowledgeHubs(
      [{ name: "kb", path: "kb", index: "_index.md", scope: "project", mode: "pinned", exclude: [] }],
      projectDir
    )
    expect(loaded).toHaveLength(1)
    expect(loaded[0].root).toBe(hubDir)
    expect(loaded[0].scope).toBe("project")
    expect(loaded[0].mode).toBe("pinned")
  })
})
