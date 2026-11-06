import { z } from "zod"

/**
 * Task 5 decision (security-audit skill integration) — validator placement.
 *
 * DECISION: `src/skills/schemas/security-audit.ts` (this module) is the
 * single source of truth (SoT) for security-audit finding + ledger shapes.
 * The T4 skill template checklists reference these schemas by name; T9
 * persistence imports them; T6 command exit codes derive from them.
 *
 * REJECTED (with reason):
 * - Hook-based validation (`src/hooks/`): rejected — validation must be
 *   importable by skill template authors, the audits store (T9), and tests
 *   without a hook lifecycle; a `PreToolUse`-style hook would run on every
 *   tool call (heavy-hook anti-pattern) and cannot serve as a shared type.
 *   No files under `src/hooks/` were touched.
 * - Inline-duplicate schemas (one copy in template, one in store): rejected —
 *   duplicates drift; exactly one definition lives here.
 *
 * Field names only (NOT a verbatim port) adapted from the vendored
 * Cloudflare `report-schema.json` / `validate-findings.cjs` /
 * `validate-coverage-ledger.cjs`: `fingerprint` regex, severity ladder
 * critical/high/medium/low/informational, `needs_validation` carries no
 * severity (external-decisive-fact rule), ledger unit statuses.
 * Follows the flat `src/config/schema/*.ts` convention
 * (`export const XSchema` + `z.infer` type alias, cf. `BgHandleSchema`
 * in `src/features/background-agent/handle-index.ts`).
 */

/** Stable source-derived identifier (vendored fingerprint pattern). */
export const FingerprintSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/,
    "fingerprint must match ^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$",
  )

/** Severity ladder (vendored `overall_severity` enum). */
export const SeveritySchema = z.enum([
  "critical",
  "high",
  "medium",
  "low",
  "informational",
])
export type Severity = z.infer<typeof SeveritySchema>

/**
 * Finding lifecycle status. `confirmed` / `needs_validation` / `rejected`
 * mirror the vendored report-schema verdicts; `deferred` covers the
 * quick-profile remainder (out-of-scope-for-this-run candidates).
 */
export const FindingStatusSchema = z.enum([
  "confirmed",
  "needs_validation",
  "rejected",
  "deferred",
])
export type FindingStatus = z.infer<typeof FindingStatusSchema>

/** Optional CWE reference, e.g. `CWE-79`. */
export const CweSchema = z
  .string()
  .regex(/^CWE-\d+$/, "CWE must look like CWE-<number>")
  .optional()

export const FindingLocationSchema = z
  .object({
    path: z.string().min(1),
    lines: z
      .array(z.number().int().min(1))
      .min(1)
      .optional(),
  })
  .strict()
export type FindingLocation = z.infer<typeof FindingLocationSchema>

export const FindingEvidenceSchema = z
  .object({
    root_cause: z.string().min(1),
    execution: z.string().min(1),
    remediation: z.string().min(1),
  })
  .strict()
export type FindingEvidence = z.infer<typeof FindingEvidenceSchema>

/**
 * One audit finding. Refine: `needs_validation` MUST NOT carry a severity
 * (vendored external-decisive-fact rule — unvalidated candidates get no
 * severity anchor).
 */
export const FindingSchema = z
  .object({
    fingerprint: FingerprintSchema,
    status: FindingStatusSchema,
    title: z.string().min(1),
    description: z.string().min(1),
    severity: SeveritySchema.optional(),
    cwe: CweSchema,
    location: FindingLocationSchema,
    evidence: FindingEvidenceSchema,
  })
  .strict()
  .refine(
    (finding) =>
      finding.status !== "needs_validation" || finding.severity === undefined,
    {
      message: "needs_validation findings must not carry a severity",
      path: ["severity"],
    },
  )
export type SecurityAuditFinding = z.infer<typeof FindingSchema>

/** Per-unit coverage states (vendored `STATUSES` set). */
export const LedgerUnitStatusSchema = z.enum([
  "planned",
  "not_applicable",
  "out_of_scope",
  "in_progress",
  "covered",
  "candidate",
  "blocked",
  "deferred",
])
export type LedgerUnitStatus = z.infer<typeof LedgerUnitStatusSchema>

export const LedgerUnitSchema = z
  .object({
    coverage_id: FingerprintSchema,
    status: LedgerUnitStatusSchema,
  })
  .strict()
export type LedgerUnit = z.infer<typeof LedgerUnitSchema>

/** Coverage ledger: seeded units plus run status (budget gate). */
export const LedgerSchema = z
  .object({
    units: z.array(LedgerUnitSchema),
    status: z.enum(["complete", "incomplete"]),
  })
  .strict()
export type SecurityAuditLedger = z.infer<typeof LedgerSchema>
