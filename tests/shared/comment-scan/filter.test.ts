/// <reference types="bun-types" />
//#given the allow-list data the shipped tables expose
//#when filter.ts normalizes, subtracts known findings, dedupes, and caps
//#then every stage keeps render text intact and reports truncation honestly
import { describe, expect, test } from "bun:test"
import {
  type AllowList,
  applyFilters,
  capFindings,
  dedupeFindings,
  isAgentMemo,
  normalizeCommentBody,
  normalizeFinding,
  subtractCompareText,
  subtractKnown,
} from "../../../src/shared/comment-scan/filter"
import type { CommentFinding, ScanLanguage, ScanTier } from "../../../src/shared/comment-scan/types"

const ALLOW_LIST: AllowList = {
  bddKeywords: /^(given|when|then|and|but)\b/i,
  directives: [
    "@ts-",
    "eslint-",
    "biome-",
    "rubocop",
    "noqa",
    "type:",
    "TODO",
    "FIXME",
    "HACK",
    "NOTE",
    "istanbul",
    "nolint",
    "prettier-",
    "ts-expect-error",
  ],
  shebangs: [/^#!\/usr\/bin\//, /^#!\/bin\//],
  agentMemoPrefixes: [
    "added",
    "added a",
    "changed from",
    "changed to",
    "this implements",
    "now we",
    "updated the",
    "removed",
  ],
}

interface FindingOptions {
  readonly file?: string
  readonly line?: number
  readonly text: string
  readonly tier?: ScanTier
  readonly isDocstring?: boolean
  readonly trailing?: boolean
  readonly language?: ScanLanguage
}

function finding(options: FindingOptions): CommentFinding {
  return {
    file: options.file ?? "src/app.ts",
    line: options.line ?? 1,
    text: options.text,
    tier: options.tier ?? "ast",
    isDocstring: options.isDocstring ?? false,
    trailing: options.trailing ?? false,
    language: options.language ?? "typescript",
  }
}

describe("normalizeCommentBody", () => {
  const LEADER_ROWS: ReadonlyArray<readonly [string, string]> = [
    ["// given a user", "given a user"],
    ["# hash comment", "hash comment"],
    ["-- sql comment", "sql comment"],
    ["* bullet line", "bullet line"],
    ["/* block */", "block"],
    ["/** jsdoc */", "jsdoc"],
    ["<!-- markup -->", "markup"],
    ["{- elm -}", "elm"],
    ["   //   spaced    out   ", "spaced out"],
    ["/// rust outer doc", "rust outer doc"],
    ["//! rust inner doc", "! rust inner doc"],
  ]

  for (const [input, expected] of LEADER_ROWS) {
    test(`strips decoration from ${JSON.stringify(input)}`, () => {
      expect(normalizeCommentBody(input)).toBe(expected)
    })
  }

  test("flattens multi-line block comments into one body", () => {
    //#given a block comment whose decoration lives on every line
    const block = "/*\n * first line\n * second line\n */"
    //#when the body is normalized
    const body = normalizeCommentBody(block)
    //#then decoration is gone and lines are joined by single spaces
    expect(body).toBe("first line second line")
  })

  test("collapses internal whitespace without lowercasing", () => {
    expect(normalizeCommentBody("//   Mixed   CASE\t\tText  ")).toBe("Mixed CASE Text")
  })
})

describe("normalizeFinding", () => {
  test("preserves the raw text for rendering", () => {
    //#given a raw comment line as the scanner reported it
    const raw = finding({ text: "//   given   a user  " })
    //#when the finding is normalized
    const normalized = normalizeFinding(raw)
    //#then the original text survives untouched for the XML renderer
    expect(normalized.text).toBe("//   given   a user  ")
  })

  test("exposes the stripped body for matching", () => {
    const normalized = normalizeFinding(finding({ text: "//   given   a user  " }))
    expect(normalized.body).toBe("given a user")
  })

  test("keeps every non-text field", () => {
    const raw = finding({
      file: "pkg/main.py",
      line: 7,
      text: "# note",
      tier: "regex",
      isDocstring: true,
      trailing: true,
      language: "python",
    })
    expect(normalizeFinding(raw)).toMatchObject({
      file: "pkg/main.py",
      line: 7,
      tier: "regex",
      isDocstring: true,
      trailing: true,
      language: "python",
    })
  })
})

describe("subtractKnown", () => {
  test("drops the five BDD keywords from the findings list", () => {
    //#given comments that start with a BDD keyword
    const findings = [
      finding({ text: "// given a signed-in user", line: 1 }),
      finding({ text: "// when they open settings", line: 2 }),
      finding({ text: "// then the panel renders", line: 3 }),
      finding({ text: "// and the header updates", line: 4 }),
      finding({ text: "// but the footer stays", line: 5 }),
      finding({ text: "// explain the cache", line: 6 }),
    ]
    //#when the allow-list is subtracted
    const kept = subtractKnown(findings, ALLOW_LIST)
    //#then only the non-BDD comment survives
    expect(kept.map((item) => item.line)).toEqual([6])
  })

  test("drops directive comments so they never reach the report", () => {
    const findings = [
      finding({ text: "// @ts-expect-error external typings", line: 1 }),
      finding({ text: "// eslint-disable-next-line", line: 2 }),
      finding({ text: "// biome-ignore lint/suspicious", line: 3 }),
      finding({ text: "# noqa: E501", line: 4 }),
      finding({ text: "# type: ignore", line: 5 }),
      finding({ text: "// TODO: revisit", line: 6 }),
      finding({ text: "// FIXME later", line: 7 }),
      finding({ text: "// explain the cache", line: 8 }),
    ]
    const kept = subtractKnown(findings, ALLOW_LIST)
    expect(kept.map((item) => item.line)).toEqual([8])
  })

  test("matches directives case-insensitively", () => {
    const findings = [
      finding({ text: "// todo: lowercase", line: 1 }),
      finding({ text: "// Prettier-Ignore", line: 2 }),
      finding({ text: "// ordinary comment", line: 3 }),
    ]
    expect(subtractKnown(findings, ALLOW_LIST).map((item) => item.line)).toEqual([3])
  })

  test("drops a shebang only on line 1", () => {
    //#given a shebang at line 1 and a hash-bang-looking comment further down
    const findings = [
      finding({ file: "run.sh", text: "#!/usr/bin/env bash", line: 1, language: "bash" }),
      finding({ file: "run.sh", text: "#!not-a-shebang", line: 4, language: "bash" }),
    ]
    //#when the allow-list is subtracted
    const kept = subtractKnown(findings, ALLOW_LIST)
    //#then only the line-1 shebang disappears
    expect(kept.map((item) => item.line)).toEqual([4])
  })

  test("never filters docstrings", () => {
    //#given a docstring whose body starts with a BDD keyword
    const docstring = finding({ text: '# """given a user"""', isDocstring: true, language: "python" })
    //#when the allow-list is subtracted
    const kept = subtractKnown([docstring], ALLOW_LIST)
    //#then the docstring is still reported for the renderer
    expect(kept).toHaveLength(1)
    expect(kept[0]?.isDocstring).toBe(true)
  })

  test("returns findings in input order", () => {
    const findings = [
      finding({ text: "// first", line: 9 }),
      finding({ text: "// second", line: 3 }),
      finding({ text: "// third", line: 7 }),
    ]
    expect(subtractKnown(findings, ALLOW_LIST).map((item) => item.line)).toEqual([9, 3, 7])
  })

  test("does not treat agent memos as allow-listed", () => {
    //#given an agent-memo style comment that is not BDD or a directive
    const memo = finding({ text: "// added the retry budget helper" })
    //#when the allow-list is subtracted
    const kept = subtractKnown([memo], ALLOW_LIST)
    //#then it survives filtering and is only labelled later
    expect(kept).toHaveLength(1)
  })

  test("keeps a Rust inner-doc comment on line 1", () => {
    //#given an inner-doc comment whose stripped body starts with a bare "!"
    const findings = [
      finding({ file: "lib.rs", text: "//! crate docs", line: 1, language: "rust" }),
    ]
    //#when the allow-list is subtracted
    const kept = subtractKnown(findings, ALLOW_LIST)
    //#then it survives: only a leading "#!" is a shebang
    expect(kept.map((item) => item.line)).toEqual([1])
  })

  test("keeps a Rust inner-doc comment on line 2 regardless of position", () => {
    //#given the same inner-doc shape further down the file
    const findings = [
      finding({ file: "lib.rs", text: "//! x", line: 2, language: "rust" }),
    ]
    //#when the allow-list is subtracted
    //#then the line-1 shebang rule does not apply
    expect(subtractKnown(findings, ALLOW_LIST)).toHaveLength(1)
  })
})

describe("isAgentMemo", () => {
  test("matches prefixes case-insensitively", () => {
    expect(isAgentMemo("Added the retry budget helper", ALLOW_LIST.agentMemoPrefixes)).toBe(true)
    expect(isAgentMemo("CHANGED FROM the old path", ALLOW_LIST.agentMemoPrefixes)).toBe(true)
  })

  test("requires the prefix at the start of the body", () => {
    expect(isAgentMemo("we added the retry budget helper", ALLOW_LIST.agentMemoPrefixes)).toBe(false)
  })

  test("rejects ordinary reasoning", () => {
    expect(isAgentMemo("parses the config once", ALLOW_LIST.agentMemoPrefixes)).toBe(false)
  })
})

describe("dedupeFindings", () => {
  test("collapses the same finding reported by ast and regex tiers", () => {
    //#given one comment reported twice, once per tier
    const findings = [
      finding({ file: "a.ts", line: 4, text: "// same comment", tier: "ast" }),
      finding({ file: "a.ts", line: 4, text: "// same comment", tier: "regex" }),
    ]
    //#when duplicates are removed
    const unique = dedupeFindings(findings)
    //#then the first occurrence wins
    expect(unique).toHaveLength(1)
    expect(unique[0]?.tier).toBe("ast")
  })

  test("keys on file, line, and text", () => {
    const findings = [
      finding({ file: "a.ts", line: 4, text: "// same comment" }),
      finding({ file: "b.ts", line: 4, text: "// same comment" }),
      finding({ file: "a.ts", line: 5, text: "// same comment" }),
      finding({ file: "a.ts", line: 4, text: "// other comment" }),
    ]
    expect(dedupeFindings(findings)).toHaveLength(4)
  })

  test("preserves stable input order", () => {
    const findings = [
      finding({ file: "z.ts", line: 9, text: "// z" }),
      finding({ file: "a.ts", line: 1, text: "// a" }),
      finding({ file: "z.ts", line: 9, text: "// z" }),
      finding({ file: "m.ts", line: 5, text: "// m" }),
    ]
    expect(dedupeFindings(findings).map((item) => item.text)).toEqual(["// z", "// a", "// m"])
  })
})

describe("capFindings", () => {
  test("truncates beyond the limit and counts the remainder", () => {
    //#given four findings and a cap of two
    const findings = [
      finding({ line: 1, text: "// one" }),
      finding({ line: 2, text: "// two" }),
      finding({ line: 3, text: "// three" }),
      finding({ line: 4, text: "// four" }),
    ]
    //#when the list is capped
    const result = capFindings(findings, 2)
    //#then the head survives and the truncated count is exact
    expect(result.findings.map((item) => item.line)).toEqual([1, 2])
    expect(result.truncated).toBe(2)
  })

  test("reports zero truncation under the limit", () => {
    const result = capFindings([finding({ text: "// one" })], 5)
    expect(result.findings).toHaveLength(1)
    expect(result.truncated).toBe(0)
  })

  test("defaults to the shared 200-finding cap", () => {
    const findings = Array.from({ length: 201 }, (_, index) =>
      finding({ line: index + 1, text: `// comment ${index + 1}` }),
    )
    const result = capFindings(findings)
    expect(result.findings).toHaveLength(200)
    expect(result.truncated).toBe(1)
  })

  test("never returns a negative truncation count", () => {
    const result = capFindings([finding({ text: "// one" })], 0)
    expect(result.findings).toEqual([])
    expect(result.truncated).toBe(1)
  })
})

describe("applyFilters", () => {
  test("returns findings without the runtime body property", () => {
    //#given a plain comment that survives the pipeline
    const raw = [finding({ file: "a.ts", line: 1, text: "// plain statement", tier: "ast" })]
    //#when applyFilters returns
    const result = applyFilters(raw, ALLOW_LIST)
    //#then consumers get exactly the declared CommentFinding shape
    expect(Object.keys(result.findings[0] ?? {})).not.toContain("body")
  })

  test("runs normalize, subtract, dedupe, then cap in order", () => {
    //#given a mixed batch with one BDD comment, one duplicate, and one plain comment
    const raw = [
      finding({ file: "a.ts", line: 1, text: "// given a user", tier: "ast" }),
      finding({ file: "a.ts", line: 2, text: "// added the helper", tier: "ast" }),
      finding({ file: "a.ts", line: 2, text: "// added the helper", tier: "regex" }),
      finding({ file: "a.ts", line: 3, text: "// plain statement", tier: "ast" }),
    ]
    //#when the full pipeline runs with a cap of one
    const result = applyFilters(raw, ALLOW_LIST, 1)
    //#then only the first surviving unique finding is returned
    expect(result.findings.map((item) => item.text)).toEqual(["// added the helper"])
    expect(result.truncated).toBe(1)
    expect(result.findings[0]?.tier).toBe("ast")
  })

  test("returns an empty result for an empty input", () => {
    expect(applyFilters([], ALLOW_LIST)).toEqual({ findings: [], truncated: 0 })
  })

  test("defaults the cap to 200 findings", () => {
    const raw = Array.from({ length: 205 }, (_, index) =>
      finding({ line: index + 1, text: `// plain ${index + 1}` }),
    )
    const result = applyFilters(raw, ALLOW_LIST)
    expect(result.findings).toHaveLength(200)
    expect(result.truncated).toBe(5)
  })
})

describe("subtractCompareText", () => {
  test("passes findings through unchanged when compareText is undefined or empty", () => {
    //#given findings and no pre-edit text
    const findings = [
      finding({ file: "a.ts", line: 1, text: "// one" }),
      finding({ file: "a.ts", line: 2, text: "// two" }),
    ]

    //#when compareText is undefined or empty
    const undefinedResult = subtractCompareText(findings, undefined)
    const emptyResult = subtractCompareText(findings, "")

    //#then the same list comes back in the same order
    expect(undefinedResult).toBe(findings)
    expect(emptyResult).toBe(findings)
    expect(undefinedResult.map((item) => item.text)).toEqual(["// one", "// two"])
  })

  test("drops bodies present in compareText and keeps bodies absent from it", () => {
    //#given one pre-existing body and one newly written body
    const findings = [
      finding({ file: "a.ts", line: 1, text: "// pre-existing" }),
      finding({ file: "a.ts", line: 2, text: "// brand new" }),
    ]

    //#when compareText contains only the first body
    const result = subtractCompareText(findings, "const x = 1\n// pre-existing\n")

    //#then the pre-existing finding is dropped and order is preserved
    expect(result.map((item) => item.text)).toEqual(["// brand new"])
  })

  test("matches on the normalized body, collapsing decoration and whitespace", () => {
    //#given a finding whose decoration and spacing differ from compareText
    const findings = [finding({ file: "a.ts", line: 4, text: "//  Foo   bar" })]

    //#when compareText carries the plain body
    const result = subtractCompareText(findings, "const x = 1\nFoo bar\n")

    //#then the normalized bodies match and the finding is dropped
    expect(result).toEqual([])
  })

  test("does not over-drop other files when compareText repeats a body", () => {
    //#given a repeated pre-existing body plus an unrelated finding
    const findings = [
      finding({ file: "a.ts", line: 1, text: "// dup" }),
      finding({ file: "b.ts", line: 1, text: "// unique" }),
    ]

    //#when compareText repeats the body twice
    const result = subtractCompareText(findings, "// dup\n// dup")

    //#then only the matching body is dropped
    expect(result.map((item) => item.text)).toEqual(["// unique"])
  })

  test("keeps a short body that only appears inside a longer line", () => {
    //#given a one-character comment body
    const findings = [finding({ file: "a.ts", line: 1, text: "// a" })]

    //#when compareText contains that letter in unrelated code
    const result = subtractCompareText(findings, "const a = 1\n")

    //#then the finding survives because short bodies need a whole-line match
    expect(result.map((item) => item.text)).toEqual(["// a"])
  })

  test("drops a body that matches a whole normalized line", () => {
    //#given a body equal to one normalized line of compareText
    const findings = [finding({ file: "a.ts", line: 1, text: "// foo" })]

    //#when that line exists verbatim
    const result = subtractCompareText(findings, "const x = 1\n// foo\n")

    //#then the finding is dropped
    expect(result).toEqual([])
  })

  test("keeps a short body when a line only starts with it", () => {
    //#given a short body that is a prefix of a compareText line
    const findings = [finding({ file: "a.ts", line: 1, text: "// foo" })]

    //#when the line continues past the body
    const result = subtractCompareText(findings, "const x = 1\n// foo bar\n")

    //#then the finding is kept
    expect(result.map((item) => item.text)).toEqual(["// foo"])
  })

  test("falls back to substring matching for substantial bodies", () => {
    //#given a body of at least the fallback length
    const body = "this is a long comment body"
    const findings = [finding({ file: "a.ts", line: 1, text: `// ${body}` })]

    //#when the body appears only inside a longer normalized compareText line
    const result = subtractCompareText(findings, `const prefix = 1 // ${body} trailing\n`)

    //#then the fallback drops it
    expect(result).toEqual([])
  })

  test("drops a multi-line block body found in the normalized compareText", () => {
    //#given a flattened block-comment body
    const block = "/*\n * first line\n * second line\n */"
    const findings = [finding({ file: "a.ts", line: 1, text: block })]

    //#when compareText carries the same block
    const result = subtractCompareText(findings, `${block}\nconst x = 1\n`)

    //#then the fallback matches the flattened body
    expect(result).toEqual([])
  })
})
