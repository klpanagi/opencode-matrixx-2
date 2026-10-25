/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { applyFormatterConfig } from "../../src/plugin-handlers/formatter-config-handler"

describe("applyFormatterConfig (D2: native formatter pipeline)", () => {
  test("preserves user-declared formatter entries untouched", () => {
    //#given a user formatter config
    const userFormatter = {
      biome: { command: ["npx", "biome", "format", "$FILE"], extensions: [".ts"] },
    }
    const config: Record<string, unknown> = { formatter: userFormatter }

    //#when the handler runs
    applyFormatterConfig({ config })

    //#then the entries pass through by reference
    expect(config.formatter).toBe(userFormatter)
  })

  test("respects an explicit user opt-out (formatter: false)", () => {
    //#given an explicit user opt-out
    const config: Record<string, unknown> = { formatter: false }

    //#when the handler runs
    applyFormatterConfig({ config })

    //#then the opt-out is not overridden
    expect(config.formatter).toBe(false)
  })

  test("leaves undefined formatter alone so core defaults apply", () => {
    //#given no formatter key
    const config: Record<string, unknown> = {}

    //#when the handler runs
    applyFormatterConfig({ config })

    //#then nothing is added
    expect("formatter" in config).toBe(false)
    expect(Object.keys(config)).toHaveLength(0)
  })

  test("never touches sibling config keys", () => {
    //#given unrelated config
    const config: Record<string, unknown> = { mcp: {}, command: {} }

    //#when the handler runs
    applyFormatterConfig({ config })

    //#then siblings are unchanged
    expect(config).toEqual({ mcp: {}, command: {} })
  })
})
