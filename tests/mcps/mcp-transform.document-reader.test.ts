/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  buildBuiltinMcpEntries,
  DOCUMENT_READER_DISABLED_NOTICE,
} from "../../src/mcps/mcp.transform"

describe("buildBuiltinMcpEntries — document_reader security gating", () => {
  test("default config (documentReader unset) ⇒ no document_reader entry even with uvx", () => {
    //#given document-reader MCP is disabled by default, uvx present
    //#when
    const { entries, failures } = buildBuiltinMcpEntries({ uvxAvailable: true })
    //#then the entry is omitted and no failure is recorded
    expect(entries).not.toHaveProperty("document_reader")
    expect(failures).toHaveLength(0)
  })

  test("default config ⇒ one-line notice naming the fix", () => {
    //#given / #when
    const { notices } = buildBuiltinMcpEntries({ uvxAvailable: true })
    //#then
    expect(notices).toEqual([DOCUMENT_READER_DISABLED_NOTICE])
    expect(notices[0]).toContain("document_reader disabled by default")
    expect(notices[0]).toContain("security.document_reader.enabled")
  })

  test("documentReader {enabled:false} ⇒ no entry, notice pushed", () => {
    //#given explicitly disabled via config
    //#when
    const { entries, notices } = buildBuiltinMcpEntries({
      uvxAvailable: true,
      documentReader: { enabled: false },
    })
    //#then
    expect(entries).not.toHaveProperty("document_reader")
    expect(notices).toEqual([DOCUMENT_READER_DISABLED_NOTICE])
  })

  test("documentReader {enabled:true} + uvx ⇒ entry present and enabled", () => {
    //#given / #when
    const { entries, failures, notices } = buildBuiltinMcpEntries({
      uvxAvailable: true,
      documentReader: { enabled: true },
    })
    //#then
    const dr = entries.document_reader as { type: "local"; command: string[]; enabled: boolean }
    expect(dr.enabled).toBe(true)
    expect(dr.type).toBe("local")
    expect(dr.command).toContain("markitdown-mcp")
    expect(failures).toHaveLength(0)
    expect(notices).toHaveLength(0)
  })

  test("documentReader {enabled:true} without uvx ⇒ existing DISABLED_LOCAL_STUB behaviour + uvx failure", () => {
    //#given opt-in but uvx missing
    //#when
    const { entries, failures, notices } = buildBuiltinMcpEntries({
      uvxAvailable: false,
      documentReader: { enabled: true },
    })
    //#then the disabled stub stays so the V2 sanitizer maps it to disabled:true
    const dr = entries.document_reader as { type: "local"; command: string[]; enabled: boolean }
    expect(dr.enabled).toBe(false)
    expect(dr.type).toBe("local")
    expect(dr.command).toEqual([])
    expect(failures).toHaveLength(1)
    expect(failures[0].name).toBe("document_reader")
    expect(failures[0].error).toContain("uvx")
    expect(notices).toHaveLength(0)
  })

  test("disabledMcps document_reader wins over {enabled:true} ⇒ no entry, no notice, no failure", () => {
    //#given / #when
    const { entries, failures, notices } = buildBuiltinMcpEntries({
      uvxAvailable: true,
      disabledMcps: ["document_reader"],
      documentReader: { enabled: true },
    })
    //#then
    expect(entries).not.toHaveProperty("document_reader")
    expect(failures).toHaveLength(0)
    expect(notices).toHaveLength(0)
  })
})
