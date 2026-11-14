/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  DEFAULT_KNOWLEDGE_EXCLUDES,
  KnowledgeConfigSchema,
  KnowledgeHubSchema,
} from "../../../src/config/schema/knowledge"

describe("DEFAULT_KNOWLEDGE_EXCLUDES", () => {
  test("excludes only binary and vendor directories", () => {
    //#given
    const expected = ["*.docx", "*.pptx", "*.zip", "node_modules/**"]

    //#when
    const actual = DEFAULT_KNOWLEDGE_EXCLUDES

    //#then
    expect(actual).toEqual(expected)
  })

  test("no longer hides dotfiles or secret-bearing names", () => {
    //#given
    const excludes = DEFAULT_KNOWLEDGE_EXCLUDES

    //#when
    const matches = excludes.filter(
      (entry) =>
        entry === ".*" ||
        entry.includes(".env") ||
        entry.includes("publisync_env") ||
        entry.includes("alz_mongo_env")
    )

    //#then
    expect(matches).toEqual([])
  })
})

describe("KnowledgeHubSchema", () => {
  test("defaults pinnedFiles to an empty array", () => {
    //#given
    const input = { name: "kb", path: "/tmp/kb" }

    //#when
    const parsed = KnowledgeHubSchema.parse(input)

    //#then
    expect(parsed.pinnedFiles).toEqual([])
  })

  test("defaults the remaining hub fields unchanged", () => {
    //#given
    const input = { name: "kb", path: "/tmp/kb" }

    //#when
    const parsed = KnowledgeHubSchema.parse(input)

    //#then
    expect(parsed.index).toBe("_index.md")
    expect(parsed.scope).toBe("global")
    expect(parsed.mode).toBe("router-only")
    expect(parsed.exclude).toEqual([])
  })

  test("parses pinnedFiles entries", () => {
    //#given
    const input = { name: "kb", path: "/tmp/kb", pinnedFiles: ["a.md", "b/c.md"] }

    //#when
    const parsed = KnowledgeHubSchema.parse(input)

    //#then
    expect(parsed.pinnedFiles).toEqual(["a.md", "b/c.md"])
  })

  test("parses a hub through KnowledgeConfigSchema with pinnedFiles defaults", () => {
    //#given
    const input = { hubs: [{ name: "kb", path: "/tmp/kb" }] }

    //#when
    const parsed = KnowledgeConfigSchema.parse(input)

    //#then
    expect(parsed.hubs[0].pinnedFiles).toEqual([])
  })
})
