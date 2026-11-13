# Matrixx Orchestration

**Audience:** users running multi-step work and engineers extending the workflow.
**Canonical entry point for understanding orchestration.**
If you read one orchestration doc, read this one.
**See also:** `agents.md` (the roster), `task-system.md` (execution state), `command-reference.md` (`/start-work`, `/matrix-loop`), `category-skill-guide.md` (categories × skills).

Matrixx implements a simple philosophy: **separation of planning and execution**.
A planner figures out what to do. An executor coordinates the work.
Specialized workers do the work. The task system keeps state so nothing
is lost across sessions.

Execution state lives in file-backed tasks. See
[`docs/task-system.md`](./task-system.md) for the storage spec
(`.matrixx/tasks`, waves, continuation).

## TL;DR: When to Use What

| Complexity | Approach | When to Use |
|------------|----------|-------------|
| **Simple** | Just prompt | Quick fixes, single-file changes |
| **Complex + Lazy** | Type `rp` or `redpill` | Explaining full context is tedious, let the agent figure it out |
| **Complex + Precise** | Plan with Oracle, then `/start-work` | Multi-step work needing verifiable execution; Oracle plans, Niobe executes |

**Decision flow:**

```
Is it a quick fix or simple task?
  |- YES -> Just prompt normally
  |- NO  -> Is explaining the full context tedious?
             |- YES -> Type "rp" and let the agent figure it out
             |- NO  -> Do you need precise, verifiable execution?
                        |- YES -> Ask Oracle (or Morpheus) for a plan, then /start-work
                        |- NO  -> Just use "rp"
```

## The Three Layers

```
Planning                 Execution              Workers
(Human + Oracle)         (Orchestrator)         (Specialists)

User describes work
  -> Oracle interviews, researches
  -> Seraph checks for gaps (mandatory)
  -> Smith reviews (high-accuracy mode)
  -> .matrixx/plans/{name}.md
       -> /start-work
            -> Niobe reads plan via plan_tasks + plan_read, builds waves
                 -> subagent(agent=...) -> Mouse and specialists
                 -> verify each result independently
                 -> final report
```

### Why layers work

1. **Separation of concerns.** Planning uses high reasoning once per project.
   Orchestration coordinates. Execution stays focused.
2. **Explicit over implicit.** Every worker prompt carries the exact task,
   success criteria, forbidden actions, and accumulated wisdom. No guessing.
3. **Trust but verify.** The orchestrator never trusts worker claims. It runs
   `lsp_diagnostics`, executes tests, and reads the changed files itself.

## Layer 1: Planning (Oracle + Seraph + Smith)

### Oracle: the plan builder

Oracle (`src/agents/definitions/oracle/`) is a **read-only planner**. It interviews you,
researches the codebase through `trinity` and `operator` agents, and writes a
single structured plan to `.matrixx/plans/{name}.md`. It never writes
production code.

**Two ways to invoke Oracle (same result, pick what feels natural):**

```
# Method 1: switch agents (clean "planning mode" for a fresh session)
1. Press Tab, select "Oracle"
2. Describe your work: "I want to refactor the auth system"
3. Answer interview questions
4. Oracle writes .matrixx/plans/{name}.md

# Method 2: ask Morpheus to plan (fastest from current context)
1. Stay in Morpheus (default agent)
2. Describe the work and ask for a plan: "I want to refactor the auth system"
3. There is no @plan keyword routing: switch to Oracle yourself, or let Morpheus hand the planning to Oracle
4. Answer interview questions, Oracle writes the plan
```

**Interview flow:** Oracle starts in interview mode. It classifies intent
(refactor, new feature, architecture), gathers codebase context, and records
discussion in `.matrixx/drafts/`. When requirements are clear (objective,
scope, approach, test strategy), plan generation begins. Say "make it a
plan" when ready; Oracle asks questions until then.

### Seraph: the gap analyzer (mandatory)

Before Oracle writes the plan, Seraph (`src/agents/definitions/seraph.ts`) catches what
Oracle missed: hidden intent, ambiguities, over-engineering, missing
acceptance criteria, unaddressed edge cases. The plan author makes
connections that never reach the page. Seraph forces that implicit
knowledge out into the open.

### Smith: the reviewer (high-accuracy mode)

When you ask for high accuracy, Smith (`src/agents/definitions/smith.ts`) validates the
plan against four criteria: clarity (where to find implementation details),
verification (concrete, measurable acceptance criteria), context (enough to
proceed without guessing about business logic), and big picture (purpose and
workflow clear). Smith answers OKAY or REJECTED. On rejection, Oracle fixes
the issues and resubmits. The loop exits on one of four conditions:

| Exit | Meaning |
|------|---------|
| `OKAY` | Plan approved. Best case. |
| `CONVERGED` | A round surfaced no NEW issue category — the remaining blockers are not shrinking, so shipping now is correct, not a failure. |
| `STALL` | The identical category set twice in a row. Author and reviewer are disagreeing, not converging — stop and ask the user which constraint wins. |
| `CEILING` | Round budget exhausted. Every unresolved blocker is recorded under the plan's "Unresolved Smith Blockers" heading and named in the reply; an un-reviewed revision is never presented as passed. |

The author classifies each of Smith's free-text blocking issues into one of three
buckets — `reference`, `executability`, or `blocker` — which are Smith's own three
checks. Those buckets are what make convergence detectable: a round that introduces
a new bucket is still making progress, a round that repeats the same set is not.
Smith itself is unchanged and reports plain free text.

#### `plans.smith_max_review_rounds`

```jsonc
// "plans": {
//   "smith_max_review_rounds": 8,  // (default: 8, min: 2, max: 20)
// }
```

The ceiling on Smith review rounds. It is **burn control only** — not the
stopping rule. The loop normally exits well before it on convergence; the
ceiling bounds the pathological case where every round introduces a new issue
category. Raise it when reviews genuinely need more rounds; lower it to cap
agent burn on large plans.

## Layer 2: Execution (Niobe)

Niobe (`src/agents/definitions/niobe/`, with multiple prompt variants) is
the plan executor. Think niobe, not instrumentalist: it reads the plan,
decomposes it into waves, delegates each task, verifies each result, and
reports. It does not write implementation code itself.

### /start-work and session continuity

`/start-work` is the execution trigger. It carries `agent: "niobe"` and
follows this logic (see `src/features/builtin-commands/templates/start-work.ts`):

```
User: /start-work
  -> Find plans via plan_list at .matrixx/plans/
  -> Check .matrixx/mission.json (active plan tracker)
       |- EXISTS and plan incomplete -> RESUME MODE
       |    Append current session to session_ids, continue from
       |    the last incomplete task (progress = checked vs unchecked boxes)
       |- MISSING or plan complete -> INIT MODE
            One plan: auto-select it. Many plans: list with timestamps,
            ask the user. Write mission.json, call plan_tasks for the
            task manifest, then read the plan body via paginated
            plan_read (offset/limit) — one call cannot return a plan
            that renders above the soft cap. Start executing from task 1.
```

`mission.json` tracks `active_plan`, `started_at`, `session_ids`, and
`plan_name`. Because plans and tasks are file-backed, a new session picks
up exactly where the old one stopped. Example: Monday morning you run
`/start-work`, finish 3 of 8 tasks, then the session ends. Monday afternoon
you open a fresh session, run `/start-work`, see "Resuming ... 3 of 8
tasks complete", and Niobe continues from task 4.

You never need to switch to Niobe manually. `/start-work` handles it.
Manual switching helps only in edge cases: the plan was edited by hand,
you are debugging orchestration, you want a fresh run (delete
`.matrixx/mission.json` first), or you manage several plans at once.

### Wave planning with the task system

Niobe decomposes the plan into **task waves** using `task_create` with
`blockedBy` dependencies. It gets the task list from `plan_tasks` (compact
manifest with progress and numbered tasks) and reads plan sections via
paginated `plan_read` (offset/limit) when implementation details are needed.
Independent tasks in Wave 1 run in parallel.
Wave 2 tasks declare `blockedBy: [Wave 1 ids]` and become runnable when
`task_list` shows empty blockers. Task files (`.matrixx/tasks/T-*.json`)
are project-scoped by default and survive `/clear` and restarts, unlike
ephemeral session todos.

While incomplete tasks remain, agents keep working them through `task_list` and `task_update`. The task-continuation-enforcer was removed. The automatic TODO re-prompt on parent idle is gone. Its shared helpers live on at src/features/task-session-scope/staleness.ts and todo.ts. Subagent results are delivered to the parent as completion messages. The orchestrator absorbs each child's completion with `session_read`, and no separate background-manager notification layer exists. Full spec: [`docs/task-system.md`](./task-system.md).

### Wisdom accumulation

Orchestration learns cumulatively. After each task, learnings (conventions,
successes, failures, gotchas, commands) pass forward to all later workers
through `.matrixx/notepads/{plan-name}/` (`learnings.md`, `decisions.md`,
`issues.md`, `verification.md`, `problems.md`). Later tasks do not repeat
earlier mistakes.

### Plan tool contract

Plans are managed through a dedicated set of tools. Raw `Write`/`Edit`/`Read`
on `.matrixx/plans/*.md` is blocked by `task-edit-guard`.

| Tool | Purpose |
|------|---------|
| `plan_create` | Create a new plan (kebab-case `.md`, WARN-first contract validation) |
| `plan_read` | Read plan content: hashline (default) or content format, paginated via offset/limit |
| `plan_tasks` | Compact manifest: progress, numbered tasks, definition-of-done (no plan body) |
| `plan_list` | List plans with per-entry progress (total, completed, remaining, isComplete) |
| `plan_update` | Edit via LINE#ID hashline anchors; post-edit contract warnings surfaced |
| `plan_delete` | Remove a plan file |

**Write-time size cap**: `plan_create` rejects content exceeding 140,000 bytes
(`size_exceeded` error). `plan_update` guards the same cap post-edit.

**Soft render cap**: `plan_read` returns at most 40,000 rendered bytes per call.
When the selected format exceeds this, it returns `{ truncated, outline, hint }`
with no payload. The correct recovery is: call `plan_tasks` for the manifest,
then paginate `plan_read` with offset/limit for content sections.

**WARN-first contract validation**: `plan_create` and `plan_update` run
`validatePlanContract` and return advisory `warnings` on the success payload.
Validator warnings never block persistence; only the hard size cap does.

**Canonical core and appendix**: Plans should follow 8 canonical H2 sections
(TL;DR, Context, Work Objectives, Verification Strategy, Execution Strategy,
TODOs, Commit Strategy, Success Criteria). Content after the first `## Appendix`
H2 is exempt from section-ordering and unknown-section checks.

**Grandfather/migration path**: Existing plans without front-matter are
grandfathered. Front-matter is injected on the next `plan_update` call
(`apply-on-next-edit` only). No `plan_migrate` tool is shipped.

## Layer 3: Workers (Mouse + Specialists)

### Mouse: the task executor

Mouse (`src/agents/definitions/mouse/`) is the workhorse that writes code. It receives
detailed prompts (the 7-section format: TASK, EXPECTED OUTCOME, REQUIRED
SKILLS, REQUIRED TOOLS, MUST DO, MUST NOT DO, CONTEXT plus wisdom), tracks
its own todos obsessively, and must pass `lsp_diagnostics` before marking
work complete. It cannot delegate further and cannot touch plan files.

### Specialists

Specialist roster (Trinity, Operator, Sati, Cipher, Sentinel, Merovingian, Construct, and others): see [`docs/agents.md`](./agents.md) — linked, not duplicated here.

The full registry (13 core agents: morpheus, keymaker, oracle, merovingian, operator, trinity, construct, seraph, smith, niobe, cipher, sentinel, sati, plus 8 `mouse-*` workers) lives in
`src/agents/registry/index.ts` with the schema in
`src/config/schema/agent-names.ts` (`BuiltinAgentNameSchema`, 21 names).
`mouse-*` workers (`src/agents/definitions/mouse/`) are spawned per category and run at delegation depth 1.
Models resolve from your configured providers with
fallback chains; worker agents default to temperature 0.1 (Seraph uses 0.3).
For the full roster and per-agent detail, see [`docs/agents.md`](./agents.md).

## The subagent(agent=…) Category + Skill System

### Categories describe intent, not models

```typescript
// Category names the kind of work; the system picks model and prompt shape
subagent(agent="mouse-source", description="Deep implementation", prompt="...")
subagent(agent="mouse-construct", description="UI work", prompt="...")
subagent(agent="mouse-bullet-time", description="Trivial fix", prompt="...")
```

Built-in categories (`src/config/schema/categories.ts`): `source`,
`construct`, `rabbit-hole` (deep analysis and debugging), `glitch`
(creative problem solving), `blue-pill` (conservative, safe), `the-one`
(bold, transformative), `transmission` (docs and prose), `bullet-time`
(trivial tasks). Custom categories can be defined in `matrixx.json`. Guide:
[`docs/category-skill-guide.md`](./category-skill-guide.md).

### Skills add domain expertise

```typescript
subagent(agent="mouse-construct", load_skills=["frontend-ui-ux"], description="UI work", prompt="...")
subagent(agent="mouse-bullet-time", load_skills=["playwright"], description="Browser check", prompt="...")
```

Skills prepend domain instructions to the worker prompt. All 70 built-in
skills (`BuiltinSkillNameSchema` in `src/config/schema/agent-names.ts`;
frontend, DSL, security, testing, and more) are domain-specific, so
for pure prose and docs tasks `load_skills=[]` is intentional, not an
omission.

## Execution Modes: Keymaker vs Morpheus + redpill

| Aspect | Keymaker | Morpheus + `rp` / `redpill` |
|--------|-----------|-------------------------------|
| **What** | Dedicated agent for autonomous deep work | Keyword that activates redpill mode in any session |
| **Doctrine** | Autonomous reasoning, self-directed | The Matrixx Manifesto: reproducible evidence over assertion, working code over plausible code |
| **Model** | `claude-opus-4-6` (max) → `claude-sonnet-4-6` (providers: anthropic, github-copilot, opencode) | Your configured default model |
| **Planning** | Self-plans during execution | Uses Oracle plans when available, explores autonomously otherwise |
| **Best for** | Deep architectural reasoning, hard debugging, cross-domain synthesis | General complex tasks, "just do it" scenarios |

**Use Keymaker** (Tab, select Keymaker) when you need deep autonomous
reasoning: designing a plugin system, tracing a race condition across
15 files, migrating databases with zero downtime.

**Use `rp`** (stay in Morpheus, type `rp fix the failing tests`) when you
want the agent to figure it out: well-scoped complex tasks, existing
patterns to follow, or honest laziness about writing requirements.

**Default advice:** `rp` covers roughly 90 percent of complex tasks.
Reach for Keymaker when a problem specifically benefits from its
reasoning style and fully autonomous explore-first approach.

## Async Delegation and Matrix Loop

**Async delegation** uses the native `subagent` tool:
the parent keeps working while children run, and each child's
completion is injected as a message in the parent session (read the full
transcript with `session_read`). There is no separate queue or poller.

**Matrix loop** (hook tier at `src/hooks/matrix-loop/`, commands
`/matrix-loop`, `/rp-loop`, `/cancel-loop` from
`src/features/builtin-commands/templates/matrix-loop.ts`) keeps working a
task across iterations until a completion promise holds or the iteration cap
is reached. `/rp-loop` is the same loop with redpill mode active.
`/cancel-loop` stops it.

## Commands

| Command | Purpose |
|---------|---------|
| planning (no command) | Ask Oracle (or Morpheus) for a plan in conversation; there is no `@plan` routing keyword |
| `/start-work` | Execute the plan (find or resume via `mission.json`, switch to Niobe) |
| `/matrix-loop`, `/rp-loop`, `/cancel-loop` | Start or stop a self-referential dev loop |
| `/redpill`, `/end-redpill` | Toggle redpill mode at runtime |
| `/task-list`, `/cleanup-tasks` | Inspect and clean task state |
| `/stop-continuation` | Pause automated continuation |
| `/handoff`, `/pickup` | Hand off a session, resume from a handoff |
| `/refactor`, `/research`, `/remove-deadcode` | Guided workflows that plug into the same workers |

Full reference with arguments and intercepts:
[`docs/command-reference.md`](./command-reference.md)
(23 built-ins covering orchestration, research, refactoring, handoffs,
tasks, BDD, and toggles — see `src/features/builtin-commands/types.ts`
`BuiltinCommandName`: init-deep, matrix-loop, rp-loop, cancel-loop, refactor,
plan-review, start-work, stop-continuation, humanize, handoff, pickup,
remove-deadcode, preset, end-redpill, research, assembly, redpill,
bdd-pipeline, cleanup-tasks, task-list, quality-audit,
quality-assurance, security-audit).

## Configuration

```jsonc
{
  "morpheus_agent": {
    "disabled": false,           // orchestration master switch (default: false)
    "planner_enabled": true,     // enable Oracle (default: true)
    "replace_plan": true         // replace default plan agent with Oracle (default: true)
  },

  // Hook settings (add to disable)
  "disabled_hooks": [
    // "start-work",             // disable execution trigger
    // "oracle-md-only"      // remove Oracle write restrictions (not recommended)
  ]
}
```

## Troubleshooting

**"I switched to Oracle but nothing happened."**
Oracle opens in interview mode. Answer its questions, then say "make it a
plan" when requirements are settled.

**"/start-work says no active plan found."**
No plans exist in `.matrixx/plans/`, so create one with Oracle first. Or
`mission.json` points at a stale plan, so delete `.matrixx/mission.json`
and retry.

**"I am in Niobe but want normal mode back."**
Type `exit` or start a new session. Niobe is entered through
`/start-work`; manual switching is rarely needed.

**"Asking Morpheus to plan vs switching to Oracle, which one?"**
Same result. There is no `@plan` routing keyword; ask Oracle directly or
let Morpheus hand the planning to Oracle.

**"Keymaker or rp?"**
`rp` for most tasks. Keymaker for deep architectural work that benefits
from its autonomous reasoning style.

## Appendix A: Figures

Diagrams kept from the retired companion guide
(`guide/understanding-orchestration-system.md`, merged here and deleted).
Model labels inside figures are illustrative; actual models resolve from
your configured providers with fallback chains. "Junior" in old prose is
Mouse; "Frontend" in old diagrams is Sati.

### Figure 1: Three-layer architecture

```mermaid
flowchart TB
    subgraph Planning["Planning Layer (Human + Oracle)"]
        User[("👤 User")]
        Oracle["🔥 Oracle<br/>(Planner)"]
        Seraph["🦉 Seraph<br/>(Consultant)"]
        Smith["👁️ Smith<br/>(Reviewer)"]
    end

    subgraph Execution["Execution Layer (Orchestrator)"]
        Orchestrator["⚡ Niobe<br/>(Niobe)"]
    end

    subgraph Workers["Worker Layer (Specialized Agents)"]
        Junior["🪨 Mouse<br/>(Task Executor)"]
        Merovingian["🧠 Merovingian<br/>(Architecture)"]
        Trinity["🔍 Trinity<br/>(Codebase Grep)"]
        Operator["📚 Operator<br/>(Docs/OSS)"]
        Frontend["🎨 Sati<br/>(UI/UX)"]
    end

    User -->|"Describe work"| Oracle
    Oracle -->|"Consult"| Seraph
    Oracle -->|"Interview"| User
    Oracle -->|"Generate plan"| Plan[".matrixx/plans/*.md"]
    Plan -->|"High accuracy?"| Smith
    Smith -->|"OKAY / REJECT"| Oracle

    User -->|"/start-work"| Orchestrator
    Plan -->|"Read"| Orchestrator

    Orchestrator -->|"subagent(agent=…)"| Junior
    Orchestrator -->|"subagent(agent)"| Merovingian
    Orchestrator -->|"subagent(agent)"| Trinity
    Orchestrator -->|"subagent(agent)"| Operator
    Orchestrator -->|"subagent(agent)"| Frontend

    Junior -->|"Results + Learnings"| Orchestrator
    Merovingian -->|"Advice"| Orchestrator
    Trinity -->|"Code patterns"| Orchestrator
    Operator -->|"Documentation"| Orchestrator
    Frontend -->|"UI code"| Orchestrator
```

### Figure 2: Oracle interview flow

```mermaid
stateDiagram-v2
    [*] --> Interview: User describes work
    Interview --> Research: Launch trinity/operator agents
    Research --> Interview: Gather codebase context
    Interview --> ClearanceCheck: After each response

    ClearanceCheck --> Interview: Requirements unclear
    ClearanceCheck --> PlanGeneration: All requirements clear

    state ClearanceCheck {
        [*] --> Check
        Check: ✓ Core objective defined?
        Check: ✓ Scope boundaries established?
        Check: ✓ No critical ambiguities?
        Check: ✓ Technical approach decided?
        Check: ✓ Test strategy confirmed?
    }

    PlanGeneration --> SeraphConsult: Mandatory gap analysis
    SeraphConsult --> WritePlan: Incorporate findings
    WritePlan --> HighAccuracyChoice: Present to user

    HighAccuracyChoice --> SmithLoop: User wants high accuracy
    HighAccuracyChoice --> Done: User accepts plan

    SmithLoop --> WritePlan: REJECTED - fix issues
    SmithLoop --> Done: OKAY - plan approved

    Done --> [*]: Guide to /start-work
```

### Figure 3: Niobe niobe loop

```mermaid
flowchart LR
    subgraph Orchestrator["Niobe"]
        Read["1. Read Plan"]
        Analyze["2. Analyze Tasks"]
        Wisdom["3. Accumulate Wisdom"]
        Delegate["4. Delegate Tasks"]
        Verify["5. Verify Results"]
        Report["6. Final Report"]
    end

    Read --> Analyze
    Analyze --> Wisdom
    Wisdom --> Delegate
    Delegate --> Verify
    Verify -->|"More tasks"| Delegate
    Verify -->|"All done"| Report

    Delegate -->|"async fan-out"| Workers["Async children<br/>(completion messages)"]
    Workers -->|"Results + Learnings"| Verify
```

### Figure 4: Orchestrator → Mouse workflow

```mermaid
sequenceDiagram
    participant User
    participant Orchestrator as Niobe
    participant Junior as Mouse
    participant Notepad as .matrixx/notepads/

    User->>Orchestrator: /start-work
    Orchestrator->>Orchestrator: Read plan, build parallelization map

    loop For each task (parallel when possible)
        Orchestrator->>Notepad: Read accumulated wisdom
        Orchestrator->>Orchestrator: Build 7-section prompt

        Note over Orchestrator: Prompt Structure:<br/>1. TASK (exact checkbox)<br/>2. EXPECTED OUTCOME<br/>3. REQUIRED SKILLS<br/>4. REQUIRED TOOLS<br/>5. MUST DO<br/>6. MUST NOT DO<br/>7. CONTEXT + Wisdom

        Orchestrator->>Junior: subagent(agent, load_skills, prompt)

        Junior->>Junior: Create todos, execute
        Junior->>Junior: Verify (lsp_diagnostics, tests)
        Junior->>Notepad: Append learnings
        Junior->>Orchestrator: Results + completion status

        Orchestrator->>Orchestrator: Verify independently
        Note over Orchestrator: NEVER trust subagent claims<br/>Run lsp_diagnostics at PROJECT level<br/>Run full test suite<br/>Read actual changed files

        alt Verification fails
            Orchestrator->>Junior: Re-delegate with failure context
        else Verification passes
            Orchestrator->>Orchestrator: Mark task complete, continue
        end
    end

    Orchestrator->>User: Final report with all results
```

## Appendix B: Companion Notes

Condensed unique detail from the retired companion guide. Duplicated prose
(same three layers, category/skill table, trust-but-verify) is not repeated;
the body above keeps the best-written copy of each.

### Why specialization: what raw prompting gets wrong

Traditional single-agent flows (user asks, AI responds) break on complex
work for four reasons: context overload on large tasks, cognitive drift away
from requirements mid-task, verification gaps with no systematic completeness
check, and the human as bottleneck requiring constant intervention. The
layered system answers each: plans bound context per task, waves plus
notepads hold requirements steady, Niobe verifies independently, and
file-backed state lets sessions pause and resume without babysitting.

### Oracle intent strategies

Oracle adapts its interview style to the kind of work:

| Intent | Oracle Focus | Example Questions |
|--------|------------------|-------------------|
| **Refactoring** | Safety - behavior preservation | "What tests verify current behavior?" "Rollback strategy?" |
| **Build from Scratch** | Discovery - patterns first | "Found pattern X in codebase. Follow it or deviate?" |
| **Mid-sized Task** | Guardrails - exact boundaries | "What must NOT be included? Hard constraints?" |
| **Architecture** | Strategic - long-term impact | "Expected lifespan? Scale requirements?" |

### What Niobe can do vs must delegate

Niobe CAN: read files for context, run commands to verify results, use
`lsp_diagnostics` to check for errors, search patterns with grep/glob/ast-grep.

Niobe MUST delegate (never do itself): writing/editing code files,
fixing bugs, creating tests, git commits.

### Smith acceptance bar

Smith says OKAY only when file references are verified, most tasks carry
clear reference sources and concrete acceptance criteria, no task requires
assumptions about business logic, and no critical red flags remain. On
REJECTED, Oracle fixes the issues and resubmits with no retry limit.

### Why categories beat model names

Naming a model in the delegation call bakes in distributional bias: the
worker knows its own limitations and performs to them. Naming the intent
instead (`source` = think strategically, `construct` = design beautifully,
`bullet-time` = just get it done fast) lets the system pick the model and
prompt shape while the worker performs to the task.

### Custom categories

```json
// matrixx.json
{
  "categories": {
    "unity-game-dev": {
      "model": "anthropic/claude-sonnet-4-6",
      "temperature": 0.3,
      "prompt_append": "You are a Unity game development expert..."
    }
  }
}
```

### Skills evolution

| Before | After |
|--------|-------|
| Hardcoded: `frontend-ui-ux-engineer` (one model, one domain) | `subagent(agent="mouse-construct", load_skills=["frontend-ui-ux"])` |
| One-size-fits-all engineer | `subagent(agent="mouse-construct", load_skills=["unity-master"])` |
| Model bias | Category-based: model abstraction eliminates bias |

### Why a mid-tier worker is sufficient

Mouse does not need to be the smartest model; it needs to be reliable.
Detailed 50–200 line prompts, accumulated wisdom passed forward, clear MUST
DO / MUST NOT DO constraints, and mandatory verification mean the
intelligence lives in the system, not in any single agent.

## Further Reading

- [`docs/task-system.md`](./task-system.md): task storage, dependencies, hooks, wave discipline
- [`docs/agents.md`](./agents.md): per-agent reference, diagrams, delegation, roster
- [`docs/category-skill-guide.md`](./category-skill-guide.md): categories and skills
- [`docs/guide/overview.md`](./guide/overview.md): quick start
- [`docs/command-reference.md`](./command-reference.md#14-redpill): `/redpill` philosophy and usage
