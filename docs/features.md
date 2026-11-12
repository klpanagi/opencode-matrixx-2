# Matrixx Features

> Version 1.3.4. This page is an index-hub: what Matrixx is, what is unique to this page, and where each subsystem is documented canonically. Roster tables live in the canonical docs — they are linked, not duplicated, here.

Matrixx is a multi-agent orchestration plugin for OpenCode: specialized agents, category-routed delegation, lazily-loaded skills, slash-command workflows, lifecycle hooks, file-backed tasks, and a BDD pipeline — all configured through `matrixx.json`/`matrixx.jsonc`.

## Canonical Docs

| Subsystem | Canonical doc |
|-----------|---------------|
| Agents (13-agent roster, models, fallbacks, permissions, background/tmux) | [Agents](agents.md) |
| Categories, skills, combos, task-prompt guide | [Category & Skill System Guide](category-skill-guide.md) |
| Commands (full argument reference) | [Command Reference](command-reference.md) |
| Tasks, mission state, continuation, `/task-list`, `/cleanup-tasks` | [Task System](task-system.md) |
| BDD pipeline (`/bdd-pipeline` command + `bdd_*` tools; `bdd-*` skills) | [Quality, Part A](quality.md) |
| TDD enforcement | [Quality, Part B](quality.md) |
| Hooks (lifecycle automation, DCP, truncation, recovery) | [Hooks](hooks.md) |
| Context management (DCP tiers, Headroom, `ctx_*` sandbox) | [Context Management](context-management.md) |
| Planning/execution model, delegation flows | [Orchestration](orchestration.md) |
| Configuration (`matrixx.json`, presets, `browser_automation_engine`) | [Configuration](configurations.md) |

## Agents (summary)

Matrixx provides 13 core agents plus 8 `mouse-*` workers (21 names in `BuiltinAgentNameSchema`). Full roster with models, fallbacks, tool restrictions, and background/tmux usage: [Agents](agents.md). Planning/execution model: [Orchestration](orchestration.md).

### Background Agents (summary)

Run agents in the background and continue working; with `tmux.enabled`, background agents spawn in visible panes. Details: [Agents](agents.md); config: [Configuration](configurations.md#agents).

## Skills (summary)

Skills inject specialized knowledge and MCP tools into agents. Full catalog: [Category & Skill System Guide](category-skill-guide.md).

## Skills Unique to This Page

70 built-in skills. Full catalog: [Category & Skill System Guide](category-skill-guide.md).

All built-in skills follow **SDO (Skill Discovery Optimization)** — descriptions use trigger-first patterns with cross-references for high-precision agent delegation.

### Lazy Skill Loading (Built-in Skills)

All non-browser built-in skills use **lazy template resolution**. Skill factories (and their large markdown template bodies) are NOT evaluated at plugin init — they hydrate on first reference via a self-destructing getter pattern.

**How it works:**

- `createBuiltinSkills()` returns BuiltinSkill objects whose `.template` is an `Object.defineProperty` getter.
- On first `.template` access, the factory is invoked once; the result is cached on the skill object (replaces getter with a data property).
- Browser skills (playwright / agent-browser / playwright-cli) are loaded eagerly because the active provider is decided at init; all other skills are lazy.
- `description` is populated only on first access as well (cannot call factory eagerly without defeating laziness).

**Why it matters:**

- **Faster plugin init** — module parse time for skill files is deferred.
- **Lower memory pressure at startup** — template bodies (often 5–20KB of markdown each) stay un-evaluated.
- **Zero behavioral change** — the API (`BuiltinSkill.template: string`) is unchanged. Consumers see no difference.
- **Transparent** — no config flag, no opt-in.

**Files:**

- `src/skills/loader/lazy-skill-helper.ts` — `createLazyTemplateSkill()` factory + cache.
- `src/skills/loader/factories.ts` — wraps all non-browser skill loaders via the helper (`BROWSER_SKILL_NAMES`, eager `browserSkillName` resolution, `lazySkillNames` filter).

**Note:** Custom (project / user) skills loaded via the opencode-skill-loader are NOT affected — they already use the async `LazyContentLoader` pattern for their markdown bodies.

### Per-Task Complexity Routing (`complexity`)

`subagent(...)` accepts an optional `complexity` field (1-5 or `"auto"`). The
`subagent_policy` transformer consumes it and may downgrade the model for
`mouse-*` workers before stripping the key. Downgrades are opt-in and
downgrade-only; per-category overrides live in `complexity_downgrades` in
`matrixx.jsonc`.

Files: `src/shared/subagent/complexity-scorer.ts`, `complexity-constants.ts`,
`complexity-types.ts`; the rewrite runs in
`src/plugin/tool/subagent-policy/complexity-rewrite.ts`.

### Skill: Browser Automation (playwright / agent-browser)

**Trigger**: Any browser-related request

Matrixx provides browser automation providers, configurable via `browser_automation_engine.provider` (eagerly resolved at init — see `browserSkillName` in `src/skills/loader/factories.ts`):

#### Option 1: Playwright MCP (Default)

The default provider uses Playwright MCP server:

```yaml
mcp:
  playwright:
    command: npx
    args: ["@playwright/mcp@latest"]
```

**Usage**:
```
/playwright Navigate to example.com and take a screenshot
```

#### Option 2: Agent Browser CLI (Vercel)

Alternative provider using [Vercel's agent-browser CLI](https://github.com/vercel-labs/agent-browser):

```json
{
  "browser_automation_engine": {
    "provider": "agent-browser"
  }
}
```

**Requires installation**:
```bash
bun add -g agent-browser
```

**Usage**:
```
Use agent-browser to navigate to example.com and extract the main heading
```

#### Capabilities (All Providers)

- Navigate and interact with web pages
- Take screenshots and PDFs
- Fill forms and click elements
- Wait for network requests
- Scrape content

## Commands (summary)

Slash-triggered workflows (23 built-in commands). Full argument reference: [Command Reference](command-reference.md). Custom commands load from `.opencode/command/*.md` (project) and `~/.config/opencode/command/*.md` (user).

Single-skill deep dives (`frontend-ui-ux`, `git-master`, `rp-research`, `remove-ai-slops`) live in [Category & Skill System Guide](category-skill-guide.md). Runtime toggles (`/redpill`, `/assembly`, `/end-redpill`, `/preset`, `/stop-continuation`, `/remove-deadcode`, `/task-list`, `/cleanup-tasks`, `/handoff`, `/pickup`, `/research`, loops, BDD commands) are documented canonically in [Command Reference](command-reference.md) and [Task System](task-system.md).

## Hooks, Tools, MCPs, Context (summaries)

- **Hooks** (60 live + 10 retained no-ops + 1 alias = 71 parseable; quality gates, recovery, task guards): [Hooks](hooks.md).
- **Tools** (LSP, AST-grep, delegation, task tools, assembly, session, handoff): the task tools are canonically documented in [Task System](task-system.md); delegation categories in [Category & Skill System Guide](category-skill-guide.md).
- **MCPs** (`context7`, `document_reader`; plus the native `github_search` and `websearch` tools; skill-embedded MCPs): [Configuration](configurations.md).
- **Context injection** (AGENTS.md, conditional rules) and DCP tiers: [Context Management](context-management.md).
- **Handoff** (`/handoff` → `/pickup`, `.matrixx/handoff.md`): [Command Reference](command-reference.md) and [Task System](task-system.md).
- **BDD pipeline** (`/bdd-pipeline` command; `bdd_parse_gherkin`, `bdd_create_contract`, `bdd_validate_contract`, `bdd_pipeline_run` tools; `bdd-*` skills): [Quality, Part A](quality.md).
- **TDD enforcement**: [Quality, Part B](quality.md).
- Custom skills load from `.opencode/skills/*/SKILL.md` (project) and `~/.config/opencode/skills/*/SKILL.md` (user); disable built-ins via `disabled_skills` in config.

## Removed: Claude Code Compatibility

The legacy Claude Code compatibility layer (`.claude/commands/`, `.claude/skills/`, `.claude/agents/`, `.claude/.mcp.json` loaders, `~/.claude/todos/` storage, and the `claude_code` config toggles) no longer exists in-tree: there are zero `.claude/` path references and zero `claude_code` config keys anywhere under `src/`. If you see older docs or configs mentioning them, drop those entries.

Custom commands and skills now load from OpenCode paths only:

- Commands: `.opencode/command/*.md` (project), `~/.config/opencode/command/*.md` (user)
- Skills: `.opencode/skills/*/SKILL.md` (project), `~/.config/opencode/skills/*/SKILL.md` (user)
