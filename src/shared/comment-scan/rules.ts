import { PY_DOCSTRING_RULE_IDS } from "./constants"
import type { AstLanguage, InlineRuleSet } from "./types"

const RULE_ID_PREFIX = "comment:"

const SG_LANGUAGE: Readonly<Record<AstLanguage, string>> = {
  python: "Python",
  javascript: "JavaScript",
  typescript: "TypeScript",
  tsx: "Tsx",
  go: "Go",
  java: "Java",
  kotlin: "Kotlin",
  scala: "Scala",
  c: "C",
  cpp: "Cpp",
  rust: "Rust",
  ruby: "Ruby",
  bash: "Bash",
  csharp: "CSharp",
  swift: "Swift",
  elixir: "Elixir",
  lua: "Lua",
  php: "Php",
  html: "Html",
  css: "Css",
  yaml: "Yaml",
  nix: "Nix",
  haskell: "Haskell",
  solidity: "Solidity",
  json: "Json",
}

const COMMENT_BODY: readonly string[] = ["  kind: comment"]

const SPECIAL_COMMENT_BODY: Readonly<Partial<Record<AstLanguage, readonly string[]>>> = {
  java: ["  any:", "    - kind: line_comment", "    - kind: block_comment"],
  kotlin: ["  any:", "    - kind: line_comment", "    - kind: multiline_comment"],
  rust: ["  any:", "    - kind: line_comment", "    - kind: block_comment"],
}

type DocstringRuleId = (typeof PY_DOCSTRING_RULE_IDS)[number]

const DOCSTRING_BODY: Readonly<Record<DocstringRuleId, readonly string[]>> = {
  "docstring:python:module": [
    "  all:",
    "    - kind: string",
    '    - regex: "^[\'\\"]"',
    "  inside:",
    "    kind: expression_statement",
    "    nthChild: 1",
    "    inside: { kind: module }",
  ],
  "docstring:python:block": [
    "  all:",
    "    - kind: string",
    '    - regex: "^[\'\\"]"',
    "  inside:",
    "    kind: expression_statement",
    "    nthChild: 1",
    "    inside:",
    "      kind: block",
    "      inside: { any: [ {kind: function_definition}, {kind: class_definition} ] }",
  ],
}

export function ruleIdFor(language: AstLanguage): string {
  return `${RULE_ID_PREFIX}${language}`
}

/** Builds the deterministic `sg scan --inline-rules` YAML and its rule-id metadata. */
export function buildInlineRules(languages: readonly AstLanguage[]): InlineRuleSet {
  const ordered = [...new Set(languages)].sort()
  const ruleMeta: Record<string, { language: AstLanguage; isDocstring: boolean }> = {}
  const ruleBlocks = ordered.map((language) => {
    const id = ruleIdFor(language)
    ruleMeta[id] = { language, isDocstring: false }
    return formatRule(id, SG_LANGUAGE[language], SPECIAL_COMMENT_BODY[language] ?? COMMENT_BODY)
  })

  if (ordered.includes("python")) {
    for (const id of PY_DOCSTRING_RULE_IDS) {
      ruleMeta[id] = { language: "python", isDocstring: true }
      ruleBlocks.push(formatRule(id, SG_LANGUAGE.python, DOCSTRING_BODY[id]))
    }
  }

  return { yaml: ruleBlocks.join("\n---\n"), ruleMeta }
}

function formatRule(id: string, language: string, body: readonly string[]): string {
  return [`id: ${id}`, `language: ${language}`, "rule:", ...body].join("\n")
}
