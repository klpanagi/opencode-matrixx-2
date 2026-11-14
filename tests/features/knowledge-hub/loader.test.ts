import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEFAULT_KNOWLEDGE_EXCLUDES } from "../../../src/config/schema/knowledge"
import { expandHubPath, hasUnsetEnvVar, loadKnowledgeHubs } from "../../../src/features/knowledge-hub/loader"

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

describe("hasUnsetEnvVar", () => {
  it("detects a bare reference to an unset variable", () => {
    //#given
    delete process.env.KH_UNSET_BARE

    //#when
    const result = hasUnsetEnvVar("$KH_UNSET_BARE/kb")

    //#then
    expect(result).toBe(true)
  })

  it("detects a braced reference to an unset variable", () => {
    //#given
    delete process.env.KH_UNSET_BRACED

    //#when
    const result = hasUnsetEnvVar("${KH_UNSET_BRACED}/kb")

    //#then
    expect(result).toBe(true)
  })

  it("treats a defined variable as set", () => {
    //#given
    process.env.KH_DEFINED_VAR = "/tmp/kb"
    try {
      //#when
      const result = hasUnsetEnvVar("$KH_DEFINED_VAR")

      //#then
      expect(result).toBe(false)
    } finally {
      delete process.env.KH_DEFINED_VAR
    }
  })

  it("treats an empty-string variable as set", () => {
    //#given
    process.env.KH_EMPTY_VAR = ""
    try {
      //#when
      const result = hasUnsetEnvVar("${KH_EMPTY_VAR}/kb")

      //#then
      expect(result).toBe(false)
    } finally {
      delete process.env.KH_EMPTY_VAR
    }
  })

  it("returns false for a path with no variable reference", () => {
    expect(hasUnsetEnvVar("~/docs/kb")).toBe(false)
  })
})

describe("loadKnowledgeHubs", () => {
  it("skips a hub whose root directory is missing without throwing", () => {
    const loaded = loadKnowledgeHubs(
      {
        hubs: [
          {
            name: "ghost",
            path: "/nonexistent-kh-9f31/root",
            index: "_index.md",
            scope: "global",
            mode: "router-only",
            exclude: [],
            pinnedFiles: [],
          },
        ],
      },
      tmpdir()
    )
    expect(loaded).toEqual([])
  })

  it("skips a hub whose path references an unset variable", () => {
    //#given
    delete process.env.KH_UNSET_HUB_DIR
    const projectDir = mkdtempSync(join(tmpdir(), "kh-unset-"))

    //#when
    const loaded = loadKnowledgeHubs(
      {
        hubs: [
          {
            name: "unset",
            path: "$KH_UNSET_HUB_DIR/kb",
            index: "_index.md",
            scope: "global",
            mode: "router-only",
            exclude: [],
            pinnedFiles: [],
          },
        ],
      },
      projectDir
    )

    //#then
    expect(loaded).toEqual([])
  })

  it("keeps a hub whose variable is set but empty and expands it per existing semantics", () => {
    //#given
    process.env.KH_EMPTY_HUB_DIR = ""
    const projectDir = mkdtempSync(join(tmpdir(), "kh-emptyvar-"))
    const hubDir = join(projectDir, "kb")
    mkdirSync(hubDir)
    writeFileSync(join(hubDir, "_index.md"), "# index")
    try {
      //#when
      const loaded = loadKnowledgeHubs(
        {
          hubs: [
            {
              name: "emptyvar",
              path: "kb$KH_EMPTY_HUB_DIR",
              index: "_index.md",
              scope: "global",
              mode: "router-only",
              exclude: [],
              pinnedFiles: [],
            },
          ],
        },
        projectDir
      )

      //#then
      expect(loaded).toHaveLength(1)
      expect(loaded[0].root).toBe(hubDir)
      expect(loaded[0].indexPresent).toBe(true)
    } finally {
      delete process.env.KH_EMPTY_HUB_DIR
    }
  })

  it("keeps a hub whose index file is missing, flagged indexPresent: false", () => {
    //#given a hub root without its index file
    const root = mkdtempSync(join(tmpdir(), "kh-noindex-"))
    //#when loading the hubs
    const loaded = loadKnowledgeHubs({
      hubs: [
        {
          name: "noindex",
          path: root,
          index: "_index.md",
          scope: "global",
          mode: "router-only",
          exclude: [],
          pinnedFiles: [],
        },
      ],
    })
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
    const loaded = loadKnowledgeHubs({
      hubs: [
        {
          name: "kb",
          path: root,
          index: "_index.md",
          scope: "global",
          mode: "router-only",
          exclude: ["*.env", "custom/**"],
          pinnedFiles: [],
        },
      ],
    })
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

  it("propagates configured pinnedFiles into the loaded hub", () => {
    //#given
    const root = mkdtempSync(join(tmpdir(), "kh-pinned-"))
    writeFileSync(join(root, "_index.md"), "# index")

    //#when
    const loaded = loadKnowledgeHubs({
      hubs: [
        {
          name: "kb",
          path: root,
          index: "_index.md",
          scope: "global",
          mode: "pinned",
          exclude: [],
          pinnedFiles: ["pinned/a.md", "pinned/b.md"],
        },
      ],
    })

    //#then
    expect(loaded[0].pinnedFiles).toEqual(["pinned/a.md", "pinned/b.md"])
  })

  it("accepts a bare hubs array and resolves relative paths against projectDir", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kh-proj-"))
    const hubDir = join(projectDir, "kb")
    mkdirSync(hubDir)
    writeFileSync(join(hubDir, "_index.md"), "# index")
    const loaded = loadKnowledgeHubs(
      [
        {
          name: "kb",
          path: "kb",
          index: "_index.md",
          scope: "project",
          mode: "pinned",
          exclude: [],
          pinnedFiles: [],
        },
      ],
      projectDir
    )
    expect(loaded).toHaveLength(1)
    expect(loaded[0].root).toBe(hubDir)
    expect(loaded[0].scope).toBe("project")
    expect(loaded[0].mode).toBe("pinned")
  })
})
