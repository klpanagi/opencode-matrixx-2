import { spawn } from "bun"
import { findPackagedSgBinary, isUsableSgBinary, resolveSgBinary } from "../../../shared/comment-scan/sg-invoke"
import { getAstGrepPath } from "../../../tools/ast-grep/cli-binary-path-resolution"
import { getSgCliPath } from "../../../tools/ast-grep/constants"
import type { CheckResult, DoctorCheck } from "../types"

type OptionalTool = { name: string; check: () => { available: boolean; version?: string } }

function spawnVersion(cmd: string, args: string[]): { available: boolean; version?: string } {
  try {
    const r = Bun.spawnSync([cmd, ...args], { stdout: "pipe", stderr: "pipe" })
    return { available: r.exitCode === 0, version: r.stdout.toString().trim().split("\n")[0]?.trim() || undefined }
  } catch { void 0; return { available: false } }
}

const BINARY_CHECKS: OptionalTool[] = [
  { name: "Gitleaks", check: () => spawnVersion("gitleaks", ["--version"]) },
  { name: "gh CLI", check: () => spawnVersion("gh", ["--version"]) },
  { name: "Docker", check: () => spawnVersion("docker", ["--version"]) },
]

const PYTHON_CHECKS: OptionalTool[] = [
  { name: "PyMuPDF (fitz)", check: () => spawnVersion("python3", ["-c", "import fitz; print(fitz.__version__)"]) },
  { name: "Playwright (CLI)", check: () => spawnVersion("playwright", ["--version"]) },
]

export const optionalToolsCheck: DoctorCheck = {
  name: "optional-tools",
  category: "tools",
  check: (): CheckResult => {
    const binaryResults = BINARY_CHECKS.map((t) => {
      const r = t.check()
      return { name: t.name, ...r }
    })
    let pythonResults: Array<{ name: string; available: boolean; version?: string }> = []
    try {
      const pyCheck = Bun.spawnSync(["python3", "--version"], { stdout: "pipe", stderr: "pipe" })
      if (pyCheck.exitCode === 0) pythonResults = PYTHON_CHECKS.map((t) => ({ name: t.name, ...t.check() }))
      else pythonResults = PYTHON_CHECKS.map((t) => ({ name: t.name, available: false, version: undefined }))
    } catch { void 0; pythonResults = PYTHON_CHECKS.map((t) => ({ name: t.name, available: false, version: undefined })) }
    const allResults = [...binaryResults, ...pythonResults]
    const available = allResults.filter((r) => r.available)
    const missing = allResults.filter((r) => !r.available)
    if (missing.length === 0) return { name: "optional-tools", status: "pass", message: `All optional tools available: ${available.map((r) => r.name).join(", ")}` }
    const detailLines = allResults.map((r) => (r.available ? `  ✓ ${r.name}${r.version ? ` (${r.version})` : ""}` : `  ✗ ${r.name} — not installed → fix: install ${r.name.split(" ")[0]}`))
    const missingList = missing.map((r) => r.name).join(", ")
    return { name: "optional-tools", status: "warn", message: `Available: ${available.length}, Missing: ${missing.length} (${missingList})`, detail: detailLines.join("\n") }
  },
}

type SgResolver = () => Promise<string>
type SgProbe = (path: string) => Promise<boolean>

const defaultSgProbe: SgProbe = (path) => isUsableSgBinary(path, spawn)

let sgResolver: SgResolver = resolveSgBinary
let sgProbe: SgProbe = defaultSgProbe

/** Test seam: inject the sg resolver and the candidate probe. Pass null to restore the real ones. */
export function _setCommentScanProbeForTesting(resolve: SgResolver | null, probe: SgProbe | null = null): void {
  sgResolver = resolve ?? resolveSgBinary
  sgProbe = probe ?? defaultSgProbe
}

export interface CommentScanReadiness {
  readonly available: boolean
  readonly path?: string
  readonly reason?: string
}

export async function probeCommentScan(
  resolve: SgResolver = sgResolver,
  probe: SgProbe = sgProbe,
): Promise<CommentScanReadiness> {
  try {
    return { available: true, path: await resolve() }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const candidates = await describeSgCandidates(probe)
    return { available: false, reason: candidates.length > 0 ? `${reason}; ${candidates.join("; ")}` : reason }
  }
}

async function describeSgCandidates(probe: SgProbe): Promise<string[]> {
  // Candidate order mirrors resolveSgBinary's resolution ladder; keep the lists in sync.
  const candidates = [
    { label: "packaged", path: findPackagedSgBinary() },
    { label: "cached", path: getSgCliPath() },
    { label: "resolved", path: await getAstGrepPath().catch(() => null) },
  ]
  const lines: string[] = []
  for (const candidate of candidates) {
    if (!candidate.path) {
      lines.push(`${candidate.label} sg not found`)
      continue
    }
    const usable = await probe(candidate.path)
    lines.push(`${candidate.label} ${candidate.path} ${usable ? "usable" : "failed --version probe"}`)
  }
  return lines
}

export const commentScanCheck: DoctorCheck = {
  name: "comment-scan",
  category: "tools",
  check: async (): Promise<CheckResult> => {
    const readiness = await probeCommentScan()
    if (readiness.available) {
      return {
        name: "comment-scan",
        status: "pass",
        message: `AST tier available via ${readiness.path}`,
        detail: `sg: ${readiness.path}`,
      }
    }
    return {
      name: "comment-scan",
      status: "warn",
      message: `regex tier only — ${readiness.reason}`,
      detail: "AST tier unavailable; regex-tier languages still scan in-process. Install @ast-grep/cli or remove a corrupt cached sg.",
    }
  },
}
