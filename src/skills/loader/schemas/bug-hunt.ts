import { isAbsolute, normalize } from "node:path"
import { z } from "zod"
import {
  CweSchema,
  FindingLocationSchema,
  FindingStatusSchema,
  FingerprintSchema,
  LedgerUnitStatusSchema,
  SeveritySchema,
} from "./security-audit"

/** Single source of truth for run-id validation in the schema and the store. */
export const RUN_ID_PATTERN = /^run-[1-9]\d*$/

export const REPRODUCERS_DIR_NAME = "reproducers"

const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/
const UNC_PATH = /^\\\\/

const PERCENT_ENCODED_SEPARATOR = /%2f|%5c/i

/** Every path field is later composed into a shell command, so the charset is deliberately narrow. */
export const SAFE_PATH_CHARS = /^[A-Za-z0-9._/@+-]+$/

function hasTraversalSegment(value: string): boolean {
  return value.split(/[\\/]+/).includes("..")
}

function hasOptionPrefix(value: string): boolean {
  return value.startsWith("-") || value.startsWith("@")
}

export function isConfinedProjectPath(value: string): boolean {
  if (
    value.includes("\u0000") ||
    PERCENT_ENCODED_SEPARATOR.test(value) ||
    !SAFE_PATH_CHARS.test(value)
  ) {
    return false
  }
  return (
    !isAbsolute(value) &&
    !WINDOWS_ABSOLUTE_PATH.test(value) &&
    !UNC_PATH.test(value) &&
    !hasTraversalSegment(value) &&
    !hasTraversalSegment(normalize(value)) &&
    !hasOptionPrefix(value)
  )
}

/** Run-relative paths must stay under `<run dir>/<topDir>/`. */
export function isConfinedRunRelative(value: string, topDir: string): boolean {
  if (!isConfinedProjectPath(value)) {
    return false
  }
  const segments = normalize(value).split(/[\\/]+/)
  return segments.length > 1 && segments[0] === topDir && segments[segments.length - 1] !== ""
}

function isConfinedReproducer(value: string): boolean {
  return isConfinedRunRelative(value, REPRODUCERS_DIR_NAME)
}

export const EvidenceTierSchema = z.enum(["E0", "E1", "E2", "E3"])

const BugClassSchema = z.enum([
  "function",
  "interface",
  "checking",
  "assignment",
  "timing",
  "build-package",
  "documentation",
  "algorithms",
  "other",
])

const ScanScopeSchema = z.enum(["file", "module", "project"])

const ScanDepthSchema = z.enum(["static", "dynamic", "deep"])

const StageSchema = z.enum(["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9"])

const ClassFilterSchema = z.union([BugClassSchema, z.literal("all"), z.string().regex(/^cwe-\d+$/i)])

export const SEVERITY_RANK: Record<z.infer<typeof SeveritySchema>, number> = {
  informational: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

const BugEvidenceSchema = z
  .object({
    oracle: z.string().min(1),
    witness: z.string().min(1),
    root_cause: z.string().min(1),
    remediation: z.string().min(1),
  })
  .strict()

export const BugFindingSchema = z
  .object({
    fingerprint: FingerprintSchema,
    bug_class: BugClassSchema,
    cwe: CweSchema,
    tier: EvidenceTierSchema,
    status: FindingStatusSchema,
    stage: StageSchema,
    title: z.string().min(1),
    description: z.string().min(1),
    severity: SeveritySchema.optional(),
    location: FindingLocationSchema,
    evidence: BugEvidenceSchema,
    reproducer: z.string().min(1).optional(),
    cross_ref: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((finding, ctx) => {
    if (finding.tier === "E0" && finding.severity !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "E0 findings must not carry a severity",
        path: ["severity"],
      })
    }
    if (finding.tier === "E0" && finding.status !== "needs_validation") {
      ctx.addIssue({
        code: "custom",
        message: "E0 findings must have status needs_validation",
        path: ["status"],
      })
    }
    if (
      finding.tier === "E1" &&
      finding.severity !== undefined &&
      SEVERITY_RANK[finding.severity] > SEVERITY_RANK.medium
    ) {
      ctx.addIssue({
        code: "custom",
        message: "E1 findings are capped at medium severity",
        path: ["severity"],
      })
    }
    if (finding.status === "needs_validation" && finding.tier !== "E0") {
      ctx.addIssue({
        code: "custom",
        message: "needs_validation requires tier E0",
        path: ["tier"],
      })
    }
    if (finding.tier === "E2" && finding.reproducer === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "E2 findings must reference a reproducer under reproducers/",
        path: ["reproducer"],
      })
    }
    if (finding.reproducer !== undefined && !isConfinedReproducer(finding.reproducer)) {
      ctx.addIssue({
        code: "custom",
        message: "reproducer must be a relative path under reproducers/ with no '..' segment or absolute path",
        path: ["reproducer"],
      })
    }
    if (!isConfinedProjectPath(finding.location.path)) {
      ctx.addIssue({
        code: "custom",
        message: "location.path must be a relative project path with no '..' segment or absolute path",
        path: ["location", "path"],
      })
    }
  })
export type BugFinding = z.infer<typeof BugFindingSchema>

export const BugLedgerUnitSchema = z
  .object({
    coverage_id: FingerprintSchema,
    status: LedgerUnitStatusSchema,
    install_hint: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((unit, ctx) => {
    if (unit.status === "blocked" && unit.install_hint === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "blocked units must carry an install hint",
        path: ["install_hint"],
      })
    }
    if (unit.status !== "blocked" && unit.install_hint !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "install_hint is only allowed on blocked units",
        path: ["install_hint"],
      })
    }
  })
export type BugLedgerUnit = z.infer<typeof BugLedgerUnitSchema>

const ToolInventorySchema = z
  .object({
    name: z.string().min(1),
    available: z.boolean(),
    version: z.string().min(1).optional(),
  })
  .strict()

export const BugHuntLedgerSchema = z
  .object({
    units: z.array(BugLedgerUnitSchema),
    tools: z.array(ToolInventorySchema).optional(),
    status: z.enum(["complete", "incomplete"]),
  })
  .strict()
export type BugHuntLedger = z.infer<typeof BugHuntLedgerSchema>

export const BugRunMetadataSchema = z
  .object({
    run: z.string().regex(RUN_ID_PATTERN, "run must look like run-<n>"),
    startedAt: z.string().min(1),
    scope: ScanScopeSchema,
    depth: ScanDepthSchema,
    class_filter: ClassFilterSchema,
    target: z.string().min(1).optional(),
    budget: z.number().int().min(0).optional(),
    funded: z.boolean(),
    status: z.enum(["complete", "incomplete"]),
  })
  .strict()
  .superRefine((metadata, ctx) => {
    if (metadata.target !== undefined && !isConfinedProjectPath(metadata.target)) {
      ctx.addIssue({
        code: "custom",
        message: "target must be a project-relative path with no '..' segment or absolute path",
        path: ["target"],
      })
    }
  })
export type BugRunMetadata = z.infer<typeof BugRunMetadataSchema>

export const BugFindingsSchema = z.array(BugFindingSchema)
export type BugFindings = z.infer<typeof BugFindingsSchema>
