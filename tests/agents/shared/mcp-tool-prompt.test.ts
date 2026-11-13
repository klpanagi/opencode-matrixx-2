/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import {
  buildToolSelectionTable,
  categorizeTools,
} from "../../../src/agents/shared/dynamic-agent-prompt-builder"
import {
  CONTEXT7_QUERY_DOCS,
  CONTEXT7_RESOLVE_LIBRARY_ID,
  DOCUMENT_READER_CONVERT_TO_MARKDOWN,
} from "../../../src/mcps/tool-names"

describe("categorizeTools: builtin MCP tools", () => {
  test("classifies context7 and document_reader tools as mcp", () => {
    //#given builtin MCP tool names alongside a normal tool
    const tools = categorizeTools([
      CONTEXT7_RESOLVE_LIBRARY_ID,
      CONTEXT7_QUERY_DOCS,
      DOCUMENT_READER_CONVERT_TO_MARKDOWN,
      "grep",
    ])

    //#when inspecting categories
    //#then every MCP tool is classified as mcp and grep stays search
    const byName = new Map(tools.map((tool) => [tool.name, tool.category]))
    expect(byName.get(CONTEXT7_RESOLVE_LIBRARY_ID)).toBe("mcp")
    expect(byName.get(CONTEXT7_QUERY_DOCS)).toBe("mcp")
    expect(byName.get(DOCUMENT_READER_CONVERT_TO_MARKDOWN)).toBe("mcp")
    expect(byName.get("grep")).toBe("search")
  })
})

describe("buildToolSelectionTable: builtin MCP tools", () => {
  test("lists MCP tool names in the FREE tools row", () => {
    //#given categorized builtin MCP tools
    const tools = categorizeTools([
      CONTEXT7_RESOLVE_LIBRARY_ID,
      CONTEXT7_QUERY_DOCS,
      DOCUMENT_READER_CONVERT_TO_MARKDOWN,
      "grep",
    ])

    //#when building the tool selection table
    const table = buildToolSelectionTable([], tools)

    //#then the model sees the exact callable MCP tool names
    expect(table).toContain(`\`${CONTEXT7_RESOLVE_LIBRARY_ID}\``)
    expect(table).toContain(`\`${CONTEXT7_QUERY_DOCS}\``)
    expect(table).toContain(`\`${DOCUMENT_READER_CONVERT_TO_MARKDOWN}\``)
    expect(table).toContain("`grep`")
  })

  test("does not advertise MCP tools that were not supplied", () => {
    //#given only context7 tools are available
    const tools = categorizeTools([CONTEXT7_QUERY_DOCS])

    //#when building the table
    const table = buildToolSelectionTable([], tools)

    //#then document_reader is absent
    expect(table).not.toContain(DOCUMENT_READER_CONVERT_TO_MARKDOWN)
  })
})
