/// <reference types="bun-types" />
//#given the rule matrix from plan §4.2/§4.3 and the final constants module
//#when buildInlineRules is called for language groups
//#then ids, node kinds, python docstring rules and determinism match the plan
import { describe, expect, test } from "bun:test"

import { AST_LANGUAGES, PY_DOCSTRING_RULE_IDS } from "../../../src/shared/comment-scan/constants"
import { buildInlineRules, ruleIdFor } from "../../../src/shared/comment-scan/rules"
import type { AstLanguage } from "../../../src/shared/comment-scan/types"

const DEFAULT_GROUP: readonly AstLanguage[] = [
  "javascript",
  "typescript",
  "c",
  "cpp",
  "csharp",
  "swift",
  "elixir",
  "lua",
  "php",
  "ruby",
  "bash",
  "scala",
  "html",
  "css",
  "yaml",
  "nix",
  "haskell",
  "solidity",
  "json",
  "go",
]

function blocks(yaml: string): readonly string[] {
  return yaml === "" ? [] : yaml.split("\n---\n")
}

function ruleIds(yaml: string): readonly string[] {
  return blocks(yaml).map((block) => block.split("\n")[0] ?? "")
}

describe("ruleIdFor", () => {
  test.each(AST_LANGUAGES)("prefixes %s with comment:", (language) => {
    //#given a single AST language
    //#when deriving its rule id
    //#then the id is collision-free by construction
    expect(ruleIdFor(language)).toBe(`comment:${language}`)
  })
})

describe("buildInlineRules default group", () => {
  test("emits the golden YAML for a default language", () => {
    //#given ruby, a kind:comment language
    //#when building the rule set
    //#then the block is exactly id/language/rule with kind: comment
    const { yaml } = buildInlineRules(["ruby"])
    expect(yaml).toBe(
      ["id: comment:ruby", "language: Ruby", "rule:", "  kind: comment"].join("\n"),
    )
  })

  test.each(DEFAULT_GROUP)("uses kind: comment for %s", (language) => {
    //#given a default-group language
    //#when building the rule set
    //#then the only body is kind: comment — no any:, no docstring rules
    const { yaml } = buildInlineRules([language])
    expect(yaml).toContain("  kind: comment")
    expect(yaml).not.toContain("  any:")
    expect(yaml).not.toContain("docstring:")
  })

  test("labels languages with sg names", () => {
    //#given languages whose sg labels are not capitalized ids
    //#when building the rule set
    //#then the emitted language labels match sg 0.40.5
    expect(buildInlineRules(["tsx"]).yaml).toContain("language: Tsx")
    expect(buildInlineRules(["csharp"]).yaml).toContain("language: CSharp")
    expect(buildInlineRules(["cpp"]).yaml).toContain("language: Cpp")
    expect(buildInlineRules(["php"]).yaml).toContain("language: Php")
    expect(buildInlineRules(["html"]).yaml).toContain("language: Html")
  })
})

describe("buildInlineRules special comment kinds", () => {
  test("java uses line_comment and block_comment", () => {
    //#given java, where kind: comment hard-fails rule parsing
    //#when building the rule set
    //#then the body is an any-list of the two real comment kinds
    const { yaml } = buildInlineRules(["java"])
    expect(yaml).toBe(
      [
        "id: comment:java",
        "language: Java",
        "rule:",
        "  any:",
        "    - kind: line_comment",
        "    - kind: block_comment",
      ].join("\n"),
    )
    expect(yaml).not.toContain("kind: comment")
  })

  test("kotlin uses line_comment and multiline_comment", () => {
    //#given kotlin, where block_comment does not exist
    //#when building the rule set
    //#then the body is an any-list with multiline_comment
    const { yaml } = buildInlineRules(["kotlin"])
    expect(yaml).toBe(
      [
        "id: comment:kotlin",
        "language: Kotlin",
        "rule:",
        "  any:",
        "    - kind: line_comment",
        "    - kind: multiline_comment",
      ].join("\n"),
    )
    expect(yaml).not.toContain("kind: comment")
  })

  test("rust uses line_comment and block_comment but never doc_comment", () => {
    //#given rust, where /// is already a line_comment
    //#when building the rule set
    //#then doc_comment is absent so /// is never double-counted
    const { yaml } = buildInlineRules(["rust"])
    expect(yaml).toBe(
      [
        "id: comment:rust",
        "language: Rust",
        "rule:",
        "  any:",
        "    - kind: line_comment",
        "    - kind: block_comment",
      ].join("\n"),
    )
    expect(yaml).not.toContain("doc_comment")
    expect(yaml).not.toContain("kind: comment")
  })
})

describe("buildInlineRules python docstrings", () => {
  test("emits three python rules: one comment plus every docstring id", () => {
    //#given python
    //#when building the rule set
    //#then comment:python comes first and the docstring rules follow in constants order
    const { yaml } = buildInlineRules(["python"])
    expect(ruleIds(yaml)).toEqual(["id: comment:python", ...PY_DOCSTRING_RULE_IDS.map((id) => `id: ${id}`)])
  })

  test("emits the verified docstring YAML", () => {
    //#given python
    //#when building the rule set
    //#then the docstring bodies match the shapes verified against sg 0.40.5
    const { yaml } = buildInlineRules(["python"])
    expect(yaml).toBe(
      [
        "id: comment:python",
        "language: Python",
        "rule:",
        "  kind: comment",
        "---",
        "id: docstring:python:module",
        "language: Python",
        "rule:",
        "  all:",
        "    - kind: string",
        '    - regex: "^[\'\\"]"',
        "  inside:",
        "    kind: expression_statement",
        "    nthChild: 1",
        "    inside: { kind: module }",
        "---",
        "id: docstring:python:block",
        "language: Python",
        "rule:",
        "  all:",
        "    - kind: string",
        '    - regex: "^[\'\\"]"',
        "  inside:",
        "    kind: expression_statement",
        "    nthChild: 1",
        "    inside:",
        "      kind: block",
        "      inside: { any: [ {kind: function_definition}, {kind: class_definition} ] }",
      ].join("\n"),
    )
  })

  test("marks docstring rules in ruleMeta and excludes assigned strings via regex", () => {
    //#given python
    //#when building the rule set
    //#then the quote-anchored regex gates every docstring rule and meta carries isDocstring
    const { yaml, ruleMeta } = buildInlineRules(["python"])
    const docstringBlocks = blocks(yaml).filter((block) => block.includes("docstring:"))
    expect(docstringBlocks).toHaveLength(PY_DOCSTRING_RULE_IDS.length)
    for (const block of docstringBlocks) {
      expect(block).toContain('    - regex: "^[\'\\"]"')
    }
    expect(ruleMeta["comment:python"]).toEqual({ language: "python", isDocstring: false })
    for (const id of PY_DOCSTRING_RULE_IDS) {
      expect(ruleMeta[id]).toEqual({ language: "python", isDocstring: true })
    }
  })

  test("omits docstring rules when python is absent", () => {
    //#given a rule set without python
    //#when building
    //#then no docstring rule is emitted
    expect(buildInlineRules(["go", "ruby"]).yaml).not.toContain("docstring:")
  })
})

describe("buildInlineRules determinism", () => {
  test("sorts languages alphabetically regardless of input order", () => {
    //#given the same languages in two different orders
    //#when building both rule sets
    //#then the YAML is byte-identical
    const forward = buildInlineRules(["ruby", "go", "kotlin"])
    const reversed = buildInlineRules(["kotlin", "ruby", "go"])
    expect(reversed.yaml).toBe(forward.yaml)
    expect(ruleIds(forward.yaml)).toEqual([
      "id: comment:go",
      "id: comment:kotlin",
      "id: comment:ruby",
    ])
  })

  test("dedupes repeated languages", () => {
    //#given a duplicated language list
    //#when building
    //#then the YAML equals the single-language build
    expect(buildInlineRules(["rust", "rust"]).yaml).toBe(buildInlineRules(["rust"]).yaml)
  })

  test("returns an empty rule set for no languages", () => {
    //#given an empty language list
    //#when building
    //#then the YAML is empty and ruleMeta is empty
    const { yaml, ruleMeta } = buildInlineRules([])
    expect(yaml).toBe("")
    expect(Object.keys(ruleMeta)).toHaveLength(0)
  })
})

describe("buildInlineRules jsonc exclusion", () => {
  test("never emits jsonc for the full AST language set", () => {
    //#given every AST language
    //#when building the rule set
    //#then jsonc is absent because it is regex-tier only
    const { yaml, ruleMeta } = buildInlineRules(AST_LANGUAGES)
    expect(yaml).not.toContain("jsonc")
    expect(Object.keys(ruleMeta).some((id) => id.includes("jsonc"))).toBe(false)
  })
})

describe("buildInlineRules full matrix", () => {
  test("emits one rule per AST language plus every docstring rule", () => {
    //#given every AST language
    //#when building
    //#then the rule count is languages + docstrings, every id unique
    const { yaml } = buildInlineRules(AST_LANGUAGES)
    const emitted = ruleIds(yaml)
    expect(emitted).toHaveLength(AST_LANGUAGES.length + PY_DOCSTRING_RULE_IDS.length)
    expect(new Set(emitted).size).toBe(emitted.length)
  })

  test("keeps ruleMeta in sync with the emitted rule ids", () => {
    //#given every AST language
    //#when building
    //#then every emitted id has meta and every meta key is emitted
    const { yaml, ruleMeta } = buildInlineRules(AST_LANGUAGES)
    const emittedIds = ruleIds(yaml).map((line) => line.replace("id: ", ""))
    expect(Object.keys(ruleMeta).sort()).toEqual([...emittedIds].sort())
    for (const id of emittedIds) {
      expect(ruleMeta[id]?.isDocstring).toBe(id.startsWith("docstring:"))
    }
  })
})
