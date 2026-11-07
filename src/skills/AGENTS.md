# BUILT-IN SKILLS KNOWLEDGE BASE

## OVERVIEW

70 specialized skills loaded by default (69 files + 1 dual-export) into every Matrixx session. Each skill bundles domain expertise, optional MCPs, and (sometimes) a custom model/agent assignment.

| Scope | Count | Source |
|------|-------|--------|
| **Built-in (this dir)** | 70 (69 files) | `src/skills/builtin/<category>/*.ts` |
| Opencode-project (`.opencode/skills/`) | varies | per-project |
| Opencode-user (`~/.config/opencode/skills/`) | varies | per-user |
| Claude Code compat (`.claude/skills/`) | varies | per-project |
| Claude Code user (`~/.claude/skills/`) | varies | per-user |

## STRUCTURE

```
skills/
├── index.ts                      # Type-level barrel (runtime loads via loader/factories)
├── loader/                       # Runtime loading layer (factories + helpers)
│   ├── factories.ts              # createBuiltinSkills() factory + skillFactories table
│   ├── lazy-skill-helper.ts      # createLazyTemplateSkill (lazy template getter)
│   ├── skills.transform.ts       # registerSkillTransform: pure replay onto ctx.skill.transform
│   ├── types.ts                  # BuiltinSkill interface
│   ├── schemas/                  # Zod schemas (security-audit, audits-store)
│   └── index.ts                  # Loader barrel (explicit named re-exports)
├── builtin/                      # 70 skills across 7 category dirs (export Skill objects)
│   ├── bdd/                      # 4 skills (bdd-backend, bdd-contract, bdd-frontend, bdd-tests)
│   ├── core/                     # 20 skills, 19 files (playwright.ts exports 2: playwright + agent-browser)
│   │                             # git-master, docker-master, dev-browser, tdd-enforcer, quality-gate,
│   │                             # software-dev, review-work, matrixx-self-config, ulw-research, ...
│   ├── dsl/                      # 11 skills (dsl-core, dsl-grammar, dsl-codegen, dsl-metamodel, ...)
│   ├── frontend/                 # 8 skills (frontend-ui-ux, frontend-a11y, frontend-perf, ...)
│   ├── market-data/              # 10 skills (ccxt-rest, ccxt-pro-websockets, market-data-bus, ...)
│   ├── security/                 # 10 skills (security-core, security-api, security-audit, ...)
│   ├── zeromq/                   # 7 skills (zeromq-core, zeromq-pubsub, zeromq-reliability, ...)
│   └── index.ts                  # Type-level barrel re-exports (NOT runtime loading)
└── ...
```

### Category folder map

| Category dir | Skills | Files | Notes |
|--------------|--------|-------|-------|
| `skills/builtin/bdd/` | 4 | 4 + `index.ts` | BDD workflow skills |
| `skills/builtin/core/` | 20 | 17 top-level + `docker-master/` + `git-master/` multi-file skills + `index.ts` | Cross-cutting skills; `playwright.ts` exports both `playwrightSkill` and `agentBrowserSkill` |
| `skills/builtin/dsl/` | 11 | 11 + `index.ts` | DSL design/implementation skills |
| `skills/builtin/frontend/` | 8 | 8 + `index.ts` | Frontend framework/pattern skills |
| `skills/builtin/market-data/` | 10 | 10 + `index.ts` | Market-data pipeline skills |
| `skills/builtin/security/` | 10 | 10 + `index.ts` | Security review/audit skills |
| `skills/builtin/zeromq/` | 7 | 7 + `index.ts` | ZeroMQ messaging skills |
| **Total** | **70** | **69 + 7 `index.ts`** | |

Each category dir has an `index.ts` that re-exports its skill objects (e.g. `export { bddBackendSkill, BDD_BACKEND_SKILL_NAME } from "./bdd-backend"`). The root `skills/index.ts` re-exports everything for type-level access only — runtime template loading goes through `createBuiltinSkills()`, never through direct imports.

## LOADER SEMANTICS

### 1. Eager browser skill (`BROWSER_SKILL_NAMES` + `browserProvider`)

`src/skills/loader/factories.ts`:

```typescript
const BROWSER_SKILL_NAMES = new Set(["playwright", "agent-browser", "playwright-cli"])
```

`createBuiltinSkills({ browserProvider })` resolves exactly ONE browser skill **eagerly** (small, always needed for the skill-context filter at init):

- `browserProvider === "agent-browser"` → `"agent-browser"`
- `browserProvider === "playwright-cli"` → `"playwright-cli"`
- default (`"playwright"`) → `"playwright"`

Schema: `BrowserAutomationProviderSchema` in `src/config/schema/browser-automation.ts`. The two non-selected browser skills are **excluded entirely** (never constructed, never lazy-wrapped).

### 2. Lazy non-browser skills (`createLazyTemplateSkill`)

All other skills resolve through `createLazyTemplateSkill(name, factory)` in `lazy-skill-helper.ts`:

- **Pattern:** `Object.defineProperty` self-destructing getter on `.template`
- **Cache:** module-level `Map<string, string>` keyed by skill name
- **Behavior:** first `.template` access invokes the factory, caches result, replaces getter with a data property; subsequent accesses use the data property (no getter overhead)
- **`description` is also deferred** — calling the factory eagerly to populate it would defeat laziness
- **Transparent:** zero API break, no config flag, no behavioral difference

The `skillFactories: Record<string, () => BuiltinSkill>` table holds static factories returning the already-imported skill objects; template text still resolves through the lazy getter, so construction stays allocation-only. Content dirs are data only — no `require()` seam.

### 3. `disabledSkills` filter

```typescript
interface CreateBuiltinSkillsOptions {
  browserProvider?: BrowserAutomationProvider;
  disabledSkills?: Set<string>;
}
```

Disabled skills are filtered **AFTER** creation at the array level (`allSkills.filter((skill) => !disabledSkills.has(skill.name))`). Skill objects are not lazy-wrapped differently based on disabled state — they are just filtered out. Config surface: `disabled_skills: z.array(BuiltinSkillNameSchema)` in `src/config/schema/matrixx-config.ts` (names from `BuiltinSkillNameSchema` in `src/config/schema/agent-names.ts`):

```jsonc
// matrixx.jsonc
{
  "disabled_skills": ["playwright", "matrixx-self-config"]
}
```

### 4. `registerSkillTransform` replay

`src/skills/loader/skills.transform.ts` — V2-native skill domain transform, owned by `src/skills/`:

- **Pure replay** of skill entries onto `ctx.skill.transform`. Entry builders in `./skills` are static data plus allocation-only wrappers (no filesystem access, no spawn, no network), so repeated runs over the same entries replay identically.
- Accepts `Record<string, unknown> | BuiltinSkill[] | undefined`; the callback only calls `editor.add(record)`, so re-running over the same entries replays identically.
- Returns `{ registration, registered: string[] }` — the skill names replayed onto the domain.

## SKILL.MD TRIAGE (REMOVED 2026-11-07)

Top-level `src/skills/*/SKILL.md` triage copies were removed — they duplicated a
subset of `builtin/` content and drifted. The `src/skills/dev-browser/references/`
docs were removed as well: nothing loads `.md` at runtime (loader uses `builtin/`
`.ts` only) and the template already inlines the essential setup/scraping
guidance. Do not re-add top-level `SKILL.md` copies or `references/` dirs.

## LAZY LOADING (P1 OPTIMIZATION)

Since v2.0.0, all **non-browser** skills use lazy template resolution (see LOADER SEMANTICS §2 above).

## BUILT-IN SKILL

`BuiltinSkill` interface (`types.ts`):

```typescript
interface BuiltinSkill {
  name: string;
  description: string;
  template: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, unknown>;
  allowedTools?: string[];
  agent?: string;
  model?: string;
  subtask?: boolean;
  argumentHint?: string;
  mcpConfig?: SkillMcpConfig;
}
```

## FACTORY: `createBuiltinSkills(options)`

See LOADER SEMANTICS above. Returns `BuiltinSkill[]` — one eager browser skill plus all non-browser skills as lazy wrappers, minus `disabledSkills`.

## DISABLING SKILLS

```jsonc
// matrixx.jsonc
{
  "disabled_skills": ["playwright", "matrixx-self-config"]
}
```

Names must match `BuiltinSkillNameSchema` (`src/config/schema/agent-names.ts`).

## SKILL LOADING

All skills are loaded from `src/skills/builtin/<category>/` via `createBuiltinSkills()`. No external skill directory loading.

## HOW TO ADD A NEW BUILT-IN SKILL (5 STEPS)

1. **Create the skill file in its category dir:** `src/skills/builtin/<category>/<name>.ts`, exporting a `Skill` object: `export const mySkill: Skill = { name, description, template, ... }`. Pick the existing category that fits (bdd / core / dsl / frontend / market-data / security / zeromq).
2. **Re-export the category index and the root barrel:** add `export { mySkill, MY_SKILL_NAME } from "./my-name"` to `src/skills/builtin/<category>/index.ts`, and add the matching re-export line to the root `src/skills/builtin/index.ts` (type-level access).
3. **Add the import + factory entry in `src/skills/loader/factories.ts`:** add a static import (`import { mySkill } from "./builtin/<category>/my-name"`) plus a `skillFactories` entry (`"my-name": () => mySkill`). Content dirs are data only — no `require()` seam. Registration onto the domain goes through `registerSkillTransform` in `./skills.transform.ts`.
4. **Add the skill name to the schema:** add `"my-name"` to `BuiltinSkillNameSchema` in `src/config/schema/agent-names.ts` so `disabled_skills` accepts it (and rebuild the schema if the build embeds it).
5. **Verify:** run typecheck (`bun run typecheck`) and the skills tests (`bun test` coverage for `skills.test.ts` / `lazy-skill-helper.test.ts`). The factory pattern plus the lazy wrapper handles hydration — no other change is needed.

## HOW TO REMOVE A BUILT-IN SKILL

Remove the static import and the `skillFactories` entry in `src/skills/loader/factories.ts`. Note: users with `disabled_skills: ["my-skill"]` will see a benign "not found" message.

## KNOWN HOTSPOTS

- `src/skills/builtin/core/git-master.ts` — large skill with many workflow procedures
- `src/skills/builtin/core/ulw-research.ts` — references the research skill
- `src/skills/loader/factories.ts` `skillFactories` table — must stay in sync with `builtin/<category>/*.ts` exports
- `src/skills/builtin/core/playwright.ts` — dual export (`playwrightSkill` + `agentBrowserSkill`); only the `browserProvider`-selected one loads

## Skill Description SDO (Skill Discovery Optimization)

All built-in skill descriptions MUST follow the SDO pattern:

**Format:**
```
Use when {trigger1}, {trigger2}, {trigger3} — {1-sentence domain context}. Related: {skill-x}, {skill-y}.
```

**Rules:**
- First sentence MUST contain a trigger pattern (`Use when`, `For ... tasks`, etc.)
- Trigger phrases MUST appear in the first 120 characters (survives `truncateDescription()`)
- Maximum 150 tokens (~500-600 chars)
- Cross-reference max 2 related skills
- No workflow content (phases, agents, step numbers)
- No directives (`MUST USE`, `STRONGLY RECOMMENDED`)

**Example:**
```
GOOD: "Use when setting up auth, configuring login, or implementing access control — authentication and authorization patterns for web APIs. Related: security-api, security-core."
BAD:  "Authentication and authorization. Covers JWT, OAuth, sessions, RBAC, ABAC. Triggers: 'auth', 'login'."
```
