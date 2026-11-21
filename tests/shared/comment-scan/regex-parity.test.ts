/// <reference types="bun-types" />
//#given the four regex-tier cases captured from the OLD_BINARY
//#when the regex tier scans each case and the report renders with the rubric
//#then the content matches the baseline exactly, with the single header line as the declared delta
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { formatReport } from "../../../src/shared/comment-scan/render"
import { scanSources } from "../../../src/shared/comment-scan/scan"

const FIXTURE_ROOT = join(import.meta.dir, "..", "..", "fixtures", "comment-scan")

const REGEX_PARITY_CASES = ["sql", "toml", "dockerfile", "proto"] as const

const BASELINE_HEADER = "Detected comments/docstrings:"
const REGEX_HEADER = "Possible comments (heuristic):"

interface CaseJson {
  readonly filePath: string
  readonly content: string
}

function readCase(name: string): CaseJson {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, "cases", name, "case.json"), "utf8")) as CaseJson
}

function readBaseline(name: string): string {
  return readFileSync(join(FIXTURE_ROOT, "baseline", `${name}.expected.txt`), "utf8")
}

interface XmlEntry {
  readonly line: number
  readonly text: string
}

function parseBaselineEntries(baseline: string): string[] {
  const entries: XmlEntry[] = []
  const pattern = /<comment line-number="(\d+)">([\s\S]*?)<\/comment>/g
  for (const match of baseline.matchAll(pattern)) {
    entries.push({ line: Number(match[1]), text: match[2] ?? "" })
  }
  return entries.map((entry) => JSON.stringify([entry.line, entry.text])).sort()
}

describe("regex-tier content parity with the OLD_BINARY baseline (header delta only)", () => {
  for (const name of REGEX_PARITY_CASES) {
    test(`${name}: equals the baseline after replacing only the tier header line`, async () => {
      //#given the case source and its recorded baseline
      const caseJson = readCase(name)
      const baseline = readBaseline(name)
      //#when the regex tier scans and the report renders with the rubric
      const result = await scanSources(
        [{ filePath: caseJson.filePath, text: caseJson.content }],
        { tier: "regex" },
      )
      const rendered = formatReport({
        findings: result.findings,
        filePath: caseJson.filePath,
        tier: "regex",
        includeRubric: true,
      })
      //#then the baseline differs by exactly one header line and nothing else
      expect(baseline.split(BASELINE_HEADER)).toHaveLength(2)
      const expected = baseline.replace(BASELINE_HEADER, REGEX_HEADER)
      expect(rendered).toBe(expected)
      //#and the finding (line, text) multiset matches the baseline XML entries
      const renderedEntries = [...result.findings]
        .map((finding) => JSON.stringify([finding.line, finding.text]))
        .sort()
      expect(renderedEntries).toEqual(parseBaselineEntries(baseline))
    })
  }
})
