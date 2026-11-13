# Category & Skill System Guide

> **Audience:** users composing delegated work and engineers adding skills.
> 8 categories (`src/config/schema/categories.ts`), 70 skills (`src/skills/builtin/`).

This document provides a comprehensive guide to the **Category** and **Skill** systems, which form the extensibility core of Matrixx. For delegation flows, see [Orchestration](orchestration.md). For the agent roster, see [Agents](agents.md).

## 1. Overview

Instead of delegating everything to a single AI agent, it's far more efficient to invoke **specialists** tailored to the nature of the task.

- **Category**: "What kind of work is this?" (determines model, temperature, prompt mindset)
- **Skill**: "What tools and knowledge are needed?" (injects specialized knowledge, MCP tools, workflows)

By combining these two concepts, you can generate optimal agents through native `subagent` delegation: pick a category by naming its `mouse-<category>` worker agent.

---

## 2. Category System

A Category is an agent configuration preset optimized for specific domains.

### Available Built-in Categories

8 categories verified against `BuiltinCategoryNameSchema` (`src/config/schema/categories.ts`): `construct`, `source`, `rabbit-hole`, `glitch`, `bullet-time`, `blue-pill`, `the-one`, `transmission`. Category config is merged in `src/shared/tool/merge-categories.ts` and consumed by `src/plugin/tool/available-categories.ts`; `subagent(agent="mouse-<category>")` selects the worker.

| Category | First choice | Fallback | Use Cases |
|----------|--------------|----------|-----------|
| `construct` | `claude-sonnet-4-6` | `claude-opus-4-6` (variant `max`) | Frontend, UI/UX, design, styling, animation |
| `source` | `claude-opus-4-6` (variant `max`) | `claude-sonnet-4-6` | Hard logic, backend, core implementation |
| `rabbit-hole` | `claude-opus-4-6` (variant `max`) | `claude-sonnet-4-6` | Goal-oriented autonomous problem-solving. Thorough research before action. |
| `glitch` | `claude-sonnet-4-6` | `claude-opus-4-6` (variant `max`) | Creative tasks, novel ideas |
| `bullet-time` | `claude-haiku-4-5` | `claude-sonnet-4-6` | Quick fixes, trivial tasks, single file changes, typo fixes |
| `blue-pill` | `claude-sonnet-4-6` | `claude-haiku-4-5` | General tasks, moderate effort |
| `the-one` | `claude-opus-4-6` (variant `max`) | `claude-sonnet-4-6` | Complex tasks, high effort |
| `transmission` | `claude-sonnet-4-6` | `claude-haiku-4-5` | Documentation, prose, technical writing |


Each row is the head of a fallback chain of `<provider>/<model>` candidates; Matrixx selects the first whose provider is connected. Source of truth: `DEFAULT_CATEGORY_MODEL_REQUIREMENTS` (`src/shared/model/model-requirements.ts:154-201`). Every category resolves to a Claude chain (`claude-sonnet-4-6`, `claude-opus-4-6` with variant `max`, or `claude-haiku-4-5`) across the same three providers: `anthropic | github-copilot | opencode`. No free-tier model ships in a category chain. Override via `modelRequirements` or `model_presets`; free-tier IDs such as `opencode/qwen3.6-plus-free` are an example user override, not a shipped default.

### Usage

Select a category by passing the matching worker agent name to the native `subagent` tool.

```typescript
subagent(
  agent="mouse-source",
  description="Add chart component",
  prompt="Add a responsive chart component to the dashboard page"
)
```

### Mouse (Delegated Executor)

When you use a Category, a special agent called **Mouse** performs the work.
- **Characteristic**: Cannot **re-delegate** tasks to other agents.
- **Purpose**: Prevents infinite delegation loops and ensures focus on the assigned task.

---

## 3. Skill System

A Skill is a mechanism that injects **specialized knowledge (Context)** and **tools (MCP)** for specific domains into agents.

### Built-in Skills (70 total)

70 names verified against `BuiltinSkillNameSchema` (`src/config/schema/agent-names.ts`); templates live in `src/skills/builtin/` and load via `createBuiltinSkills()`.

**Development & Tools (6):**
- **`git-master`** — Git expert. Detects commit styles, splits atomic commits, rebase strategies.
- **`docker-master`** — Container & compose orchestration.
- **`tdd-enforcer`** — TDD workflow enforcement (RED → GREEN → REFACTOR).
- **`quality-gate`** — Automated quality verification: lint, typecheck, test, build.
- **`software-dev`** — Structured 6-phase development pipeline (PLAN → BUILD → VERIFY → REVIEW → SECURE → SHIP).
- **`review-work`** — Post-implementation review orchestrator with 6 parallel agents.

**Frontend & Browser (4):**
- **`playwright`** — Browser automation. Web page testing, screenshots, scraping. MCP: `@playwright/mcp` (auto-executed)
- **`dev-browser`** — Browser automation with persistent page state.
- **`agent-browser`** — Agent-controlled browser automation.
- **`frontend-ui-ux`** — Designer mindset. Color, typography, motion guidelines.

Skill counts, honest version: **70** names in `BuiltinSkillNameSchema` (`src/config/schema/agent-names.ts`); **85** skill asset files on disk (`src/skills/builtin/`: 75 skill modules + 10 `index.ts` files). The grouped list above shows a subset; the schema additionally covers trading/market-data (`ccxt-rest`, `ccxt-pro-websockets`, `market-data-bus`, `market-data-architecture`, `crypto-market-structure`, `time-series-fundamentals`, `influxdb-timeseries`, `grafana-dashboards`, `telegram-bot`), resilience/quality (`resilience-error-taxonomy`, `silent-failure-detection`, `data-quality-observability`), ZeroMQ (`zeromq-*`), and extra frontend skills (`frontend-a11y`, `frontend-build-tooling`, `frontend-perf`, `frontend-state-data`, `frontend-testing`, `playwright-cli`, `react-nextjs-patterns`, `svelte-sveltekit-patterns`, `document-reader`).

**DSL Engineering (11):**
- **`dsl-core`**, **`dsl-grammar`**, **`dsl-codegen`**, **`dsl-metamodel`**, **`dsl-tooling`**
- **`dsl-textx-ecosystem`**, **`dsl-pyecore-advanced`**, **`dsl-model-transformation`**
- **`dsl-testing`**, **`dsl-validation`**, **`dsl-composition`**

**Security (9):**
- **`security-core`**, **`security-secrets`**, **`security-sast`**, **`security-dast`**
- **`security-dependencies`**, **`security-api`**, **`security-crypto`**
- **`security-infra`**, **`security-review`**

**BDD & Research (5):**
- **`bdd-backend`**, **`bdd-contract`**, **`bdd-frontend`**, **`bdd-tests`** — BDD pipeline (Gherkin → contract → tests/frontend/backend).
- **`rp-research`** — Saturation research orchestrator.

**Configuration & Cleanup (2):**
- **`matrixx-self-config`** — Configure and tune Matrixx for the current user.
- **`remove-ai-slops`** — Detect & remove AI-generated code smells (7 categories).

### Usage

Add desired skill names to the `load_skills` array.

```typescript
subagent(
  agent="mouse-bullet-time",
  load_skills=["git-master"],
  description="Commit current changes",
  prompt="Commit current changes. Follow commit message style."
)
```

### Skill Customization (SKILL.md)

You can add custom skills directly to `.opencode/skills/` in your project root or `~/.config/opencode/skills/` in your home directory.

**Example: `.opencode/skills/my-skill/SKILL.md`**

```markdown
---
name: my-skill
description: My special custom skill
mcp:
  my-mcp:
    command: npx
    args: ["-y", "my-mcp-server"]
---

# My Skill Prompt

This content will be injected into the agent's system prompt.
...
```

---

## 4. Combination Strategies (Combos)

You can create powerful specialized agents by combining Categories and Skills.

### 🎨 The Designer (UI Implementation)
- **Category**: `construct`
- **load_skills**: `["frontend-ui-ux", "playwright"]`
- **Effect**: Implements aesthetic UI and verifies rendering results directly in browser.

### 🏗️ The Niobe (Design Review)
- **Category**: `the-one`
- **load_skills**: `[]` (pure reasoning)
- **Effect**: Leverages the strongest available reasoning model for in-depth system architecture analysis.

### ⚡ The Maintainer (Quick Fixes)
- **Category**: `bullet-time`
- **load_skills**: `["git-master"]`
- **Effect**: Uses cost-effective models to quickly fix code and generate clean commits.

---

## 5. Subagent Prompt Guide

When delegating, **clear and specific** prompts are essential. Include these 7 elements:

1. **TASK**: What needs to be done? (single objective)
2. **EXPECTED OUTCOME**: What is the deliverable?
3. **REQUIRED SKILLS**: Which skills should be loaded via `load_skills`?
4. **REQUIRED TOOLS**: Which tools must be used? (whitelist)
5. **MUST DO**: What must be done (constraints)
6. **MUST NOT DO**: What must never be done
7. **CONTEXT**: File paths, existing patterns, reference materials

**Bad Example**:
> "Fix this"

**Good Example**:
> **TASK**: Fix mobile layout breaking issue in `LoginButton.tsx`
> **CONTEXT**: `src/components/LoginButton.tsx`, using Tailwind CSS
> **MUST DO**: Change flex-direction at `md:` breakpoint
> **MUST NOT DO**: Modify existing desktop layout
> **EXPECTED**: Buttons align vertically on mobile

---

## 6. Configuration Guide (matrixx.json)

You can fine-tune categories in `matrixx.json`.

### Category Configuration Schema (CategoryConfig)

| Field | Type | Description |
|-------|------|-------------|
| `description` | string | Human-readable description of the category's purpose. Shown in the subagent prompt. |
| `model` | string | AI model ID to use (e.g., `anthropic/claude-sonnet-4-6`) |
| `variant` | string | Model variant (e.g., `max`, `xhigh`) |
| `temperature` | number | Creativity level (0.0 ~ 2.0). Lower is more deterministic. |
| `top_p` | number | Nucleus sampling parameter (0.0 ~ 1.0) |
| `prompt_append` | string | Content to append to system prompt when this category is selected |
| `thinking` | object | Thinking model configuration (`{ type: "enabled", budgetTokens: 16000 }`) |
| `reasoningEffort` | string | Reasoning effort level (`low`, `medium`, `high`) |
| `textVerbosity` | string | Text verbosity level (`low`, `medium`, `high`) |
| `tools` | object | Tool usage control (disable with `{ "tool_name": false }`) |
| `maxTokens` | number | Maximum response token count |
| `is_unstable_agent` | boolean | Mark agent as unstable - forces background mode for monitoring |
| `fallback_models` | string\|string[] | Fallback model(s) for this category. Overrides provider chain. |
| `complexity_downgrades` | object | Map complexity level to model downgrade: `{ "2": "opencode/ling-3.0-flash-free" }` |
| `disable` | boolean | When `true`, disables this category. |

### Example Configuration

```jsonc
{
  "categories": {
    // 1. Define new custom category
    "korean-writer": {
      "model": "opencode/minimax-m2.5-free",
      "temperature": 0.5,
      "prompt_append": "You are a Korean technical writer. Maintain a friendly and clear tone."
    },
    
    // 2. Override existing category (change model)
    "construct": {
      "model": "opencode/kimi-k2.5-free", // Can change model
      "temperature": 0.8
    },

    // 3. Configure thinking model and restrict tools
    "deep-reasoning": {
      "model": "zai-coding-plan/glm-4.7", // or any provider you have
      "thinking": {
        "type": "enabled",
        "budgetTokens": 32000
      },
      "tools": {
        "websearch": false // Disable web search
      }
    }
  },
  
  // Disable skills
  "disabled_skills": ["playwright"]
}
```
