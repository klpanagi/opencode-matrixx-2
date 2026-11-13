/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import {
  CONTEXT7_QUERY_DOCS,
  CONTEXT7_RESOLVE_LIBRARY_ID,
  DOCUMENT_READER_CONVERT_TO_MARKDOWN,
  getBuiltinMcpToolNames,
} from "../../src/mcps/tool-names"

describe("builtin MCP tool names", () => {
  test("canonical names use a single underscore separator", () => {
    //#given the canonical builtin MCP tool names
    const names = [
      CONTEXT7_RESOLVE_LIBRARY_ID,
      CONTEXT7_QUERY_DOCS,
      DOCUMENT_READER_CONVERT_TO_MARKDOWN,
    ]

    //#when inspecting each name
    //#then each carries exactly one `__`-free server/tool separator
    for (const name of names) {
      expect(name).not.toContain("__")
    }
    expect(CONTEXT7_QUERY_DOCS).toBe("context7_query-docs")
    expect(CONTEXT7_RESOLVE_LIBRARY_ID).toBe("context7_resolve-library-id")
    expect(DOCUMENT_READER_CONVERT_TO_MARKDOWN).toBe(
      "document_reader_convert_to_markdown",
    )
  })

  test("document_reader is the OpenCode v2 single-underscore form, never double", () => {
    //#given the canonical document_reader name
    //#when comparing against the old double-underscore form
    //#then they differ and only the single-underscore form is canonical
    expect(DOCUMENT_READER_CONVERT_TO_MARKDOWN).not.toBe(
      "document_reader__convert_to_markdown",
    )
  })
})

describe("getBuiltinMcpToolNames", () => {
  test("includes context7 and document_reader tools when both are available", () => {
    //#given no servers disabled and uvx available
    //#when resolving builtin MCP tool names
    const names = getBuiltinMcpToolNames({
      disabledMcps: [],
      uvxAvailable: true,
    })

    //#then every builtin MCP tool is listed
    expect(names).toEqual([
      CONTEXT7_RESOLVE_LIBRARY_ID,
      CONTEXT7_QUERY_DOCS,
      DOCUMENT_READER_CONVERT_TO_MARKDOWN,
    ])
  })

  test("omits context7 tools when context7 is disabled", () => {
    //#given context7 disabled in config
    //#when resolving builtin MCP tool names
    const names = getBuiltinMcpToolNames({
      disabledMcps: ["context7"],
      uvxAvailable: true,
    })

    //#then only document_reader remains
    expect(names).toEqual([DOCUMENT_READER_CONVERT_TO_MARKDOWN])
  })

  test("omits document_reader tools when uvx is unavailable", () => {
    //#given uvx is not on PATH
    //#when resolving builtin MCP tool names
    const names = getBuiltinMcpToolNames({
      disabledMcps: [],
      uvxAvailable: false,
    })

    //#then only context7 remains
    expect(names).toEqual([CONTEXT7_RESOLVE_LIBRARY_ID, CONTEXT7_QUERY_DOCS])
  })

  test("returns an empty list when both servers are disabled", () => {
    //#given both builtin servers disabled
    //#when resolving builtin MCP tool names
    const names = getBuiltinMcpToolNames({
      disabledMcps: ["context7", "document_reader"],
      uvxAvailable: true,
    })

    //#then nothing is advertised
    expect(names).toEqual([])
  })
})
