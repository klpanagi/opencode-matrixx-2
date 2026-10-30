/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import type { MatrixxContext } from "../../src/plugin/context"
import { createMarketSymbolValidatorTool } from "../../src/tools/market-symbol-validator/tools"

const FIXTURES = join(import.meta.dir, "..", "fixtures", "market-symbol-validator")

type Finding = { rule: string; severity: string; file: string; line: number; symbol: string }
type Result = { status: 0 | 1 | 2; findings: Finding[]; summary: { total: number } }

async function validate(args: Record<string, unknown>): Promise<Result> {
  const tool = createMarketSymbolValidatorTool({ directory: FIXTURES } as unknown as MatrixxContext)
  const output = await tool.market_symbol_validate.execute(args)
  return JSON.parse(output) as Result
}

describe("market_symbol_validate", () => {
  test("flags missing :settle suffix, hardcoded exchange ids, native symbols, and unchecked capability use", async () => {
    //#given a file using a perp without settle suffix, a hardcoded exchange id, a native symbol, and unguarded capability calls
    //#when the validator runs
    const result = await validate({ path: "bad.py" })

    //#then every rule fires and the exit status is errors
    const rules = new Set(result.findings.map((f) => f.rule))
    expect(rules.has("MS001")).toBe(true)
    expect(rules.has("MS002")).toBe(true)
    expect(rules.has("MS004")).toBe(true)
    expect(result.status).toBe(2)
  })

  test("does not flag a file with settle-suffixed symbols and capability guards", async () => {
    //#given a file that uses BTC/USDT:USDT and checks exchange.has before calling
    //#when the validator runs
    const result = await validate({ path: "clean.py" })

    //#then nothing fires
    expect(result.findings).toHaveLength(0)
    expect(result.status).toBe(0)
  })

  test("flags a symbol absent from the provided exchangeMarkets list", async () => {
    //#given a valid settle-suffixed symbol that is not in the allowed market list
    //#when the validator runs
    const result = await validate({
      symbols: ["XRP/USDT:USDT"],
      exchangeMarkets: ["BTC/USDT:USDT", "ETH/USDT:USDT"],
    })

    //#then membership is reported
    expect(result.findings.some((f) => f.rule === "MS003")).toBe(true)
  })

  test("accepts a symbol present in the exchangeMarkets list", async () => {
    //#given a symbol that is allowed
    //#when the validator runs
    const result = await validate({
      symbols: ["BTC/USDT:USDT"],
      exchangeMarkets: ["BTC/USDT:USDT"],
    })

    //#then no membership finding
    expect(result.findings.some((f) => f.rule === "MS003")).toBe(false)
  })

  test("fails closed when no source, path, or symbols are provided", async () => {
    //#given no input
    //#when the validator runs
    const result = await validate({})

    //#then it reports an error rather than a clean pass
    expect(result.status).toBe(2)
  })
})
