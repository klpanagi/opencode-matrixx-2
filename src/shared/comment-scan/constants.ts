import type { AstLanguage, RegexLanguage, ScanLanguage } from "./types"

export const EXTENSION_LANGUAGE: Readonly<Record<string, ScanLanguage | undefined>> = {
  ".py": "python",
  ".pyi": "python",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".cts": "typescript",
  ".mts": "typescript",
  ".tsx": "tsx",
  ".go": "go",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".scala": "scala",
  ".sc": "scala",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hxx": "cpp",
  ".rs": "rust",
  ".rb": "ruby",
  ".rake": "ruby",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".bats": "bash",
  ".cs": "csharp",
  ".swift": "swift",
  ".ex": "elixir",
  ".exs": "elixir",
  ".lua": "lua",
  ".php": "php",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".nix": "nix",
  ".hs": "haskell",
  ".lhs": "haskell",
  ".sol": "solidity",
  ".json": "json",
  ".ml": "ocaml",
  ".mli": "ocaml",
  ".sql": "sql",
  ".toml": "toml",
  ".hcl": "hcl",
  ".tf": "hcl",
  ".proto": "proto",
  ".svelte": "svelte",
  ".elm": "elm",
  ".groovy": "groovy",
  ".gradle": "groovy",
  ".cue": "cue",
  ".jsonc": "jsonc",
}

export const DOCKERFILE_BASENAME = "dockerfile"

export const AST_LANGUAGES: readonly AstLanguage[] = [
  "python",
  "javascript",
  "typescript",
  "tsx",
  "go",
  "java",
  "kotlin",
  "scala",
  "c",
  "cpp",
  "rust",
  "ruby",
  "bash",
  "csharp",
  "swift",
  "elixir",
  "lua",
  "php",
  "html",
  "css",
  "yaml",
  "nix",
  "haskell",
  "solidity",
  "json",
]

export const REGEX_LANGUAGES: readonly RegexLanguage[] = [
  "ocaml",
  "sql",
  "toml",
  "hcl",
  "dockerfile",
  "proto",
  "svelte",
  "elm",
  "groovy",
  "cue",
  "jsonc",
]

export interface RegexLeader {
    readonly open: string
    readonly close: string | null
}

export const REGEX_LEADERS: Readonly<Record<RegexLanguage, readonly RegexLeader[]>> = {
  ocaml: [{ open: "(*", close: "*)" }],
  sql: [
    { open: "--", close: null },
    { open: "/*", close: "*/" },
  ],
  toml: [{ open: "#", close: null }],
  hcl: [
    { open: "#", close: null },
    { open: "//", close: null },
    { open: "/*", close: "*/" },
  ],
  dockerfile: [{ open: "#", close: null }],
  proto: [
    { open: "//", close: null },
    { open: "/*", close: "*/" },
  ],
  svelte: [
    { open: "//", close: null },
    { open: "/*", close: "*/" },
    { open: "<!--", close: "-->" },
  ],
  elm: [
    { open: "--", close: null },
    { open: "{-", close: "-}" },
  ],
  groovy: [
    { open: "//", close: null },
    { open: "/*", close: "*/" },
  ],
  cue: [{ open: "//", close: null }],
  jsonc: [
    { open: "//", close: null },
    { open: "/*", close: "*/" },
  ],
}

export const PY_DOCSTRING_RULE_IDS = ["docstring:python:module", "docstring:python:block"] as const

export const DEFAULT_SG_TIMEOUT_MS = 20_000
export const DEFAULT_MAX_FINDINGS = 200
export const MAX_BATCH_FILES = 200
export const MAX_FILE_BYTES = 2 * 1024 * 1024

export function oversizeMessage(filePath: string, bytes: number): string {
  return `Skipped ${filePath}: ${bytes} bytes exceeds the ${MAX_FILE_BYTES}-byte limit`
}
export const MAX_BATCH_BYTES = 32 * 1024 * 1024
// Bounds scanPaths collection across the whole walk (not one sg invocation).
export const MAX_SCAN_FILES = 5000
// Bounds scanPaths total collected bytes across the whole walk (not one sg invocation).
export const MAX_SCAN_BYTES = 64 * 1024 * 1024
export const DEFAULT_QUEUE_CONCURRENCY = 2
export const DEFAULT_QUEUE_MAX_PENDING = 32
