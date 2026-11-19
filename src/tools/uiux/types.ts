import type { UIUX_DOMAINS, UIUX_STACKS } from "./constants"

/** A domain accepted by the pack search script. */
export type UiuxDomain = (typeof UIUX_DOMAINS)[number]

/** A stack accepted by the pack search script. */
export type UiuxStack = (typeof UIUX_STACKS)[number]

/** Outcome of one subprocess run, normalised across spawn implementations. */
export interface SpawnResult {
  /** Exit code, or `null` when the process was killed (signal or timeout). */
  code: number | null
  stdout: string
  stderr: string
  /** Set by the spawn implementation when the timeout killed the process. */
  timedOut?: boolean
}

/** Options forwarded to every pack subprocess. */
export interface SpawnOptions {
  cwd: string
  env: Record<string, string>
  timeoutMs: number
}

/**
 * Injection seam over `Bun.spawn` / `node:child_process`. Implementations must
 * not throw; callers still guard against it.
 */
export type SpawnFn = (argv: string[], options: SpawnOptions) => Promise<SpawnResult>

/** Everything the uiux tools need to run a pack script. */
export interface UiuxToolDeps {
  /** Root of the installed `ui-ux-pro-max` pack (claims `cwd`). */
  coreSkillRoot: string
  /** Resolved interpreter, from `resolvePythonBin`. */
  pythonBin: string
  timeoutMs: number
  maxStdoutBytes: number
  /** Defaults to the `Bun.spawn` implementation. */
  spawn?: SpawnFn
}

/** One pack script invocation. */
export interface PackScriptRequest {
  /** Script path relative to `coreSkillRoot`. */
  script: string
  args?: string[]
}

/** Machine-readable failure codes shared by the uiux tools. */
export type UiuxToolErrorCode =
  | "not_installed"
  | "python_unavailable"
  | "timeout"
  | "spawn_failed"
  | "nonzero_exit"
  | "truncated"

/** Discriminated failure result returned to the tool layer. */
export interface UiuxToolError {
  ok: false
  error: UiuxToolErrorCode
  message: string
  /** Raw subprocess output or thrown message, when available. */
  detail?: string
}

/** Successful pack script run. */
export interface PackScriptSuccess {
  ok: true
  stdout: string
  /** True when `stdout` was cut to `maxStdoutBytes`. */
  truncated: boolean
  code: number
}

/** Result of `runPackScript` — never thrown, always returned. */
export type PackScriptResult = PackScriptSuccess | UiuxToolError
