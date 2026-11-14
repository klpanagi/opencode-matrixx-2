# Skill evaluation

`script/skill-eval.ts` exports every Matrixx builtin skill as an
[agentskills.io](https://agentskills.io)-style `SKILL.md` catalog and runs the NVIDIA
[SkillEvaluator](https://pypi.org/project/skillevaluator/) CLI (`skillevaluator`) against it.

```
<out>/catalog/skills/<dir-name>/SKILL.md   <- publication target (wiped on every run)
<out>/reports/                             <- evaluator output (wiped on eval only)
```

`eval` prints `removing <path>` before each wipe. Plain `export` never deletes `reports/`, so prior
evaluations survive a catalog refresh. Each `SKILL.md` has frontmatter (`name`, `description`,
`version`, `metadata.author`, `metadata.tags`, optional `allowed-tools` as a quoted string) and the
unmodified body. `name` is the directory name, so the two `playwright` skills export as `playwright`
and `playwright-cli`.

## Requirements
| Requirement | Notes |
|---|---|
| Bun 1.4.4 | Pinned in `.bun-version` |
| `uv` | `skillevaluator` needs Python ≥ 3.12, so the script runs `uvx --python 3.13 skillevaluator` when no local `skillevaluator` is on `PATH`. Install with `curl -LsSf https://astral.sh/uv/install.sh \| sh` or `pipx install uv` |
| `skillevaluator` (optional) | If already on `PATH` it is preferred over `uvx`, saving ~2s per invocation |
| Network (first run) | `uvx` downloads the pinned evaluator once |
| Scanner runtimes | Gitleaks and SkillSpector wheels are cached under `~/.local/share/skillevaluator/runtimes` (override with `SKILLEVALUATOR_RUNTIME_DIR`); no separate install step |

## Commands
```bash
bun script/skill-eval.ts export   # write the catalog only
bun script/skill-eval.ts eval     # export, validate, then score every skill
bun run skill:export              # package.json alias for export
bun run skill:eval                # package.json alias for eval
```

`eval` runs a folder-mode `validate` with `--tiers 1` and an explicit checks allowlist. The default
allowlist is `schema,version,quality,lint,pii,license,unicode`: it deliberately omits `security`,
`secrets` and `code-integrity`, and `secrets` is in neither allowlist. This default is the
recommended CI gate. `--deep` uses
`schema,version,security,pii,license,code-integrity,unicode,quality,lint` and may download scanner
runtimes on first use.

### Measured `--deep` reality (70-skill catalog)
`--deep` currently yields **22/70 pass, 48 fail**. Every one of the 48 failures is
`overall_status: "incomplete"` with `incomplete_scans: ["skillspector"]` and zero critical/high
findings; the full run reports 0 critical and 0 high across the catalog. A raw sampling run exits 1, but
the shipped script reports **exit 3 (inconclusive)** because every failure carries `incomplete_scans`. SkillSpector keeps a
`partial` analysis status because Matrixx skill bodies reference illustrative paths (`src/db.ts:42`,
`README.md`, `docs/`) that are not bundled next to `SKILL.md`, so reference resolution never
completes. The script treats that as **inconclusive (exit 3)**, not a content failure. Suppress
audited findings with the evaluator's `--skillspector-baseline <file>` option when you need a
clean `--deep` gate; otherwise use the default allowlist.

After validation the script runs `quality-check` per skill (concurrency 4) and prints a table sorted
worst score first, catalog and severity totals from `<out>/reports/catalog-summary.json`, an
`Unscored skills:` block with reasons, and the newest report paths. Missing quality reports make the
run fail (exit 1) even though no score was produced.
## Flags
| Flag | Effect |
|---|---|
| `--out <dir>` | Output directory (default `.matrixx/skill-eval`); leading `~` is expanded |
| `--only <name,name>` | Match directory names first (unique), then skill names; unmatched entries are an error |
| `--limit <n>` | Cap the catalog and skip the quality table |
| `--deep` | Enable scanner-backed checks; see the measured reality above |
| `--tiers <list>` | Subset of `1,2,3`; tier 1 is mandatory (`--tiers 2` is a usage error) |
| `--workers <n>` | Pass `--workers n` to the evaluator's catalog run |
| `--skip-quality-table` | Run only the `validate` gate |
| `--concurrency <n>` | Parallel `quality-check` runs (default 4) |
| `--verbose` | List every inconclusive skill instead of the first 5 |
| `--allow-fail` | Force exit 0 on gate failures and inconclusive runs; usage and setup errors still exit 2 |
| `--json` | Print only the summary JSON on stdout; progress and the evaluator TUI go to stderr |
## Exit codes
| Code | Meaning |
|---|---|
| 0 | Validation passed and every skill was scored |
| 1 | Real gate failure: failing skill(s) without incomplete scans, unscored skills, or a score below 70 |
| 2 | Usage error, or neither `uv` nor `skillevaluator` is available |
| 3 | Inconclusive: validation failed, every failing skill has non-empty `incomplete_scans`, and no skill is unscored (unscored quality failures take precedence → 1) |

`--json` adds top-level `inconclusive` plus per-skill `overallStatus` and `incompleteScans`.
Expected non-gating findings: missing `## Purpose`/`## Instructions`/`## Examples` sections and `line_count > 500` (MEDIUM), and descriptions longer than the recommended 50–150 chars (INFO).
