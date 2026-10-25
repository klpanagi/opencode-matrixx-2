import { describe, expect, test } from "bun:test"
import { createBuiltinMcps } from "../../src/mcps/index"

// NOTE: post remove-custom-websearch-mcp plan, only 2 built-ins remain:
// context7 + document_reader. Config arg is ignored (legacy shim lives in plugin-config).

describe("createBuiltinMcps — { mcps, failures } contract (no websearch)", () => {
  test("returns { mcps, failures } shape with 2 MCPs when healthy", () => {
    //#given
    const disabledMcps: string[] = []

    //#when
    const result = createBuiltinMcps(disabledMcps, undefined, {
      isCommandAvailable: () => true,
    })

    //#then
    expect(result).toHaveProperty("mcps")
    expect(result).toHaveProperty("failures")
    expect(result.mcps).not.toHaveProperty("websearch")
    expect(result.mcps).toHaveProperty("context7")
    expect(result.mcps).toHaveProperty("document_reader")
    expect(Object.keys(result.mcps)).toHaveLength(2)
    expect(result.failures).toHaveLength(0)
  })

  test("legacy websearch config key is ignored, no failure recorded", () => {
    //#given - old config still carrying removed websearch key
    const config = { websearch: { provider: "tavily" } } as unknown as Parameters<typeof createBuiltinMcps>[1]

    //#when
    let result: ReturnType<typeof createBuiltinMcps>
    expect(() => {
      result = createBuiltinMcps([], config, { isCommandAvailable: () => true })
    }).not.toThrow()

    result = createBuiltinMcps([], config, { isCommandAvailable: () => true })

    //#then - websearch absent, others intact, no failures
    expect(result!.mcps).not.toHaveProperty("websearch")
    expect(result!.mcps).toHaveProperty("context7")
    expect(result!.mcps).toHaveProperty("document_reader")
    expect(result!.failures).toHaveLength(0)
  })

  test("filters out disabled built-in MCPs", () => {
    //#given
    const disabledMcps = ["context7"]

    //#when
    const result = createBuiltinMcps(disabledMcps, undefined, {
      isCommandAvailable: () => true,
    })

    //#then
    expect(result.mcps).not.toHaveProperty("websearch")
    expect(result.mcps).not.toHaveProperty("context7")
    expect(result.mcps).toHaveProperty("document_reader")
    expect(Object.keys(result.mcps)).toHaveLength(1)
    expect(result.failures).toHaveLength(0)
  })

  test("filters out all built-in MCPs when all disabled", () => {
    //#given
    const disabledMcps = ["context7", "document_reader"]

    //#when
    const result = createBuiltinMcps([], disabledMcps as unknown as undefined, {
      isCommandAvailable: () => true,
    })
    const result2 = createBuiltinMcps(disabledMcps, undefined, {
      isCommandAvailable: () => true,
    })

    //#then
    expect(Object.keys(result2.mcps)).toHaveLength(0)
    expect(result2.failures).toHaveLength(0)
    expect(result).toBeDefined()
  })

  test("ignores unknown MCP names in disabled_mcps", () => {
    //#given
    const disabledMcps = ["context7", "playwright", "custom", "websearch"]

    //#when
    const result = createBuiltinMcps(disabledMcps, undefined, {
      isCommandAvailable: () => true,
    })

    //#then
    expect(result.mcps).not.toHaveProperty("websearch")
    expect(result.mcps).not.toHaveProperty("context7")
    expect(result.mcps).toHaveProperty("document_reader")
    expect(Object.keys(result.mcps)).toHaveLength(1)
  })
})

describe("createBuiltinMcps — defensive creation", () => {
  test("uvx missing: document_reader becomes disabled stub, failure recorded, others intact", () => {
    //#given
    const result = createBuiltinMcps([], undefined, {
      isCommandAvailable: (cmd) => cmd !== "uvx",
    })

    //#then
    expect(result.mcps.document_reader.enabled).toBe(false)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].name).toBe("document_reader")
    expect(result.failures[0].error).toContain("uvx")
    expect(result.mcps).toHaveProperty("context7")
    expect(result.mcps).not.toHaveProperty("websearch")
  })

  test("uvx present: document_reader stays enabled, no failure", () => {
    //#given
    const result = createBuiltinMcps([], undefined, {
      isCommandAvailable: () => true,
    })

    //#then
    expect(result.mcps.document_reader.enabled).toBe(true)
    expect(result.failures).toHaveLength(0)
  })

  test("disabled document_reader via disabled_mcps: no failure recorded for it", () => {
    //#given / #when
    const result = createBuiltinMcps(["document_reader"], undefined, {
      isCommandAvailable: () => false,
    })

    //#then
    expect(result.mcps).not.toHaveProperty("document_reader")
    expect(result.failures).toHaveLength(0)
  })
})
