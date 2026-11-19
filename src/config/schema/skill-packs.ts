import { z } from "zod"

/** Default per-pack subprocess timeout in milliseconds. */
export const DEFAULT_SKILL_PACK_TIMEOUT_MS = 12_000

/** Default cap on captured pack subprocess stdout in bytes. */
export const DEFAULT_SKILL_PACK_MAX_STDOUT_BYTES = 12_288

/**
 * External skill-pack configuration. Packs are Python-backed skills kept in a
 * separate root so they never mix with the built-in skill loader (R7).
 *
 * Defaulted fields use `.default(...).optional()` — the same shape as
 * `PlansConfigSchema`. Parsing `{}` applies the defaults, while the generated
 * JSON Schema stays additive (no `required` array), so a partial block remains
 * valid for external schema validators. Runtime readers fall back to the
 * exported constants when a field is absent from an already-merged object.
 */
export const SkillPacksConfigSchema = z.object({
  /** Enable external skill packs. Default: true. */
  enabled: z.boolean().default(true).optional(),
  /** Root directory holding skill packs (relative to the project or absolute). */
  root: z.string().optional(),
  /** Install missing packs automatically on first use. Default: false (opt-in). */
  auto_install: z.boolean().default(false).optional(),
  /** Pin a pack to an exact version, keyed by pack name. */
  pinned_versions: z.record(z.string(), z.string()).optional(),
  /** Allow packs fetched from the network. Optional: unset means not allowed. */
  allow_network_packs: z.boolean().optional(),
  /** Allow packs that require an API key. Optional: unset means not allowed. */
  allow_api_key_packs: z.boolean().optional(),
  /** Python interpreter used to run pack scripts. Optional: unset uses runtime resolution. */
  python_bin: z.string().optional(),
  /** Pack names to skip entirely. */
  disabled_packs: z.array(z.string()).optional(),
  /** Skill identifiers (`pack/skill`) to skip. */
  disabled_skills: z.array(z.string()).optional(),
  /** Per-pack subprocess timeout in milliseconds. Default: 12_000. */
  timeout_ms: z.number().int().positive().default(DEFAULT_SKILL_PACK_TIMEOUT_MS).optional(),
  /** Cap on captured pack subprocess stdout in bytes. Default: 12_288. */
  max_stdout_bytes: z
    .number()
    .int()
    .positive()
    .default(DEFAULT_SKILL_PACK_MAX_STDOUT_BYTES)
    .optional(),
})

export type SkillPacksConfig = z.infer<typeof SkillPacksConfigSchema>
