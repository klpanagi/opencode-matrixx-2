/// <reference types="bun-types" />
//#given the comment_scan tool with scanPaths mocked
//#when args are validated or execute runs
//#then findings render without the rubric, empty runs stay explicit, and failures return text
import { describe, expect, mock, test } from "bun:test"

import type { CommentFinding, ScanResult } from "../../../src/shared/comment-scan/types"
import { formatReport as realFormatReport } from "../../../src/shared/comment-scan/render"

const scanPathsMock = mock(async (): Promise<ScanResult> => ({ findings: [] }))

mock.module("../../../src/shared/comment-scan", () => ({
  scanPaths: scanPathsMock,
  formatReport: realFormatReport,
}))

import { createCommentScanTool } from "../../../src/tools/comment-scan/tools"
import type { MatrixxToolContext } from "../../../src/shared/tool/define-tool"

const ctx = { directory: "/repo" } as unknown as MatrixxToolContext

function tool() {
  return createCommentScanTool(ctx).comment_scan
}

function finding(overrides: Partial<CommentFinding> = {}): CommentFinding {
  return {
    file: "/repo/src/a.ts",
    line: 3,
    text: "// increment the counter",
    tier: "ast",
    isDocstring: false,
    trailing: false,
    language: "typescript",
    ...overrides,
  }
}

function setResult(result: ScanResult): void {
  scanPathsMock.mockImplementationOnce(async () => result)
}

describe("comment_scan arg schema", () => {
  test("requires at least one path", () => {
    //#given the tool definition
    const definition = tool()
    //#when parsing an empty path list
    //#then the schema rejects it
    expect(() => definition.args.paths.parse([])).toThrow()
    expect(definition.args.paths.parse(["src"])).toEqual(["src"])
  })

  test("defaults tier to both", () => {
    //#given the tool definition
    const definition = tool()
    //#when parsing an omitted tier
    //#then it defaults to both
    expect(definition.args.tier.parse(undefined)).toBe("both")
    expect(definition.args.tier.parse("regex")).toBe("regex")
  })
})

describe("comment_scan execute", () => {
  test("renders findings with file, line, and text but no rubric", async () => {
    //#given scanPaths returns one finding
    setResult({ findings: [finding()] })
    //#when executing the tool
    const output = await tool().execute({ paths: ["src"], tier: "both" }, ctx)
    //#then the location and text are shown, and the rubric is omitted
    const text = String(output)
    expect(text).toContain("/repo/src/a.ts")
    expect(text).toContain("3")
    expect(text).toContain("// increment the counter")
    expect(text).not.toContain("COMMENT/DOCSTRING DETECTED")
    expect(text).not.toContain("PRIORITY-BASED")
  })

  test("returns an explicit no-findings line and echoes skipped", async () => {
    //#given scanPaths returns no findings and a skipped reason
    setResult({ findings: [], skipped: "binary-missing" })
    //#when executing the tool
    const output = String(await tool().execute({ paths: ["src"], tier: "both" }, ctx))
    //#then the output states there are no findings and surfaces the skip
    expect(output.toLowerCase()).toContain("no comment findings")
    expect(output).toContain("binary-missing")
  })

  test("echoes collection errors when nothing is found, without a no-findings line", async () => {
    //#given scanPaths reports a per-file error and no findings
    setResult({ findings: [], errors: ["Failed to read /repo/src/b.ts"] })
    //#when executing the tool
    const output = String(await tool().execute({ paths: ["src"], tier: "both" }, ctx))
    //#then the error text is exposed and the empty-result line is suppressed
    expect(output).toContain("Failed to read /repo/src/b.ts")
    expect(output).not.toContain("No comment findings")
  })

  test("resolves relative paths against the context directory", async () => {
    //#given a context directory that differs from the process working directory
    setResult({ findings: [] })
    //#when executing with a relative path
    await tool().execute({ paths: ["src"], tier: "both" }, ctx)
    //#then scanPaths receives the absolute path rooted at the context directory
    expect(scanPathsMock.mock.calls.at(-1)?.[0]).toEqual(["/repo/src"])
  })

  test("returns scan rejections as text instead of throwing", async () => {
    //#given scanPaths rejects
    scanPathsMock.mockImplementationOnce(async () => {
      throw new Error("sg exploded")
    })
    //#when executing the tool
    const output = String(await tool().execute({ paths: ["src"], tier: "both" }, ctx))
    //#then the failure is returned as an explicit error line
    expect(output).toContain("sg exploded")
    expect(output.startsWith("ERROR: ")).toBe(true)
  })

  test("surfaces collection errors before findings", async () => {
    //#given a finding plus a truncation error
    setResult({
      findings: [finding()],
      errors: ["Scan truncated: stopped after 3 files; remaining files were NOT scanned"],
    })
    //#when executing the tool
    const text = String(await tool().execute({ paths: ["src"], tier: "both" }, ctx))
    //#then the error is visible before the findings block
    expect(text.indexOf("Scan truncated")).toBeLessThan(text.indexOf("Detected comments"))
  })

  test("passes the selected tier to scanPaths", async () => {
    //#given a regex-tier request
    setResult({ findings: [] })
    //#when executing with tier regex
    await tool().execute({ paths: ["src"], tier: "regex" }, ctx)
    //#then scanPaths receives that tier
    expect(scanPathsMock.mock.calls.at(-1)?.[1]).toEqual({ tier: "regex" })
  })
})


describe("comment_scan tier rendering", () => {
  test("renders AST and regex findings under their own headers, AST first", async () => {
    //#given a mixed batch with one AST-tier and one regex-tier finding
    setResult({
      findings: [
        finding({ file: "/repo/src/a.ts", line: 3, text: "// increment the counter", tier: "ast" }),
        finding({
          file: "/repo/queries/q.sql",
          line: 1,
          text: "-- select the row",
          tier: "regex",
          language: "sql",
        }),
      ],
    })
    //#when executing the tool
    const text = String(await tool().execute({ paths: ["src"], tier: "both" }, ctx))
    //#then each finding sits under its own tier header, AST group first
    const astHeader = text.indexOf("Detected comments/docstrings:")
    const regexHeader = text.indexOf("Possible comments (heuristic):")
    expect(astHeader).toBeGreaterThanOrEqual(0)
    expect(regexHeader).toBeGreaterThanOrEqual(0)
    expect(astHeader).toBeLessThan(regexHeader)
    expect(text.indexOf("// increment the counter")).toBeLessThan(regexHeader)
    expect(text.indexOf("-- select the row")).toBeGreaterThan(regexHeader)
  })

  test("renders exactly one header for an AST-only batch", async () => {
    //#given only AST-tier findings
    setResult({ findings: [finding({ tier: "ast" })] })
    //#when executing the tool
    const text = String(await tool().execute({ paths: ["src"], tier: "both" }, ctx))
    //#then the regex header is absent
    expect(text).toContain("Detected comments/docstrings:")
    expect(text).not.toContain("Possible comments (heuristic):")
  })

  test("renders exactly one header for a regex-only batch", async () => {
    //#given only regex-tier findings
    setResult({
      findings: [
        finding({ file: "/repo/queries/q.sql", line: 1, text: "-- select the row", tier: "regex", language: "sql" }),
      ],
    })
    //#when executing the tool
    const text = String(await tool().execute({ paths: ["src"], tier: "both" }, ctx))
    //#then the AST header is absent
    expect(text).toContain("Possible comments (heuristic):")
    expect(text).not.toContain("Detected comments/docstrings:")
  })
})

describe("comment_scan agent memo listing", () => {
  test("lists agent-memo findings as - Line entries", async () => {
    //#given a finding whose body starts with an agent-memo prefix
    setResult({
      findings: [
        finding({ file: "/repo/queries/q.sql", line: 4, text: "-- added the thing", tier: "regex", language: "sql" }),
      ],
    })
    //#when executing the tool
    const text = String(await tool().execute({ paths: ["src"], tier: "both" }, ctx))
    //#then the memo listing is present
    expect(text).toContain("- Line 4: -- added the thing")
  })
})