import { z } from "zod"

/** Default orchestrator set receiving the FULL software-dev template (spec §3.1). */
export const SOFTWARE_DEV_ENFORCEMENT_DEFAULT_ORCHESTRATORS = [
  "morpheus",
  "keymaker",
  "niobe",
  "oracle",
] as const

/** Default Mouse subset for code-writing delegations (spec §5.2). MUST never contain software-dev. */
export const SOFTWARE_DEV_ENFORCEMENT_DEFAULT_EXECUTORS_SUBSET = [
  "tdd-enforcer",
  "git-master",
] as const

export const SoftwareDevEnforcementModeSchema = z.enum(["failClosed", "autoAppend"])

export type SoftwareDevEnforcementMode = z.infer<typeof SoftwareDevEnforcementModeSchema>

export const SoftwareDevEnforcementConfigSchema = z.object({
  /** Master kill-switch. enabled=false exempts everything including source. Default true (fail-closed). */
  enabled: z.boolean().default(true),
  /** Redefines the full-template orchestrator set. Default [morpheus,keymaker,niobe,oracle]. */
  orchestrators: z
    .array(z.string())
    .default([...SOFTWARE_DEV_ENFORCEMENT_DEFAULT_ORCHESTRATORS]),
  /** Mouse subset for code-writing delegations. MUST never contain software-dev (Mouse BLOCKED subagent). */
  executorsSubset: z
    .array(z.string())
    .default([...SOFTWARE_DEV_ENFORCEMENT_DEFAULT_EXECUTORS_SUBSET])
    .refine((subset) => !subset.some((name) => name.toLowerCase() === "software-dev"), {
      message:
        'softwareDevEnforcement.executorsSubset must never contain "software-dev" ' +
        "(Mouse cannot delegate; the full template is orchestrator-only).",
    }),
  /** Re-check enforcement on continuation turns. Default true. */
  enforceOnContinuations: z.boolean().default(true),
  /** failClosed=throw+auto-append; autoAppend=append-only, throws only when disabled_skills blocks a required skill. */
  mode: SoftwareDevEnforcementModeSchema.default("failClosed"),
})

export type SoftwareDevEnforcementConfig = z.infer<typeof SoftwareDevEnforcementConfigSchema>
export type SoftwareDevEnforcementConfigInput = z.input<typeof SoftwareDevEnforcementConfigSchema>

/**
 * Resolve the effective config with built-in defaults.
 * Zod `.default()` only applies at parse time and `MatrixxConfig.softwareDevEnforcement`
 * is optional, so call sites MUST resolve explicitly instead of reading raw fields.
 * Precedence handled here: field values > built-in defaults.
 * (Explicit disabled_skills entries and enabled=false are enforced by the guard, not here.)
 */
export function resolveSoftwareDevEnforcement(
  input?: SoftwareDevEnforcementConfigInput | null,
): SoftwareDevEnforcementConfig {
  return SoftwareDevEnforcementConfigSchema.parse(input ?? {})
}
