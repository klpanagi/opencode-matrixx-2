export type ScanTier = "ast" | "regex"

export type AstLanguage =
  | "python"
  | "javascript"
  | "typescript"
  | "tsx"
  | "go"
  | "java"
  | "kotlin"
  | "scala"
  | "c"
  | "cpp"
  | "rust"
  | "ruby"
  | "bash"
  | "csharp"
  | "swift"
  | "elixir"
  | "lua"
  | "php"
  | "html"
  | "css"
  | "yaml"
  | "nix"
  | "haskell"
  | "solidity"
  | "json"

export type RegexLanguage =
  | "ocaml"
  | "sql"
  | "toml"
  | "hcl"
  | "dockerfile"
  | "proto"
  | "svelte"
  | "elm"
  | "groovy"
  | "cue"
  | "jsonc"

export type ScanLanguage = AstLanguage | RegexLanguage

export interface CommentFinding {
  readonly file: string // original path (never a temp path)
  readonly line: number // 1-based
  readonly text: string // raw comment/docstring text incl. delimiters
  readonly tier: ScanTier
  readonly isDocstring: boolean
  readonly trailing: boolean // code before the comment on the same line
  readonly language: ScanLanguage
}

export interface ScanSource {
  readonly filePath: string // label + extension source of truth
  readonly text: string // content to scan
  readonly compareText?: string // findings whose normalized body appears here are dropped
}

export interface ScanOptions {
  readonly timeoutMs?: number
  readonly maxFindings?: number
}

export interface ScanResult {
  readonly findings: readonly CommentFinding[]
  readonly errors?: readonly string[]
  // "unsupported": every source resolved to null (no scan language); "binary-missing": sg absent; "timeout": sg timed out
  readonly skipped?: "unsupported" | "binary-missing" | "timeout"
}

export interface InlineRuleSet {
  readonly yaml: string
  readonly ruleMeta: Readonly<Record<string, { language: AstLanguage; isDocstring: boolean }>>
}

export interface BoundedQueueOptions {
  readonly concurrency?: number
  readonly maxPending?: number
  readonly taskTimeoutMs?: number
  readonly onOverflow?: () => void
  readonly schedule?: (fn: () => void, ms: number) => unknown // injectable timer (tests)
  readonly now?: () => number // injectable clock (tests)
}

export interface BoundedQueue {
  run<T>(task: () => Promise<T>): Promise<T>
  readonly active: number
  readonly pending: number
}
