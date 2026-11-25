// Python runtime resolution for the uiux skill packs.
//
// The `python_bin` override comes from the skill-pack config (T1.2); the
// resolver only needs that field, so it accepts a narrow structural view.
import type { SkillPacksConfig } from "../../config/schema/skill-packs"
import { warn } from "../../shared/runtime/logger"

export type PythonConfig = Pick<SkillPacksConfig, "python_bin">

export type PythonPlatform = typeof process.platform

export interface PythonResolveDeps {
  platform?: PythonPlatform
  which?: (bin: string) => string | undefined
}

export interface SpawnResult {
  exitCode: number | null
  stdout: string
  stderr: string
}

export interface PythonProbeDeps {
  spawnFn?: (argv: string[]) => SpawnResult
}

export interface PythonProbeResult {
  ok: boolean
  version?: string
  error?: string
}

const PYTHON_CANDIDATES = ["python3", "python"] as const
const WIN32_LAUNCHER = "py"
const PROBE_TIMEOUT_MS = 3000
const PYTHON_VERSION_PATTERN = /Python\s+(\d+(?:\.\d+){1,3}[^\s]*)/

export const MAX_PYTHON_PROBE_CACHE = 1000

const probeCache = new Map<string, PythonProbeResult>()

function defaultWhich(bin: string): string | undefined {
  try {
    return Bun.which(bin) ?? undefined
  } catch (error) {
    warn("uiux python: which failed", { bin, error: String(error) })
    return undefined
  }
}

/**
 * Resolves the Python executable without spawning or installing anything.
 *
 * Precedence: `config.python_bin` -> `python3` -> `python`. On win32 the
 * `py` launcher is the last-best-effort candidate. Returns the executable
 * name/path only (never a command line); probes append the launcher's `-3`.
 */
export function resolvePythonBin(
  config: PythonConfig = {},
  deps: PythonResolveDeps = {},
): string | undefined {
  const explicit = config.python_bin?.trim()
  if (explicit) return explicit

  const platform = deps.platform ?? process.platform
  const which = deps.which ?? defaultWhich
  const candidates: string[] = [...PYTHON_CANDIDATES]
  if (platform === "win32") candidates.push(WIN32_LAUNCHER)

  for (const bin of candidates) {
    const found = which(bin)
    if (found) return found
  }
  return undefined
}

/**
 * Builds a child-process environment that forces UTF-8 stdio, which keeps
 * Python-produced JSON readable on Windows and under non-UTF-8 locales.
 */
export function pythonEnv(base: Record<string, string | undefined> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) {
    if (typeof value === "string") env[key] = value
  }
  env.PYTHONDONTWRITEBYTECODE = "1"
  env.PYTHONIOENCODING = "utf-8"
  env.PYTHONUTF8 = "1"
  return env
}

function isPyLauncher(bin: string): boolean {
  const base = bin.split(/[\\/]/).pop() ?? bin
  return base === "py" || base === "py.exe"
}

function probeArgv(bin: string): string[] {
  return isPyLauncher(bin) ? [bin, "-3", "--version"] : [bin, "--version"]
}

function defaultSpawn(argv: string[]): SpawnResult {
  const result = Bun.spawnSync(argv, {
    stdout: "pipe",
    stderr: "pipe",
    timeout: PROBE_TIMEOUT_MS,
  })
  return {
    exitCode: result.exitCode,
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Probes `bin --version` once per binary and memoises the outcome. A missing
 * binary, a non-zero exit, an unparseable version or a hung/short-circuited
 * spawn all resolve to `{ ok: false }` instead of throwing.
 */
export function probePython(
  bin: string | undefined,
  deps: PythonProbeDeps = {},
): PythonProbeResult {
  if (!bin) {
    return {
      ok: false,
      error: "No Python interpreter found. Install Python 3.8+ or set skill_packs.python_bin.",
    }
  }

  const cached = probeCache.get(bin)
  if (cached) {
    // Bump insertion order: an active probe must not be the oldest entry.
    probeCache.delete(bin)
    probeCache.set(bin, cached)
    return cached
  }

  const result = runProbe(bin, deps.spawnFn ?? defaultSpawn)
  if (probeCache.size >= MAX_PYTHON_PROBE_CACHE) {
    const oldest = probeCache.keys().next().value
    if (oldest !== undefined) probeCache.delete(oldest)
  }
  probeCache.set(bin, result)
  return result
}

function runProbe(bin: string, spawn: (argv: string[]) => SpawnResult): PythonProbeResult {
  try {
    const output = spawn(probeArgv(bin))
    if (output.exitCode !== 0) {
      const detail =
        output.stderr.trim() || output.stdout.trim() || `exit code ${output.exitCode}`
      return { ok: false, error: `Python probe failed for ${bin}: ${detail}` }
    }

    const text = `${output.stdout}\n${output.stderr}`
    const match = PYTHON_VERSION_PATTERN.exec(text)
    if (!match) {
      return { ok: false, error: `Unexpected Python --version output for ${bin}: ${text.trim()}` }
    }
    return { ok: true, version: match[1] }
  } catch (error) {
    return { ok: false, error: `Python probe failed for ${bin}: ${errorMessage(error)}` }
  }
}

/** Clears the memoised probe results. Intended for tests and explicit re-probes. */
export function resetPythonProbeCache(): void {
  probeCache.clear()
}
