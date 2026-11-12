/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test"
import { documentReaderSkill } from "../../../src/skills/builtin/core/document-reader"
import { rpResearchSkill } from "../../../src/skills/builtin/core/rp-research"
import {
  FALLBACK_MESSAGE,
  GUARDED_TOOLS,
  NUDGE_MESSAGE,
} from "../../../src/hooks/docs-lookup-guard/constants"
import {
  BASH_BLOCK_MESSAGE,
  READ_BLOCK_MESSAGE,
} from "../../../src/hooks/document-reader-guard/constants"

describe("naming consistency: document_reader surfaces", () => {
  test("skill template uses canonical document_reader__convert_to_markdown", async () => {
    //#given the document-reader skill template
    const template = documentReaderSkill.template

    //#when inspecting tool references
    //#then the canonical double-underscore name is used
    expect(template).toContain("document_reader__convert_to_markdown")
  })

  test("skill template has no bare convert_to_markdown reference", async () => {
    //#given the document-reader skill template
    const template = documentReaderSkill.template

    //#when inspecting tool references
    //#then no bare backtick-wrapped short name remains
    expect(template.includes("`convert_to_markdown`")).toBe(false)
  })

  test("skill description uses canonical document_reader__convert_to_markdown", async () => {
    //#given the document-reader skill description
    const description = documentReaderSkill.description

    //#when inspecting tool references
    //#then the canonical double-underscore name is used
    expect(description).toContain("document_reader__convert_to_markdown")
  })

  test("document-reader-guard messages use canonical name, no bare call", async () => {
    //#given the guard redirect messages
    const messages = [READ_BLOCK_MESSAGE, BASH_BLOCK_MESSAGE]

    //#when inspecting tool references
    //#then both use the canonical name and neither uses the bare call form
    for (const message of messages) {
      expect(message).toContain("document_reader__convert_to_markdown")
    }
    expect(READ_BLOCK_MESSAGE.includes("Call convert_to_markdown")).toBe(false)
  })
})

describe("naming consistency: context7 surfaces", () => {
  test("guarded tools are the verbatim registered context7_* names", async () => {
    //#given the docs-lookup-guard tool set
    //#when inspecting membership
    //#then all three registered names are guarded verbatim
    expect(GUARDED_TOOLS.has("context7_resolve-library-id")).toBe(true)
    expect(GUARDED_TOOLS.has("context7_query-docs")).toBe(true)
    expect(GUARDED_TOOLS.has("context7_get-library-docs")).toBe(true)
  })

  test("NUDGE and FALLBACK reference canonical context7_* names", async () => {
    //#given the guard user-facing messages
    const messages = [NUDGE_MESSAGE, FALLBACK_MESSAGE]

    //#when inspecting tool references
    //#then canonical registered names appear in both
    for (const message of messages) {
      expect(message).toContain("context7_resolve-library-id")
      expect(message).toContain("context7_query-docs")
    }
    expect(NUDGE_MESSAGE).toContain("context7_get-library-docs")
  })

  test("rp-research template uses canonical context7_* names", async () => {
    //#given the rp-research skill template
    const template = rpResearchSkill.template

    //#when inspecting the delegate-via-operator instruction
    //#then fully-qualified registered names are used, not bare short names
    expect(template).toContain("context7_resolve-library-id then context7_query-docs")
    expect(template.includes("(resolve-library-id then query-docs)")).toBe(false)
  })

  test("rp-research allowedTools use verbatim registered names", async () => {
    //#given the rp-research allowed tools
    //#when inspecting membership
    //#then verbatim registered names are listed
    expect(rpResearchSkill.allowedTools).toContain("context7_resolve-library-id")
    expect(rpResearchSkill.allowedTools).toContain("context7_query-docs")
  })
})
