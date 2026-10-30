import { isAbsolute, join } from "node:path"
import type { MatrixxContext } from "../../plugin/context"
import { z } from "zod"
import { defineTool, type MatrixxToolDefinition } from "../shared/define-tool"
import { MARKET_SYMBOL_VALIDATE_DESCRIPTION } from "./constants"
import type { SymbolFinding, SymbolValidationResult } from "./types"
import { buildResult, validatePath, validateSymbols, validateText } from "./validator"

function errorResult(message: string): SymbolValidationResult {
  return {
    status: 2,
    findings: [],
    summary: { filesScanned: 0, total: 0, byRule: {}, note: message },
  }
}

export function createMarketSymbolValidatorTool(ctx: MatrixxContext): Record<string, MatrixxToolDefinition> {
  const market_symbol_validate: MatrixxToolDefinition = defineTool("market_symbol_validate", {
    description: MARKET_SYMBOL_VALIDATE_DESCRIPTION,
    args: {
      source: tool.schema.string().optional().describe("Inline source text to validate."),
      path: tool.schema
        .string()
        .optional()
        .describe("File or directory to validate (absolute, or relative to the project directory)."),
      symbols: tool.schema.array(tool.schema.string()).optional().describe("Symbols to validate directly."),
      exchangeMarkets: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Allowlist of unified symbols; symbols outside it are flagged (MS003)."),
    },
    async execute(args) {
      try {
        const symbols = args.symbols ?? []
        if (!args.source && !args.path && symbols.length === 0) {
          return JSON.stringify(errorResult("provide source, path, or symbols"), null, 2)
        }
        const marketSet =
          args.exchangeMarkets && args.exchangeMarkets.length > 0 ? new Set(args.exchangeMarkets) : null

        const findings: SymbolFinding[] = []
        let filesScanned = 0

        if (args.source) findings.push(...validateText(args.source, "<source>", marketSet))
        if (symbols.length > 0) findings.push(...validateSymbols(symbols, marketSet))
        if (args.path) {
          const base = ctx.directory
          const target = isAbsolute(args.path) ? args.path : join(base, args.path)
          const result = validatePath({ base, target, marketSet })
          findings.push(...result.findings)
          filesScanned = result.summary.filesScanned
        }

        return JSON.stringify(buildResult(findings, filesScanned), null, 2)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return JSON.stringify(errorResult(`market_symbol_validate failed: ${message}`), null, 2)
      }
    },
  })

  return { market_symbol_validate }
}
