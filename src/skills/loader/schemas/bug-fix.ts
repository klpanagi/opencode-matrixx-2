import { posix } from "node:path"
import { z } from "zod"
import {
  EvidenceTierSchema,
  isConfinedProjectPath,
  isConfinedRunRelative,
  REPRODUCERS_DIR_NAME,
  RUN_ID_PATTERN,
  SAFE_PATH_CHARS,
  SEVERITY_RANK,
} from "./bug-hunt"
import { FindingLocationSchema, FingerprintSchema, SeveritySchema } from "./security-audit"

const SHA256_PATTERN = /^[0-9a-f]{64}$/
const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,64}$/
const EVIDENCE_DIR_NAME = "evidence"
const PATCHES_DIR_NAME = "patches"
const TESTS_PATH_PATTERN = /^tests\/[A-Za-z0-9._/@+-]+\.test\.ts$/

const RESERVED_PATCH_ROOTS = new Set([".matrixx", ".git"])

function isPlainPosixPath(value: string): boolean {
  if (value.includes("\\") || value.includes("\u0000") || !SAFE_PATH_CHARS.test(value)) {
    return false
  }
  return posix.normalize(value) === value && value !== "." && !value.startsWith("./")
}

function isTestPath(value: string): boolean {
  return isPlainPosixPath(value) && TESTS_PATH_PATTERN.test(value)
}

const Sha256Schema = z.string().regex(SHA256_PATTERN)
const CommitShaSchema = z.string().regex(COMMIT_SHA_PATTERN)


const OptionsSchema = z
  .object({
    fix_budget: z.int().min(1),
    max_attempts: z.int().min(1).max(5),
    min_severity: SeveritySchema,
    mutation: z.boolean(),
    allow_exec: z.literal(true),
    verify: z.boolean(),
  })
  .strict()

const FindingSnapshotSchema = z
  .object({
    tier: EvidenceTierSchema,
    severity: SeveritySchema.optional(),
    title: z.string().min(1),
    location: FindingLocationSchema,
    reproducer: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    if (snapshot.reproducer !== undefined && !isConfinedRunRelative(snapshot.reproducer, REPRODUCERS_DIR_NAME)) {
      ctx.addIssue({
        code: "custom",
        message: `reproducer must be run-relative under ${REPRODUCERS_DIR_NAME}/`,
        path: ["reproducer"],
      })
    }
    if (!isConfinedProjectPath(snapshot.location.path)) {
      ctx.addIssue({
        code: "custom",
        message: "location.path must be project-relative with no '..' segment or absolute prefix",
        path: ["location", "path"],
      })
    }
  })

const PristineRunSchema = z
  .object({
    attempt: z.int().min(1),
    exit_code: z.int(),
    signature_hash: Sha256Schema,
  })
  .strict()

const PatchedRunSchema = z
  .object({
    attempt: z.int().min(1),
    exit_code: z.int(),
  })
  .strict()

const ReproducerRefSchema = z
  .object({
    path: z.string().min(1),
    signature_hash: Sha256Schema,
    pristine_runs: z.array(PristineRunSchema).min(1),
    pristine_failures: z.int().min(0),
    deterministic: z.boolean(),
    patched_passes: z.int().min(0).optional(),
    patched_runs: z.array(PatchedRunSchema).optional(),
  })
  .strict()
  .superRefine((ref, ctx) => {
    if (!isConfinedRunRelative(ref.path, REPRODUCERS_DIR_NAME)) {
      ctx.addIssue({
        code: "custom",
        message: `path must be run-relative under ${REPRODUCERS_DIR_NAME}/`,
        path: ["path"],
      })
    }
  })

const PatchFileSchema = z
  .object({
    path: z.string().min(1),
    before_sha256: Sha256Schema.nullable(),
    after_sha256: Sha256Schema,
  })
  .strict()

const PatchRefSchema = z
  .object({
    files: z.array(PatchFileSchema).min(1),
    diff_path: z.string().min(1),
    changed_lines: z.int().min(0),
    commit_sha: CommitShaSchema,
  })
  .strict()
  .superRefine((patch, ctx) => {
    patch.files.forEach((file, index) => {
      if (!isConfinedProjectPath(file.path) || !isPlainPosixPath(file.path)) {
        ctx.addIssue({
          code: "custom",
          message:
            "patch file path must be a plain POSIX project-relative path with no '..', backslash, or dot segment",
          path: ["files", index, "path"],
        })
      }
      const segments = file.path.split("/")
      const lowered = segments.map((segment) => segment.toLowerCase())
      if (lowered.some((segment) => RESERVED_PATCH_ROOTS.has(segment))) {
        ctx.addIssue({
          code: "custom",
          message: "a patch may not target .matrixx/ or .git/ paths",
          path: ["files", index, "path"],
        })
      }
    })
    if (!isConfinedRunRelative(patch.diff_path, PATCHES_DIR_NAME)) {
      ctx.addIssue({
        code: "custom",
        message: `diff_path must be run-relative under ${PATCHES_DIR_NAME}/`,
        path: ["diff_path"],
      })
    }
  })

const RegressionTestSchema = z
  .object({
    path: z.string().min(1),
    failed_on_pristine: z.literal(true),
    before_absent: z.literal(true),
    pristine_failure_signature: Sha256Schema,
    evidence_path: z.string().min(1),
    diff_path: z.string().min(1),
  })
  .strict()
  .superRefine((test, ctx) => {
    if (!isTestPath(test.path) || !isConfinedProjectPath(test.path)) {
      ctx.addIssue({
        code: "custom",
        message: "path must be a plain project-relative tests/<name>.test.ts file",
        path: ["path"],
      })
    }
    if (!isConfinedRunRelative(test.evidence_path, EVIDENCE_DIR_NAME)) {
      ctx.addIssue({
        code: "custom",
        message: `evidence_path must be run-relative under ${EVIDENCE_DIR_NAME}/`,
        path: ["evidence_path"],
      })
    }
    if (!isConfinedRunRelative(test.diff_path, PATCHES_DIR_NAME)) {
      ctx.addIssue({
        code: "custom",
        message: `diff_path must be run-relative under ${PATCHES_DIR_NAME}/`,
        path: ["diff_path"],
      })
    }
  })

const GateStatusSchema = z.enum(["pass", "fail", "blocked", "skipped"])

const GateResultSchema = z
  .object({
    status: GateStatusSchema,
    detail: z.string().min(1),
    evidence_path: z.string().min(1).optional(),
    install_hint: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((gate, ctx) => {
    if (gate.status === "blocked" && gate.install_hint === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "blocked gates must carry exactly one install hint",
        path: ["install_hint"],
      })
    }
    if (gate.status !== "blocked" && gate.install_hint !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "install_hint is only valid on blocked gates",
        path: ["install_hint"],
      })
    }
    if (gate.evidence_path !== undefined && !isConfinedRunRelative(gate.evidence_path, EVIDENCE_DIR_NAME)) {
      ctx.addIssue({
        code: "custom",
        message: `evidence_path must be run-relative under ${EVIDENCE_DIR_NAME}/`,
        path: ["evidence_path"],
      })
    }
  })

const GatesSchema = z
  .object({
    G1: GateResultSchema.optional(),
    G2: GateResultSchema.optional(),
    G3: GateResultSchema.optional(),
    G4: GateResultSchema.optional(),
    G5: GateResultSchema.optional(),
  })
  .strict()

const IndependentVerificationSchema = z
  .object({
    verifier: z.literal("merovingian"),
    status: z.enum(["pass", "fail", "blocked"]),
    clean_checkout: z.boolean(),
    detail: z.string().min(1),
    evidence_path: z.string().min(1).optional(),
    reverified_at: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((verification, ctx) => {
    if (
      verification.evidence_path !== undefined &&
      !isConfinedRunRelative(verification.evidence_path, EVIDENCE_DIR_NAME)
    ) {
      ctx.addIssue({
        code: "custom",
        message: `evidence_path must be run-relative under ${EVIDENCE_DIR_NAME}/`,
        path: ["evidence_path"],
      })
    }
  })

const REQUIRED_PLAUSIBLE_GATES = ["G1", "G2", "G3", "G4"] as const

export const FixRecordSchema = z
  .object({
    schema_version: z.literal(1),
    run: z.string().regex(RUN_ID_PATTERN),
    finding_fingerprint: FingerprintSchema,
    status: z.enum(["plausible", "rejected", "abandoned", "unreproducible"]),
    created_at: z.string().min(1),
    updated_at: z.string().min(1).optional(),
    duration_ms: z.int().min(0),
    attempts: z.int().min(0),
    options: OptionsSchema,
    sandbox: z.literal("timeout-only"),
    finding: FindingSnapshotSchema,
    ineligible: z.object({ reason: z.string().min(1) }).strict().optional(),
    reproducer: ReproducerRefSchema.optional(),
    patch: PatchRefSchema.optional(),
    regression_test: RegressionTestSchema.optional(),
    gates: GatesSchema,
    independent_verification: IndependentVerificationSchema.optional(),
    terminal_reason: z.string().min(1),
    notes: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((record, ctx) => {
    const fail = (path: PropertyKey[], message: string) => {
      ctx.addIssue({ code: "custom", message, path: path as (string | number)[] })
    }
    const gateKeys = Object.keys(record.gates)
    if (record.gates.G5 !== undefined && !record.options.mutation) {
      fail(["gates", "G5"], "G5 must be omitted when --mutation was not passed")
    }
    const testPaths = record.patch?.files.filter((file) => isTestPath(file.path)) ?? []

    if (record.attempts > record.options.max_attempts) {
      fail(["attempts"], "attempts cannot exceed options.max_attempts")
    }
    const severity = record.finding.severity
    if (
      record.ineligible === undefined &&
      severity !== undefined &&
      SEVERITY_RANK[severity] < SEVERITY_RANK[record.options.min_severity]
    ) {
      fail(["finding", "severity"], "the finding is below the --min-severity threshold and must be skipped")
    }
    if (record.status !== "abandoned" && severity === undefined) {
      fail(["finding", "severity"], "only abandoned records may omit the finding severity")
    }
    if (
      record.status !== "abandoned" &&
      (record.finding.tier === "E0" || record.finding.tier === "E1")
    ) {
      fail(["finding", "tier"], "only abandoned records may carry an E0 or E1 finding")
    }

    if (record.patch !== undefined && record.finding.reproducer === undefined) {
      fail(["finding", "reproducer"], "a record with a patch must carry the finding reproducer")
    }

    if (record.status === "plausible") {
      if (record.patch === undefined) {
        fail(["patch"], "plausible records require a patch")
      }
      if (record.reproducer === undefined) {
        fail(["reproducer"], "plausible records require reproducer trust evidence")
      }
      if (record.finding.tier !== "E2" && record.finding.tier !== "E3") {
        fail(["finding", "tier"], "plausible records require an E2 or E3 finding")
      }
      if (record.independent_verification === undefined) {
        fail(["independent_verification"], "plausible records require independent verification")
      } else if (record.independent_verification.status !== "pass") {
        fail(["independent_verification", "status"], "plausible records require a passing verification")
      } else if (record.independent_verification.clean_checkout !== true) {
        fail(["independent_verification", "clean_checkout"], "the verifier must use a clean checkout")
      }
      for (const gate of REQUIRED_PLAUSIBLE_GATES) {
        if (record.gates[gate] === undefined) {
          fail(["gates", gate], `${gate} is required for a plausible record`)
        } else if (record.gates[gate]?.status !== "pass") {
          fail(["gates", gate], `${gate} must pass for a plausible record`)
        }
      }
      if (record.gates.G5 !== undefined && record.gates.G5.status === "fail") {
        fail(["gates", "G5"], "G5 must not fail on a plausible record")
      }
      if (record.reproducer !== undefined) {
        const ref = record.reproducer
        if (ref.deterministic !== true) {
          fail(["reproducer", "deterministic"], "the reproducer must be deterministic")
        }
        if (ref.pristine_failures < 3) {
          fail(["reproducer", "pristine_failures"], "the reproducer must fail at least three times")
        }
        if (ref.pristine_runs.length !== ref.pristine_failures) {
          fail(["reproducer", "pristine_failures"], "pristine_failures must match the recorded pristine runs")
        }
        if (new Set(ref.pristine_runs.map((run) => run.attempt)).size !== ref.pristine_runs.length) {
          fail(["reproducer", "pristine_runs"], "pristine run attempts must be unique")
        }
        ref.pristine_runs.forEach((run, index) => {
          if (run.exit_code === 0) {
            fail(["reproducer", "pristine_runs", index, "exit_code"], "a pristine run must fail")
          }
          if (run.signature_hash !== ref.signature_hash) {
            fail(
              ["reproducer", "pristine_runs", index, "signature_hash"],
              "every pristine run must reproduce the recorded failure signature",
            )
          }
        })
        if (ref.patched_passes === undefined || ref.patched_passes < 3) {
          fail(["reproducer", "patched_passes"], "the reproducer must pass at least three times after the patch")
        } else if (ref.patched_runs === undefined) {
          fail(["reproducer", "patched_runs"], "the three passing post-patch runs must be recorded")
        } else if (ref.patched_runs.length !== ref.patched_passes) {
          fail(["reproducer", "patched_passes"], "patched_passes must match the recorded patched runs")
        } else {
          ref.patched_runs.forEach((run, index) => {
            if (run.exit_code !== 0) {
              fail(["reproducer", "patched_runs", index, "exit_code"], "a patched run must pass")
            }
          })
        }
      }
      if (record.patch !== undefined) {
        if (record.patch.changed_lines > 60) {
          fail(["patch", "changed_lines"], "a plausible patch may not change more than 60 lines")
        }
      }
      if (record.ineligible !== undefined) {
        fail(["ineligible"], "a plausible record cannot be marked ineligible")
      }
    }

    if (record.status === "rejected") {
      if (record.attempts < 1) {
        fail(["attempts"], "a rejected record must record at least one attempt")
      }
      const failedGate = REQUIRED_PLAUSIBLE_GATES.some((gate) => record.gates[gate]?.status === "fail")
      if (!failedGate && record.attempts !== record.options.max_attempts) {
        fail(["gates"], "a rejected record needs a failing gate or an exhausted attempt budget")
      }
      if (record.ineligible !== undefined) {
        fail(["ineligible"], "a rejected record cannot be marked ineligible")
      }
    }

    if (record.status === "abandoned") {
      if (record.attempts !== 0) {
        fail(["attempts"], "an abandoned record cannot have attempts")
      }
      if (record.patch !== undefined) {
        fail(["patch"], "an abandoned record cannot carry a patch")
      }
      if (gateKeys.length > 0) {
        fail(["gates"], "an abandoned record cannot carry gate results")
      }
      if (record.independent_verification !== undefined) {
        fail(["independent_verification"], "an abandoned record cannot carry verification")
      }
      if (
        record.reproducer?.patched_passes !== undefined ||
        record.reproducer?.patched_runs !== undefined
      ) {
        fail(["reproducer"], "an abandoned record cannot carry post-patch runs")
      }
      if (
        record.ineligible === undefined &&
        !/circuit breaker|aborted|operator/i.test(record.terminal_reason)
      ) {
        fail(["terminal_reason"], "abandoned without ineligibility needs a circuit-breaker or abort reason")
      }
    }

    if (record.status === "unreproducible") {
      if (gateKeys.length > 0) {
        fail(["gates"], "an unreproducible record cannot carry gate results")
      }
      if (record.reproducer === undefined) {
        fail(["reproducer"], "an unreproducible record must record the reproducer evidence")
      } else if (record.reproducer.deterministic === true && record.reproducer.pristine_failures >= 3) {
        fail(["reproducer"], "an unreproducible record needs a nondeterministic or short-failing reproducer")
      }
      if (record.patch !== undefined) {
        fail(["patch"], "an unreproducible record cannot carry a patch")
      }
      if (record.independent_verification !== undefined) {
        fail(["independent_verification"], "an unreproducible record cannot carry verification")
      }
      if (record.attempts !== 0) {
        fail(["attempts"], "an unreproducible record cannot have attempts")
      }
      if (record.gates.G2?.status === "pass") {
        fail(["gates", "G2"], "G2 cannot pass for an unreproducible record")
      }
      if (
        record.reproducer !== undefined &&
        (record.reproducer.patched_passes !== undefined ||
          record.reproducer.patched_runs !== undefined)
      ) {
        fail(["reproducer"], "an unreproducible record cannot carry post-patch runs")
      }
    }

    if (record.regression_test !== undefined) {
      if (record.patch === undefined) {
        fail(["regression_test"], "a regression test requires a patch")
      } else {
        const regressionPath = record.regression_test.path
        const carriesTest = record.patch.files.some((file) => file.path === regressionPath)
        if (!carriesTest) {
          fail(["regression_test", "path"], "the regression test path must appear in patch.files")
        }
        if (testPaths.length !== 1 || (testPaths[0]?.path ?? "") !== regressionPath) {
          fail(["patch", "files"], "exactly one tests/ path may appear, and it must be the regression test")
        }
        const regressionFile = record.patch.files.find((file) => file.path === regressionPath)
        if (regressionFile !== undefined && regressionFile.before_sha256 !== null) {
          fail(["regression_test", "before_absent"], "the regression test must not exist before the patch")
        }
      }
    } else if (testPaths.length > 0) {
      fail(["patch", "files"], "a tests/ path is only permitted as the recorded regression test")
    }

    if (record.patch !== undefined && record.patch.files.length > 3) {
      fail(["patch", "files"], "a patch may not touch more than three files")
    }
  })
export type FixRecord = z.infer<typeof FixRecordSchema>

export { EVIDENCE_DIR_NAME, PATCHES_DIR_NAME }
