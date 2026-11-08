# Matrixx Documentation

> Version 1.2.1 -- OpenCode V2 plugin line only. All pages are English-only.
> Start with the row that matches your goal; each page declares its audience
> in its header. After upgrading, restart OpenCode so the new plugin version loads.

## Start here

| Page | Audience | What you get |
|---|---|---|
| `guide/overview.md` | New users | Two ways to work (redpill vs. `/start-work`), what Matrixx adds to OpenCode |
| `guide/installation.md` | New users (humans + LLM agents) | Prerequisites, install, auth, troubleshooting, uninstalling |
| `features.md` | Evaluators | Capability index with links -- one line per feature, details elsewhere |

## Use Matrixx

| Page | Audience | What you get |
|---|---|---|
| `orchestration.md` | Users running multi-step work | The delegation workflow: planner to plan to mission to workers |
| `agents.md` | Users choosing agents | The [13 agents](agents.md): what each does and when to use it |
| `category-skill-guide.md` | Users composing work | The 8 task categories and [70 skills](category-skill-guide.md), and how they combine |
| `command-reference.md` | Users | All 24 slash commands: usage, options, examples |
| `quality.md` | Users implementing features or enforcing tests | BDD pipeline (Part A) + TDD discipline (Part B): when to use which |
| `evolution.md` | Users opting into learning | What self-evolution records, approves, and compresses (default off) |
| `knowledge-hub.md` | Users with an external corpus | Hub declaration, router-only discipline, read-only guard + confirm flow |
| `task-notepad-writer.md` | Users + engineers running multi-step work | The automatic markdown notepad per task: two-bucket layout, worked examples, how to disable |

## Configure & operate

| Page | Audience | What you get |
|---|---|---|
| `configurations.md` | Operators | Full `matrixx.jsonc` reference (generated from `src/config/schema/`) |
| `hooks.md` | Users + engineers | Every hook: what it does, why it exists, when it fires, how to disable it |
| `task-system.md` | Users (Part A) + engineers (Part B) | Using tasks; the file-backed `.matrixx/tasks/` substrate spec |
| `context-management.md` | Operators + engineers | The 5 context layers (RTK, context-mode, DCP, headroom, hooks); install/verify/config |
| `cli-guide.md` | Operators | The `opencode-matrixx` binary: install, doctor, setup, version |
| `config-studio.md` | Operators | Pointer to the Config Studio app docs (`apps/matrixx-config/README.md`) |

## Reference

| Page | Audience | What you get |
|---|---|---|
| `session-memory-fts.md` | Engineers | Session memory Phase 2 FTS design note (design only, no code) |

## Doctrine

| Page | Audience | What you get |
|---|---|---|
| `redpill-manifesto.md` | Users + contributors | Domain-neutral Matrixx manifesto (layer 1 of the two-layer doctrine) |
| `redpill-sources.md` | Reviewers + contributors | Graded evidence map: every principle to sources, grade, and caveat (layer 2) |
| `redpill-domain-software.md` | Engineers | Software domain pack: TDD, verification gates, delegation roster (layer 3) |

## Research & historical

Archived pages: preserved as-is, do not rely on their counts or versions.

| Page | Audience | What you get |
|---|---|---|
| `research/cost-performance.md` | Researchers | Point-in-time cost/performance proposals (not a usage reference) |
| `legacy-todo-migration.md` | Historians | How the legacy todo system was removed and migrated |
| `websearch-migration.md` | Historians | How websearch moved from a custom MCP to a native tool |
| `plan-qa-scenarios.md` | Historians | Agent-executed verification scenarios for plans |
| `matrixx-crypto-market-extension-design.md` | Historians | Design doc for a crypto-market extension |

## Suggested paths

- **First install:** `guide/overview.md` to `guide/installation.md` to `features.md`.
- **First multi-agent task:** `orchestration.md` to `command-reference.md` (`/start-work`).
- **Slow or surprising behavior:** `hooks.md` sections 3-4 to `context-management.md` to `cli-guide.md` (`doctor`).
- **Contributing a hook/skill/agent:** `hooks.md` section 6 to `task-system.md` Part B to `configurations.md`.
