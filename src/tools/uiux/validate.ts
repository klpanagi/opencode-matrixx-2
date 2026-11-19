// Integrity validation for the installed `ui-ux-pro-max` skill pack.
//
// Read-only: the lock manifest must agree with the files on disk, the upstream
// data validator runs when present, and Python availability is reported. Every
// failure becomes check data — this module never throws.
import { type Dirent, existsSync, readdirSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import type { PackLock } from "../../skills/packs"
import { PACK_LOCK_FILENAME, readLock } from "../../skills/packs"
import { type PythonProbeResult, probePython } from "./python"
import { formatToolError, runPackScript } from "./spawn"
import type { UiuxToolDeps, UiuxToolError } from "./types"

/** Names of the checks reported by `uiux_validate`. */
export type UiuxValidateCheckName = "lock" | "files" | "validator" | "validator_run" | "python"

/** One named integrity check. `skipped` marks an optional check that did not run. */
export interface UiuxValidateCheck {
  name: UiuxValidateCheckName
  ok: boolean
  /** True when the check was not applicable (missing optional validator). */
  skipped?: boolean
  /** Human-readable evidence: path, counts, or a capped subprocess snippet. */
  detail?: string
}

/** Full validation report. `ok` is false when any non-skipped check failed. */
export interface UiuxValidateReport {
  ok: boolean
  checks: UiuxValidateCheck[]
  python: PythonProbeResult
}

/** Result of one `uiux_validate` run — never thrown, always returned. */
export type UiuxValidateResult = UiuxValidateReport | UiuxToolError

/** Injectable Python probe so tests never touch the real interpreter. */
export type UiuxPythonProbe = (bin: string) => PythonProbeResult

/** Optional seams for `runUiuxValidate`. */
export interface UiuxValidateOptions {
  /** Defaults to the memoised `probePython`. */
  probe?: UiuxPythonProbe
}

/** Relative path of the upstream data validator under the skill root. */
const VALIDATOR_RELATIVE_PATH = join("scripts", "validate_data.py")
/** Cap on subprocess text embedded in a check detail. */
const SNIPPET_LIMIT = 400

/**
 * Caps subprocess output so a noisy validator cannot flood the tool result.
 * Empty output yields an empty string so callers can pick their own fallback.
 */
function snippet(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length === 0) return ""
  return trimmed.length <= SNIPPET_LIMIT ? trimmed : `${trimmed.slice(0, SNIPPET_LIMIT)}…`
}

/** Directories holding interpreter byproducts; never part of the pack payload. */
const IGNORED_DIRECTORY_NAMES = new Set(["__pycache__"])
/** File suffixes written by Python; excluded from the manifest comparison. */
const IGNORED_FILE_SUFFIXES = [".pyc", ".pyo"]
/** OS metadata files that appear without being installed. */
const IGNORED_FILE_NAMES = new Set([".DS_Store"])

/** Python bytecode and OS metadata never belong to the lock manifest. */
function isIgnoredFile(name: string): boolean {
  return (
    IGNORED_FILE_NAMES.has(name) ||
    IGNORED_FILE_SUFFIXES.some((suffix) => name.endsWith(suffix))
  )
}

/** Every regular file under `dir`, relative to it; empty when unreadable. */
function listFilesRecursive(dir: string, relativeDir = ""): string[] {
  const currentDir = relativeDir.length > 0 ? join(dir, relativeDir) : dir

  let entries: Dirent[]
  try {
    entries = readdirSync(currentDir, { withFileTypes: true })
  } catch {
    return []
  }

  const files: string[] = []
  for (const entry of entries) {
    const relativePath = relativeDir.length > 0 ? `${relativeDir}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORY_NAMES.has(entry.name)) continue
      files.push(...listFilesRecursive(dir, relativePath))
    } else if (entry.isFile() && !isIgnoredFile(entry.name)) {
      files.push(relativePath)
    }
  }
  return files.sort()
}

/**
 * Lock paths are relative to the pack version directory, so the skill root
 * `<version>/skills/<name>` maps to `skills/<name>`. Entries outside that
 * prefix belong to another skill and are not counted here.
 */
function expectedFiles(lock: PackLock, coreSkillRoot: string): string[] {
  const scope = `${basename(dirname(coreSkillRoot))}/${basename(coreSkillRoot)}`
  return lock.files.filter((file) => file === scope || file.startsWith(`${scope}/`))
}

/** Reads the lock at the version directory and reports whether it parsed. */
function lockCheck(versionDir: string): { lock: PackLock | null; check: UiuxValidateCheck } {
  const lockPath = join(versionDir, PACK_LOCK_FILENAME)
  const lock = readLock(versionDir)
  return lock === null
    ? {
        lock,
        check: { name: "lock", ok: false, detail: `${PACK_LOCK_FILENAME} at ${lockPath} is unreadable or malformed` },
      }
    : { lock, check: { name: "lock", ok: true, detail: `${PACK_LOCK_FILENAME} at ${lockPath}` } }
}

/** Compares the lock manifest for this skill with the files on disk. */
function filesCheck(
  lock: PackLock | null,
  diskFiles: string[],
  coreSkillRoot: string,
): UiuxValidateCheck {
  if (lock === null) {
    return {
      name: "files",
      ok: false,
      detail: `cannot verify files without a valid ${PACK_LOCK_FILENAME}`,
    }
  }

  const expected = expectedFiles(lock, coreSkillRoot)
  return expected.length === diskFiles.length
    ? {
        name: "files",
        ok: true,
        detail: `${PACK_LOCK_FILENAME} agrees with ${diskFiles.length} files on disk`,
      }
    : {
        name: "files",
        ok: false,
        detail: `expected ${expected.length} files, actual ${diskFiles.length} on disk`,
      }
}

/** Runs the upstream data validator and turns its outcome into a check. */
async function validatorRunCheck(
  deps: UiuxToolDeps,
  validatorPath: string,
): Promise<UiuxValidateCheck> {
  const result = await runPackScript(deps, { script: validatorPath, args: [] })
  if (!result.ok) {
    const output = snippet(result.detail ?? "")
    return {
      name: "validator_run",
      ok: false,
      detail: output.length > 0 ? `${result.message}: ${output}` : result.message,
    }
  }

  const output = snippet(result.stdout)
  return {
    name: "validator_run",
    ok: true,
    detail: output.length > 0 ? output : "validator passed",
  }
}

/** Probes Python, converting a throwing probe into a failure result. */
function probeSafely(probe: UiuxPythonProbe, bin: string): PythonProbeResult {
  try {
    return probe(bin)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `Python probe failed: ${message}` }
  }
}

/**
 * Validates the installed pack. Never throws: a missing lock returns the shared
 * `not_installed` error; every other failure is reported as a failing check.
 */
export async function runUiuxValidate(
  deps: UiuxToolDeps,
  options: UiuxValidateOptions = {},
): Promise<UiuxValidateResult> {
  const versionDir = dirname(dirname(deps.coreSkillRoot))
  if (!existsSync(join(versionDir, PACK_LOCK_FILENAME))) {
    return formatToolError("not_installed", "The ui-ux-pro-max skill pack is not installed")
  }

  const { lock, check: lockReport } = lockCheck(versionDir)
  const checks: UiuxValidateCheck[] = [
    lockReport,
    filesCheck(lock, listFilesRecursive(deps.coreSkillRoot), deps.coreSkillRoot),
  ]

  const validatorPath = join(deps.coreSkillRoot, VALIDATOR_RELATIVE_PATH)
  if (existsSync(validatorPath)) {
    checks.push({ name: "validator", ok: true, detail: "scripts/validate_data.py is present" })
    checks.push(await validatorRunCheck(deps, validatorPath))
  } else {
    checks.push({ name: "validator", ok: true, skipped: true, detail: "not present" })
  }

  const probe = options.probe ?? ((bin: string) => probePython(bin))
  const python = probeSafely(probe, deps.pythonBin)
  checks.push({
    name: "python",
    ok: python.ok,
    detail: python.ok ? `Python ${python.version ?? "unknown"}` : (python.error ?? "Python probe failed"),
  })

  return { ok: checks.every((check) => check.ok), checks, python }
}
