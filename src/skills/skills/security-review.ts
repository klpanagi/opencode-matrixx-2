import type { BuiltinSkill } from "../types"

export const SECURITY_REVIEW_SKILL_NAME = "security-review"

const SECURITY_REVIEW_SKILL_DESCRIPTION =
  "Deprecated — Use when conducting security reviews, applying STRIDE threat modeling, or producing audit reports — superseded by security-audit; load security-audit instead. Related: security-audit, security-core."

export const securityReviewSkill: BuiltinSkill = {
  name: SECURITY_REVIEW_SKILL_NAME,
  description: SECURITY_REVIEW_SKILL_DESCRIPTION,
  template: `# Security Review — DEPRECATED

> **DEPRECATED.** This skill is superseded by the \`security-audit\`
> orchestrator. Load \`security-audit\` instead.

## Why

The 5-phase review methodology that lived here is subsumed by the
security-audit 6-phase workflow (recon → hunting waves → candidate
validation → findings.json + coverage ledger → independent verification →
report), plus the hunter/verifier split and validator modules.

## Migration

- Guidance or full audit: load the \`security-audit\` skill.
- Threat-model reference only: \`security-audit\` Phase 1 (Recon) covers
  attack-surface mapping and STRIDE per component.
`,
}
