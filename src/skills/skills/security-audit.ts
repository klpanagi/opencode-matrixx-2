import type { BuiltinSkill } from "../types"

export const SECURITY_AUDIT_SKILL_NAME = "security-audit"

const SECURITY_AUDIT_SKILL_DESCRIPTION =
  "Use when running a full security audit, hunting vulnerabilities with structured recon, or producing verified findings — guided security-audit workflow with hunter/verifier split and read-only evidence rules. Related: security-core, security-review."

export const securityAuditSkill: BuiltinSkill = {
  name: SECURITY_AUDIT_SKILL_NAME,
  description: SECURITY_AUDIT_SKILL_DESCRIPTION,
  template: `# Security Audit — Guided & Full-Audit Workflow

Orchestrates the 9 local security-* skills as executors. This skill provides
process only; it cites vendored Cloudflare facts only and marks anything else
UNVERIFIED.

## MODES

- **Guidance mode (default):** answer questions, point at the right executor
  skill and the relevant audit phase. No output directory created.
- **Full-audit mode (opt-in):** run all 6 phases end-to-end and write
  evidence to \`.matrixx/audits/<run-N>/\`. Trigger with \`--full\`.

## SCOPE & BUDGET

- **Scoped-default:** audit only the paths the user names. Never expand scope
  unprompted.
- **--full opt-in:** whole-repo audit only when the user passes \`--full\`.
- **Budget warning:** a full audit is token-heavy (recon + hunting waves +
  verification). Warn the user before starting and confirm scope first.

## 6-PHASE WORKFLOW

### Phase 1 — Recon
Map attack surface before hunting: entry points, trust boundaries, data
flows, auth boundaries. Executor xrefs: security-review (threat model),
security-api (endpoints), security-infra (deployment surface).

### Phase 2 — Hunting waves
Run focused hunting waves per vulnerability class, one wave at a time.
Executor xrefs: security-sast (code patterns), security-secrets (leaks),
security-crypto (crypto misuse), security-dependencies (known CVEs),
security-dast (runtime checks), security-api (auth flaws).

### Phase 3 — Candidate validation by fresh verifier
Every candidate finding MUST be re-checked by a fresh verifier pass that did
not produce the candidate (hunter/verifier split). Drop anything the
verifier cannot reproduce with file:line evidence. Executor xref:
security-core (severity + false-positive reduction).

### Phase 4 — Structured output (findings.json + ledger)
Write machine-readable evidence to \`.matrixx/audits/<run-N>/\`:
\`findings.json\` (one entry per verified finding: severity, CWE, location,
description, remediation) plus a coverage ledger of waves run and files
covered. Reference the T5 report-schema module for field shapes; do not
duplicate report-schema.json verbatim here.

### Phase 5 — Independent verification
A second pass re-validates the ledger: every finding has evidence, every
in-scope wave ran, severity matches security-core criteria. Unverifiable
items are removed or marked UNVERIFIED.

### Phase 6 — Target-neutral report
Produce the final report with no target-specific exploit instructions:
executive summary, scope and methodology, findings table
(severity, CWE, location, description, remediation), prioritized
recommendations. Executor xref: security-review (report structure).

## HUNTER / VERIFIER SPLIT

- **Hunter:** proposes candidates with file:line evidence. Never self-approves.
- **Verifier:** fresh context, reproduces or drops each candidate.
- A finding ships only after verifier reproduction.

## EXECUTOR XREFS (9 local skills)

security-core, security-secrets, security-sast, security-dast,
security-dependencies, security-api, security-crypto, security-infra,
security-review. Delegate domain detail to them; this skill owns sequencing.

## OUTPUT

Full-audit artifacts live under \`.matrixx/audits/<run-N>/\`
(findings.json, coverage ledger, report.md). Project-scoped, gitignored,
atomic writes (tmp + rename).

## RULES

- **Read-only:** no code fixes, no refactors, no live probing of running
  services, no dependency installs, no auto-fix.
- **No live probing:** static analysis and config review only; do not send
  payloads to staging or production.
- **No dep-install / auto-fix:** report remediation steps; never apply them.
- **Cite vendored Cloudflare facts only;** mark everything else UNVERIFIED.
`,
}
