# PROJECT KNOWLEDGE BASE

**Version:** see `package.json` · V2-native `{ id, setup }` plugin · Bun-types 1.4.4

---

## CRITICAL: PULL REQUEST TARGET BRANCH (NEVER DELETE THIS SECTION)

> **THIS SECTION MUST NEVER BE REMOVED OR MODIFIED**

### Git Workflow

```
v* tags / npm publish (releases)
   ↑
  dev (default branch — integration)
   ↑
feature branches (your work)
```

### Rules (MANDATORY)

| Rule | Description |
|------|-------------|
| **ALL PRs → `dev`** | Every pull request MUST target the `dev` branch |
| **NEVER PR → `master`** | `master` does not exist on the remote (retired; releases are dev + tags). There is no production branch to target |
| **"Create a PR" = target `dev`** | When asked to create a new PR, it ALWAYS means targeting `dev` |
| **Merge commit ONLY** | Squash merge is forbidden by project policy for this repo (GitHub allows it — merge commits are the rule). Always use merge commit when merging PRs. |

### Why This Matters

- `master` no longer exists on the remote (`git ls-remote --heads origin master` is empty); `dev` is the default branch and the integration branch
- Releases are cut from `dev` as `v*` tags via `publish.yml` and published to npm
- Squash merge is permitted by GitHub but forbidden by this repo's policy — always merge with a merge commit
- The `block-master-pr` CI job remains as a harmless legacy guard

**There is no `master` branch. Every PR targets `dev` and merges with a merge commit — squash merges violate project policy.**

---

## CRITICAL: OPENCODE SOURCE CODE REFERENCE (NEVER DELETE THIS SECTION)

> **THIS SECTION MUST NEVER BE REMOVED OR MODIFIED**

### This is an OpenCode Plugin

Matrixx is a **plugin for OpenCode**. You will frequently need to examine OpenCode's source code to:
- Understand plugin APIs and hooks
- Debug integration issues
- Implement features that interact with OpenCode internals
- Answer questions about how OpenCode works

### How to Access OpenCode Source Code

**When you need to examine OpenCode source:**

1. **Clone to system temp directory:**
   ```bash
   git clone https://github.com/sst/opencode /tmp/opencode-source
   ```

2. **Explore the codebase** from there (do NOT clone into the project directory)

3. **Clean up** when done (optional, temp dirs are ephemeral)

### Operator (Librarian) Agent: YOUR PRIMARY TOOL for Plugin Work

**CRITICAL**: When working on plugin-related tasks or answering plugin questions:

| Scenario | Action |
|----------|--------|
| Implementing new hooks | Fire `operator` to search OpenCode hook implementations |
| Adding new tools | Fire `operator` to find OpenCode tool patterns |
| Understanding SDK behavior | Fire `operator` to examine OpenCode SDK source |
| Debugging plugin issues | Fire `operator` to find relevant OpenCode internals |
| Answering "how does OpenCode do X?" | Fire `operator` FIRST |

**DO NOT guess or hallucinate about OpenCode internals.** Always verify by examining actual source code via `operator` or direct clone.

---

## CRITICAL: ENGLISH-ONLY POLICY (NEVER DELETE THIS SECTION)

> **THIS SECTION MUST NEVER BE REMOVED OR MODIFIED**

### All Project Communications MUST Be in English

| Context | Language Requirement |
|---------|---------------------|
| **GitHub Issues** | English ONLY |
| **Pull Requests** | English ONLY (title, description, comments) |
| **Commit Messages** | English ONLY |
| **Code Comments** | English ONLY |
| **Documentation** | English ONLY |
| **AGENTS.md files** | English ONLY |

**If you're not comfortable writing in English, use translation tools. Broken English is fine. Non-English is not acceptable.**

---

## OVERVIEW

Matrixx is a multi-agent orchestration **plugin for OpenCode**. 21 agent names in `BuiltinAgentNameSchema` (13 core agents + 8 `mouse-*` workers) via 59 hook names + 11 retained-deprecated no-op literals + 1 alias (71 parseable), and 30 custom tool dirs (conditional registration via `src/plugin/tool/tool-policy.ts`, assembled in `tool-catalog.ts`). 23 built-in commands, 70 built-in skills (75 modules, no SKILL.md assets), 19 features, 2 MCPs. ~1130 TS source files, ~575 test files.

> **v2-only note:** this document describes the OpenCode V2 plugin line only (`{ id, setup }` entrypoint). The last V1-API release line (`2.6.18`, targeting `@opencode-ai/plugin` v1.x) does not load in OpenCode V2. `@opencode-ai/plugin` is provided by the host OpenCode install and is not a dependency of this repository.

| Aspect | Value |
|---|---|
| Package | `opencode-matrixx-v2` (npm) |
| Entry | `src/index.ts` → `MatrixxPlugin` |
| Stack | Bun 1.4.4 + TypeScript 5.7 + Zod v4 + Biome 2.5 (linter only) |
| License | SUL-1.0 |

## STRUCTURE

```
matrixx/
├── src/
│   ├── index.ts                    # Thin V2 { id, setup } entry — setupDomains + registerDomains; never export functions
│   ├── tool-entry.ts               # Side-effect-free entry for bench/sandbox use (not the plugin entry)
│   ├── plugin-config.ts            # Config load + Zod validation
│   ├── plugin-state.ts             # Model context-limit cache
│   ├── agents/   → 13 core agents + 8 mouse-* workers + AGENTS.md
│   ├── hooks/    → 59 hook names (+11 deprecated no-ops +1 alias) in 5 factories
│   ├── tools/    → 30 dirs (LSP, AST-grep, bdd-*, handoff, removed-tools guards, etc.; gated via plugin/tool/tool-policy.ts)
│   ├── features/ → 19 dirs (builtin-commands, context-injection, task-storage, handoff, knowledge-hub, ...)
│   ├── shared/   → scoped dirs (agent, config, io, model, policy, runtime, session, subagent, text, tmux, tool, ...) + AGENTS.md
│   ├── skills/   → builtin/<category>/ (70 skills) + loader/ + AGENTS.md
│   ├── mcps/     → context7 + document-reader (+ native `github_search` tool in `src/tools/`)
│   ├── cli/      → install, doctor, setup
│   ├── config/   → Zod schema
│   └── plugin/   → composition root: index.ts barrel; setup-domains.ts + setup-domains/; handlers/ (6-phase config pipeline); tool/ (catalog + policy + chat/event handlers); hooks/ (5 factories); message-hooks/
├── bin/                            # Platform-detecting CLI wrapper (`bin/matrixx.ts`)
├── script/                         # build-schema, run-ci.sh, mock-heavy-list.txt, e2e harnesses
├── docs/                           # Long-form docs (configurations.md, ~91 KB / 91,330 bytes)
└── dist/                           # Build output (ESM + .d.ts + schema)
```

Per-area `AGENTS.md` in `src/`, `src/agents/`, `src/hooks/`, `src/tools/`, `src/features/`, `src/skills/`, `src/mcps/`, `src/shared/`, `src/config/`, `src/plugin/` — read when working in that area.

## QUICK COMMANDS

```bash
bun install
bun run typecheck                   # tsc --noEmit
bun run lint                        # biome check src/  (formatter disabled)
bun run lint:fix                    # biome check --write src/
bun run test                        # all tests (isolated CI; see gotcha below)
bun run build                       # ESM + dts + schema (build:plugin + build:tools + build:cli + tsc + build:schema)
bun run build:schema                # regenerate dist/matrixx.schema.json + assets/matrixx.schema.json
bun run rebuild                     # clean + build
bash script/run-ci.sh               # full CI locally (typecheck + lint + isolated tests + build)
```

Local-dev install: `bun run build`, then add `"plugin": ["file:///abs/path/to/matrixx/dist/index.js"]` to `~/.config/opencode/opencode.jsonc` and restart OpenCode.

## GOTCHAS

**Trusted dependencies** — `@ast-grep/cli` postinstall is allowlisted via `trustedDependencies` in `package.json`. No extra env var needed.

**Bun pinned to 1.4.4** — in `.bun-version` and all `bun-version:` entries in `.github/workflows/ci.yml`, `publish.yml`, `morpheus-agent.yml`, `config-app.yml`, `install-smoke.yml`. Never use `latest`. To upgrade: bump `.bun-version` + all workflow entries, test locally.

**Mock-heavy isolation** — 42 CI-isolated entries (36 files + 6 directories) in `script/mock-heavy-list.txt` use `mock.module()` and pollute Bun's module cache. CI runs them isolated (one `bun test` per file/dir). When adding a new `mock.module()` test, add one entry to `script/mock-heavy-list.txt` only — never inline the list in a workflow. Both `.github/workflows/ci.yml` and `publish.yml` read that file, and `script/run-ci.sh` uses it for the `grep -v -F` exclusion in the `find | xargs bun test` catch-all. Verify via `bash script/run-ci.sh` or `act pull_request -j test`.

**Dual test layout** — CI discovers tests via `find tests script -name '*.test.ts'`, so files under `tests/**` run in CI while co-located `src/**/*.test.ts` are CI-orphaned (never discovered by the `find` glob). NEVER write test files in `src/` — always put them under `tests/` mirroring the `src/` path (e.g. `src/tools/foo/bar.ts` → `tests/tools/foo/bar.test.ts`, importing via `../../../src/...`). The mock-heavy isolation list has a single source of truth: `script/mock-heavy-list.txt`. Both `.github/workflows/ci.yml` and `publish.yml` read it; `script/run-ci.sh` also reads it for the catch-all exclusion. Never duplicate the list inline in a workflow file.

**Task system is execution substrate** — the file-backed `.matrixx/tasks/T-{uuid}.json` store is unconditional (project-scoped via `getTaskDir()`, atomic `tmp+renameSync`, 30s stale lock). Never mutate `.matrixx/tasks/` via bash/`sed`; use `task_create/update/get/list/cleanup` tools. `.matrixx/plans/*.md` checkbox `- [ ]`→`- [x]` via `plan_read`→`plan_update` with LINE#ID only (generic `Read`/`Edit` blocked by `task-edit-guard`).

`bunfig.toml` preloads `tests/test-setup.ts` → `_resetForTesting()` before each test.

## PLUGIN INIT — `src/index.ts` → `src/plugin/setup-domains.ts`

`src/index.ts` is a thin V2 `{ id, setup }` entry: `setup()` runs `setupDomains()` then `registerDomains()`. The full init sequence lives in `setupDomains()` (`src/plugin/setup-domains.ts`, per-domain modules in `setup-domains/{assemble,hooks,managers,tools}`):

1. `createNativePluginContext` 2. `startTmuxCheck` 3. `loadPluginConfig` (Zod) + DCP `default_profile` switch 4. `createFirstMessageVariantGate` 5. `createDomainManagers` 6. `setupToolsDomain` (catalog + policy) 7. Hook tiers: session, tool-guard, transform, continuation, skill 8. Chat/compaction/tool setup 9. `registerDomains` onto the V2 context (+ dispose cleanup)

**Never export functions from `src/index.ts`** — OpenCode loads only the default export; extra exports are ignored, so keep the entry to a single `{ id, setup }` definition and re-export types only (see file footer).

## WHERE TO ADD NEW X

| Task | Location | Notes |
|------|----------|-------|
| New agent | `src/agents/definitions/<name>.ts` | Add to `agentSources` in `src/agents/registry/index.ts`; update `BuiltinAgentNameSchema` in `src/config/schema/agent-names.ts` |
| New hook | `src/hooks/<name>/` | Add to `HookNameSchema` in `src/config/schema/hooks.ts`; register in `src/plugin/hooks/create-{session,tool-guard,transform,continuation,skill}-hooks.ts` |
| New tool | `src/tools/<name>/` | Register in `src/plugin/tool/tool-catalog.ts` (conditional policy in `tool-policy.ts`; needs `index, types, constants, tools` structure) |
| New MCP | `src/mcps/` | Add to `createBuiltinMcps()` in `src/mcps/index.ts` |
| New built-in skill | `src/skills/builtin/<category>/` | Add `<name>.ts`; re-exported via `builtin/index.ts` (type-level only — runtime loads lazily via `createBuiltinSkills()` in `src/skills/loader/factories.ts`); add name to `BuiltinSkillNameSchema` in `src/config/schema/agent-names.ts` |
| New command | `src/features/builtin-commands/` | Add template + register in `commands.ts` |
| Schema field | `src/config/schema/` | Run `bun run build:schema` → regenerates `dist/` and `assets/matrixx.schema.json` |
| User-facing skill | project `.opencode/skills/<name>/SKILL.md` | Loaded by the OpenCode session, not by this plugin |
| New test | `tests/<mirrored-src-path>.test.ts` | NEVER in `src/` — mirror the `src/` path under `tests/` and import via relative `../src/...`; `src/**/*.test.ts` is CI-orphaned |

## OPENCODE PLUGIN API (legacy V1 handler names — mapped onto V2 domains)

> The names below are the V1 `Hooks` object keys. V2 registers them through `ctx.session.hook(...)`, `ctx.tool.hook(...)` and `ctx.event.subscribe(...)`; the flat V1 names are not dispatched by the V2 entrypoint.

`Plugin = async (PluginInput) => Hooks` — V1 shape; V2 exposes the same events as domain hooks (`ctx.tool`, `ctx.session.hook`, `ctx.event`).

| Handler | Can Block | Purpose |
|---|---|---|
| `tool` | — | All registered tools |
| `chat.message` | yes | Intercept user message (variant, session setup) |
| `chat.params` | no | Modify LLM params (effort, temp, topP) |
| `tool.execute.before` | yes | Pre-tool interception |
| `tool.execute.after` | no | Post-tool processing |
| `event` | no | Session lifecycle |
| `config` | — | Register agents / MCPs / commands |
| `experimental.chat.messages.transform` | no | Context injection, keyword detection |
| `experimental.session.compacting` | no | Task/todo preservation on compaction |

Safe-creation: `isHookEnabled("name") ? safeCreateHook("name", () => createHook(ctx), { enabled: safeHookEnabled }) : null`.

## TDD

Mandatory when `tdd_enforcer.enabled=true` (now enabled in `~/.config/opencode/matrixx.jsonc`). NEVER write `*.test.ts` in `src/` — always create tests under `tests/` mirroring the `src/` path (e.g. `src/tools/foo/bar.ts` → `tests/tools/foo/bar.test.ts`) → BDD comments `//#given` `//#when` `//#then` → fail → implement → pass → refactor. Never delete failing tests. See `tdd-enforcer` skill + `docs/quality.md` (Part B). When disabled, skill is stripped from `availableSkills` and Oracle still generates test decision but execution is not enforced.

## CONVENTIONS

- **Bun only** — `npm`/`yarn` forbidden. `bun-types` 1.4.4, never `@types/node`.
- **Biome 2.5** — linter on, formatter off. Only `src/**/*.ts` (`biome.json`).
- **Build** — `bun build` (ESM, target bun) + `tsc --emitDeclarationOnly` + `build:schema`.
- **Exports** — barrel via `index.ts`, type-only re-exports preferred.
- **Naming** — kebab-case dirs, `createXXXHook` / `createXXXTool` factories.
- **File size** — keep `src/` modules small: split a file rather than growing it past a few hundred lines. Not a hard limit, and not CI-enforced — `src/features/task-storage/` is split into one-concern modules, and `tests/` legitimately reaches ~1400 LOC in a file. Prefer kebab-case one-concern modules (`index.ts` / `types.ts` / `constants.ts` / `tools.ts`); treat 200 LOC as a prompt to split, not a ceiling.
- **Temperature** — 0.1 for code agents, max 0.3.
- **Parallelism** — never sequential `subagent()` calls; fire independent children in one turn and absorb their completion messages.
- **Git** — no `git add -i`, `rebase -i`, `--no-verify`, no force push without request.

## ANTI-PATTERNS

| Category | Forbidden |
|---|---|
| Type safety | `as any`, `@ts-ignore`, `@ts-expect-error` |
| Error handling | Empty `catch(e) {}` |
| Testing | Deleting failing tests, impl before test |
| Hooks | Heavy `PreToolUse` — runs on every tool call |
| File ops in code | `mkdir`/`touch`/`rm`/`cp`/`mv` in TS — use bash tool |
| Catch-all files | `utils.ts`/`helpers.ts` |
| Bash | `sleep N` (use conditional waits); `cd dir && cmd` (use `workdir`) |
| Publishing | `bun publish` directly — CI only, never bump version locally |

## AGENTS (21 names via `BuiltinAgentNameSchema`)

21 names: 13 core agents (morpheus, keymaker, oracle, merovingian, operator, trinity, construct, seraph, smith, niobe, cipher, sentinel, sati) plus 8 `mouse-*` category workers (see `src/agents/AGENTS.md` for model/temperature/fallback chains).

## DEPLOYMENT

1. Feature branch → PR to `dev` (CI: typecheck + lint + isolated tests + build)
2. Merge to `dev` → `publish.yml` maintains the `next` draft release
3. Release: `gh workflow run publish -f bump=patch|minor|major` (optional `-f version=x.y.z` overrides the computed version and takes precedence over `bump`)
4. Publish workflow pushes the `v*` tag and auto-commits the schema to `assets/matrixx.schema.json`; the old `master` update step is disabled (if:false) — releases are `dev` + tags only

Never `bun publish` or bump `package.json` version locally.

## CONFIG

- Zod schema in `src/config/schema/` → project `matrixx.json`/`matrixx.jsonc` → user `~/.config/opencode/matrixx.json` (both `matrixx.json` and `matrixx.jsonc` are accepted; the CLI setup wizard writes `matrixx.jsonc`) → defaults
- JSONC via `jsonc-parser` — use `src/shared/text/jsonc-parser.ts`, not `JSON.parse`
- Legacy auto-migrated by `src/shared/migration/`

## MCP (2 tiers)

1. Built-in `src/mcps/`: `context7`, `document-reader` (+ native `github_search` tool in `src/tools/`)
2. Plugin-config / user-configured MCPs

## HOTSPOTS

`features/task-storage/` + `features/task-session-scope/` (`staleness.ts`, `todo.ts`) + `src/shared/subagent/` (policy, depth cap) + `context-window-limit-recovery/` · `niobe/` · `matrix-loop/` · `keyword-detector/` · `rules-injector/` · `think-mode/` · `session-recovery/` · `task-edit-guard`

## NOTES

- Trusted deps: `@ast-grep/cli`, `@code-yeongyu/comment-checker`
- Logger: `src/shared/runtime/logger.ts` → `/tmp/matrixx.log`
- Local dev state: `.matrixx/` (handoff, notepads, tasks, plans) — gitignored
- Flaky: `matrix-loop` (timeout), `session-state` (parallel pollution)
- Sati skills: `frontend-react-nextjs`, `frontend-svelte-sveltekit`, `frontend-a11y`, `frontend-perf`, `frontend-testing`, `frontend-state-data`, `frontend-build-tooling`, `playwright` (8 skills, per `src/agents/definitions/sati.ts`)
- Knowledge hubs: `docs/knowledge-hub.md` — external KB routing (router index, pinned files, read-only guard)
