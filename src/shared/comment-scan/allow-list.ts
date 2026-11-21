import type { AllowList } from "./filter"

/**
 * Prefixes the old comment-checker binary (0.6.1) matched, case-insensitively, against a
 * comment body with leading decoration and whitespace removed.
 *
 * Frozen from tests/fixtures/comment-scan/agent-memo-prefixes.txt (the extraction commands
 * live in that file). Bare stems the binary never matched ("add", "implement", "switch to",
 * "modify", "convert to") are deliberately absent; "remove", "update", "rename", "migrate"
 * do match. The binary required a following word character for "note:", which a plain
 * prefix cannot express, so a comment that is exactly "note:" also matches here.
 */
export const AGENT_MEMO_PREFIXES: readonly string[] = [
  "added",
  "remove",
  "delete",
  "note:",
  "replace",
  "here we",
  "previously",
  "implemented",
  "after this",
  "before this",
  "was changed",
  "refactor",
  "move from",
  "move to",
  "now we",
  "now this",
  "now it",
  "change from",
  "change to",
  "update",
  "rename",
  "switched from",
  "switched to",
  "modified",
  "converted from",
  "converted to",
  "migrate",
  "implementation of",
  "implementation note",
  "this implements",
  "this adds",
  "this removes",
  "this changes",
  "this fixes",
]

const DIRECTIVES: readonly string[] = [
  "@ts-",
  "eslint-",
  "biome-",
  "rubocop",
  "noqa",
  "type:",
  "istanbul",
  "nolint",
  "prettier-",
  "ts-expect-error",
  // Measured with 0.6.1: these directive-shaped prefixes were dropped there too.
  "ts-ignore",
  "pylint:",
  "ruff:",
  "mypy:",
  "pyre:",
  "flake8:",
  "pytype:",
  "clippy:",
  "pyright:",
]

/**
 * BDD comments start with one of these keywords as a whole word.
 *
 * Deliberate policy delta: the old binary DID report BDD comments (see
 * tests/fixtures/comment-scan/baseline/bdd.expected.txt). Dropping them matches the
 * documented behaviour in docs/configurations.md § Comment Checker.
 */
const BDD_KEYWORDS = /^(given|when|then|and|but)\b/i

export const DEFAULT_ALLOW_LIST: AllowList = {
  bddKeywords: BDD_KEYWORDS,
  directives: DIRECTIVES,
  shebangs: [/^#!/],
  agentMemoPrefixes: AGENT_MEMO_PREFIXES,
}

