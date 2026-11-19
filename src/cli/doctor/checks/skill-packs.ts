import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { getOpenCodeConfigDir } from "../../../shared/config/opencode-config-dir"
import { detectConfigFile, readJsoncFile } from "../../../shared/text/jsonc-parser"
import { PACK_CATALOG_BY_ID } from "../../../skills/packs/catalog"
import { CORE_PACK_ID, PACK_SKILL_FILENAME, PACK_SKILLS_DIRNAME } from "../../../skills/packs/constants"
import { PACK_LOCK_FILENAME, readLock, resolvePacksRoot } from "../../../skills/packs/store"
import type { PackCatalogEntry, PackId, PackLock, PackRisk } from "../../../skills/packs/types"
import { type PythonProbeResult, probePython, resolvePythonBin } from "../../../tools/uiux/python"
import { PINNED_INTEGRITY } from "../../skill-pack/constants"
import type { CheckResult, DoctorCheck } from "../types"

/**
 * `matrixx doctor` check for installed external skill packs.
 *
 * Reports the pinned version and integrity match per installed pack, the
 * consent flags its catalog risks still require, whether the core
 * `ui-ux-pro-max` skill is present, and whether Python is available for
 * Python-backed packs. Installed content is untrusted input, so every
 * filesystem read degrades to a finding instead of throwing.
 */

/** The `skill_packs` config slice this check reads; absent fields keep defaults. */
export interface SkillPacksCheckConfig {
  enabled?: boolean
  root?: string
  python_bin?: string
  pinned_versions?: Record<string, string>
  allow_network_packs?: boolean
  allow_api_key_packs?: boolean
}

/** Optional seams; tests inject config, root, and Python probing. */
export interface SkillPacksCheckDeps {
  readConfig?: () => SkillPacksCheckConfig
  resolveRoot?: (config: SkillPacksCheckConfig) => string
  resolvePython?: (config: SkillPacksCheckConfig) => string | undefined
  probe?: (bin: string | undefined) => PythonProbeResult
  pinnedIntegrity?: string
}

const CHECK_NAME = "skill-packs"
const PYTHON_FIX = "Install Python 3 (python3) and re-run matrixx doctor"
const ADD_HINT = "matrixx skill add ui-ux-pro-max"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  return entries.length === 0 ? undefined : Object.fromEntries(entries)
}

/**
 * Reads the `skill_packs` block from one Matrixx config base path. Unknown or
 * mistyped fields are ignored rather than failing the whole check.
 */
function readSkillPacksBlock(basePath: string): SkillPacksCheckConfig {
  const detected = detectConfigFile(basePath)
  if (detected.format === "none") return {}
  const raw = readJsoncFile<Record<string, unknown>>(detected.path)
  const block = raw?.skill_packs
  if (!isRecord(block)) return {}

  const config: SkillPacksCheckConfig = {}
  if (typeof block.enabled === "boolean") config.enabled = block.enabled
  if (typeof block.root === "string") config.root = block.root
  if (typeof block.python_bin === "string") config.python_bin = block.python_bin
  if (typeof block.allow_network_packs === "boolean") config.allow_network_packs = block.allow_network_packs
  if (typeof block.allow_api_key_packs === "boolean") config.allow_api_key_packs = block.allow_api_key_packs
  const pinned = readStringRecord(block.pinned_versions)
  if (pinned) config.pinned_versions = pinned
  return config
}

/** User config first, then project `.opencode` so project keys win. */
function loadSkillPacksConfig(): SkillPacksCheckConfig {
  const userBase = join(getOpenCodeConfigDir({ binary: "opencode" }), "matrixx")
  const projectBase = join(process.cwd(), ".opencode", "matrixx")
  return { ...readSkillPacksBlock(userBase), ...readSkillPacksBlock(projectBase) }
}

function catalogEntry(packId: string): PackCatalogEntry | undefined {
  if (!Object.hasOwn(PACK_CATALOG_BY_ID, packId)) return undefined
  return PACK_CATALOG_BY_ID[packId as PackId]
}

function readDirNames(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/** One version directory under the packs root; `lock` is null when unreadable. */
interface PackCandidate {
  packId: string
  version: string
  dir: string
  lock: PackLock | null
}

/**
 * Every version directory that carries a `lock.json`, including corrupt ones —
 * `listInstalledPacks` drops those, and the doctor must report them.
 */
function listPackCandidates(root: string): PackCandidate[] {
  const candidates: PackCandidate[] = []
  for (const packId of readDirNames(root)) {
    const packDir = join(root, packId)
    for (const version of readDirNames(packDir)) {
      const dir = join(packDir, version)
      if (!existsSync(join(dir, PACK_LOCK_FILENAME))) continue
      candidates.push({ packId, version, dir, lock: readLock(dir) })
    }
  }
  return candidates.sort((a, b) =>
    a.packId === b.packId ? a.version.localeCompare(b.version) : a.packId.localeCompare(b.packId),
  )
}

function resolvedRisks(candidate: PackCandidate, lock: PackLock): PackRisk[] {
  if (lock.risks.length > 0) return lock.risks
  return catalogEntry(candidate.packId)?.risk ?? []
}

function needsPython(candidate: PackCandidate): boolean {
  if (candidate.lock?.pythonRequired) return true
  const risks = candidate.lock ? resolvedRisks(candidate, candidate.lock) : (catalogEntry(candidate.packId)?.risk ?? [])
  return risks.includes("requiresPython")
}

interface PackFinding {
  label: string
  problems: string[]
  warnings: string[]
  notes: string[]
}

function removeAndAddFix(packId: string): string {
  return `matrixx skill remove ${packId} && matrixx skill add ${packId}`
}

function assessPack(
  candidate: PackCandidate,
  config: SkillPacksCheckConfig,
  pinnedIntegrity: string,
): PackFinding {
  const label = `${candidate.packId} ${candidate.version}`
  const finding: PackFinding = { label, problems: [], warnings: [], notes: [] }
  const lock = candidate.lock

  if (lock === null) {
    finding.problems.push(`corrupt lock.json (fix: ${removeAndAddFix(candidate.packId)})`)
    return finding
  }

  const pinnedVersion = config.pinned_versions?.[candidate.packId] ?? catalogEntry(candidate.packId)?.version
  if (pinnedVersion && lock.version !== pinnedVersion) {
    finding.warnings.push(
      `version ${lock.version} differs from pinned ${pinnedVersion} (fix: ${removeAndAddFix(candidate.packId)})`,
    )
  }

  const catalogVersion = catalogEntry(candidate.packId)?.version
  if (catalogVersion === undefined) {
    finding.notes.push("integrity unknown (pack not in catalog)")
  } else if (lock.version !== catalogVersion) {
    finding.notes.push(`integrity unknown (version ${lock.version} is not the pinned ${catalogVersion})`)
  } else if (lock.integrity !== pinnedIntegrity) {
    finding.problems.push(`integrity does not match the pinned digest (fix: ${removeAndAddFix(candidate.packId)})`)
  } else {
    finding.notes.push("integrity pinned")
  }

  const risks = resolvedRisks(candidate, lock)
  if (risks.includes("requiresNetwork") && !config.allow_network_packs) {
    finding.warnings.push("requires network consent (fix: re-run with --allow-network)")
  }
  if (risks.includes("requiresApiKeys") && !config.allow_api_key_packs) {
    finding.warnings.push("requires API-key consent (fix: re-run with --allow-api-keys)")
  }

  if (candidate.packId === CORE_PACK_ID) {
    const coreSkill = join(candidate.dir, PACK_SKILLS_DIRNAME, CORE_PACK_ID, PACK_SKILL_FILENAME)
    if (!existsSync(coreSkill)) {
      finding.problems.push(`core skill missing at ${PACK_SKILLS_DIRNAME}/${CORE_PACK_ID}/${PACK_SKILL_FILENAME}`)
    } else {
      finding.notes.push("core skill present")
    }
  }

  return finding
}

function detailFor(findings: PackFinding[], pythonLine: string | null): string {
  const lines: string[] = []
  for (const finding of findings) {
    const reasons = [...finding.problems, ...finding.warnings]
    const status = reasons.length > 0 ? reasons.join("; ") : `ok (${finding.notes.join(", ")})`
    lines.push(`  ${finding.label}: ${status}`)
  }
  if (pythonLine) lines.push(`  ${pythonLine}`)
  return lines.join("\n")
}

function runSkillPacksCheck(deps: SkillPacksCheckDeps): CheckResult {
  const readConfig = deps.readConfig ?? loadSkillPacksConfig
  const resolveRoot = deps.resolveRoot ?? ((config: SkillPacksCheckConfig) => resolvePacksRoot({ root: config.root }))
  const resolvePython = deps.resolvePython ?? ((config: SkillPacksCheckConfig) => resolvePythonBin(config))
  const probe = deps.probe ?? ((bin: string | undefined) => probePython(bin))
  const pinnedIntegrity = deps.pinnedIntegrity ?? PINNED_INTEGRITY

  try {
    const config = readConfig()
    if (config.enabled === false) {
      return { name: CHECK_NAME, status: "pass", message: "skill packs disabled (skill_packs.enabled=false)" }
    }

    const candidates = listPackCandidates(resolveRoot(config))
    if (candidates.length === 0) {
      return {
        name: CHECK_NAME,
        status: "pass",
        message: `no skill packs installed (optional) - add one with: ${ADD_HINT}`,
      }
    }

    const findings = candidates.map((candidate) => assessPack(candidate, config, pinnedIntegrity))

    let pythonLine: string | null = null
    const pythonNeeded = candidates.some(needsPython)
    if (pythonNeeded) {
      const pythonBin = resolvePython(config)
      const result = pythonBin ? probe(pythonBin) : { ok: false }
      pythonLine = result.ok ? `Python ${result.version}` : `Python: not found (fix: ${PYTHON_FIX})`
      if (!result.ok) {
        const target = findings[0]
        if (target) target.warnings.push(`Python interpreter not found (fix: ${PYTHON_FIX})`)
      }
    }

    const failed = findings.filter((finding) => finding.problems.length > 0)
    const warned = findings.filter((finding) => finding.problems.length === 0 && finding.warnings.length > 0)

    if (failed.length > 0) {
      const summary = failed.map((finding) => `${finding.label}: ${finding.problems[0]}`).join("; ")
      return {
        name: CHECK_NAME,
        status: "fail",
        message: `skill pack problems: ${summary}`,
        detail: detailFor(findings, pythonLine),
      }
    }

    if (warned.length > 0) {
      const summary = warned.map((finding) => `${finding.label}: ${finding.warnings[0]}`).join("; ")
      return {
        name: CHECK_NAME,
        status: "warn",
        message: `skill pack warnings: ${summary}`,
        detail: detailFor(findings, pythonLine),
      }
    }

    const healthy = findings.map((finding) => finding.label).join(", ")
    const pythonSuffix = pythonLine?.startsWith("Python ") && !pythonLine.includes("not found") ? ` (${pythonLine})` : ""
    return {
      name: CHECK_NAME,
      status: "pass",
      message: `skill packs ok: ${healthy}${pythonSuffix}`,
      detail: detailFor(findings, pythonLine),
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { name: CHECK_NAME, status: "pass", message: `skill packs check skipped: ${reason}` }
  }
}

/** Factory so tests can inject config, root, and Python probe seams. */
export function createSkillPacksCheck(deps: SkillPacksCheckDeps = {}): DoctorCheck {
  return {
    name: CHECK_NAME,
    category: "dependencies",
    check: () => runSkillPacksCheck(deps),
  }
}

export const skillPacksCheck: DoctorCheck = createSkillPacksCheck()
