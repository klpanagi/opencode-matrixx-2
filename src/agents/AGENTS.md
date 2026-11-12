# AGENTS KNOWLEDGE BASE

## OVERVIEW

21 agent names in `BuiltinAgentNameSchema` (13 core agents + 8 `mouse-*` category workers) with factory functions, fallback chains, and model-specific prompt variants. Each agent has metadata (category, cost, triggers) and configurable tool restrictions.

`Smith` is the **pre-execution** reviewer (binary `[OKAY]`/`[REJECT]`, max 3 blockers).

## STRUCTURE

One home per agent: every definition lives under `definitions/`
(`NAME.ts`, or `NAME/` for multi-file agents: mouse, niobe, oracle).
Registry wiring lives only in `registry/`. Shared infra lives only in `shared/`.
The root `index.ts` is a compat barrel (definitions + registry + shared).

```
agents/
├── definitions/                # ONE HOME per agent (the rule: NAME.ts, or NAME/ if multi-file)
│   ├── morpheus.ts             # Main orchestrator
│   ├── keymaker.ts             # Autonomous deep worker
│   ├── seraph.ts               # Pre-planning analysis
│   ├── cipher.ts               # DSL engineering specialist
│   ├── sentinel.ts             # Security auditor
│   ├── merovingian.ts          # High-IQ consultation
│   ├── smith.ts                # Plan validator — pre-execution reviewer
│   ├── construct.ts            # Media analyzer
│   ├── sati.ts                 # Frontend specialist
│   ├── trinity.ts              # Codebase search
│   ├── operator.ts             # Library research
│   ├── mouse/                  # Delegated task executor (agent + model variants + shared)
│   ├── niobe/                  # Master orchestrator (agent + default/gpt prompts)
│   ├── oracle/                 # Plan Builder / Planner (index + 7 prompt sections)
│   └── index.ts                # Definitions barrel (re-exports all 13)
├── registry/                   # Registry wiring ONLY (renamed from builtin-agents*)
│   ├── index.ts                # Sole registry entry (createBuiltinAgents, agentSources, agentMetadata)
│   ├── agent-overrides.ts
│   ├── available-skills.ts
│   ├── general-agents.ts
│   ├── keymaker-agent.ts       # maybeCreate* wiring (orchestrators only)
│   ├── model-resolution.ts
│   ├── morpheus-agent.ts
│   ├── niobe-agent.ts
│   └── resolve-file-uri.ts
├── shared/                     # Shared infra ONLY (no agent definitions)
│   ├── agent-builder.ts
│   ├── agent-config.ts
│   ├── agents.transform.ts     # V2 agent-domain transform (pure replay onto ctx.agent.transform)
│   ├── custom-agent-summaries.ts
│   ├── dynamic-agent-prompt-builder.ts
│   ├── env-context.ts
│   ├── model-directives.ts
│   └── types.ts                # AgentName, AgentModelConfig, AgentPromptMetadata
└── index.ts                    # Compat barrel only (definitions + registry + shared)
```

## AGENT MODELS

| Agent | Model | Temp | Fallback Chain | Cost |
|-------|-------|------|----------------|------|
| Morpheus | <provider>/<model> | 0.1 | <provider>/<model> → <provider>/<model> → <provider>/<model> | EXPENSIVE |
| Keymaker | gpt-5.3-codex | 0.1 | gpt-5.2 (requires openai/github-copilot/venice/opencode) | EXPENSIVE |
| Seraph | <provider>/<model> | 0.3 | <provider>/<model> → <provider>/<model> → <provider>/<model> | EXPENSIVE |
| Oracle | <provider>/<model> | 0.1 | <provider>/<model> → <provider>/<model> → <provider>/<model> | EXPENSIVE |
| Niobe | <provider>/<model> | 0.1 | <provider>/<model> → <provider>/<model> | EXPENSIVE |
| Cipher | <provider>/<model> | 0.1 | <provider>/<model> → <provider>/<model> → <provider>/<model> → <provider>/<model> | EXPENSIVE |
| Sentinel | <provider>/<model> | 0.1 | <provider>/<model> → <provider>/<model> → <provider>/<model> → <provider>/<model> | EXPENSIVE |
| Merovingian | <provider>/<model> | 0.1 | <provider>/<model> → <provider>/<model> | EXPENSIVE |
| Smith | <provider>/<model> | 0.1 | <provider>/<model> → <provider>/<model> | EXPENSIVE |
| Construct | <provider>/<model> | 0.1 | <provider>/<model> → <provider>/<model> → <provider>/<model> → <provider>/<model> | EXPENSIVE |
| Sati | <provider>/<model> | 0.1 | <provider>/<model> → <provider>/<model> | EXPENSIVE |
| Mouse | <provider>/<model> | 0.1 | (user-configurable via tier) | EXPENSIVE |
| Trinity | <provider>/<model> | 0.1 | <provider>/<model> → <provider>/<model> → <provider>/<model> | CHEAP |
| Operator | <provider>/<model> | 0.1 | <provider>/<model> → <provider>/<model> → <provider>/<model> | CHEAP |

## TOOL RESTRICTIONS

An agent receives `task_*` iff `MODE ∈ {primary, all}` and its work is multi-step. The grant is derived from `mode` in `src/plugin/handlers/task-permissions.ts`, never from a name list, and the criterion is one-directional: `mode ∈ {primary, all}` ⇒ granted, never the converse. `Mouse` is the documented carve-out (`mode: "subagent"`, full task permissions — it owns the task-store records for the delegated work it runs). Full policy in `docs/task-system.md` §3.5.

| Agent | Mode | Denied | Allowed |
|-------|------|--------|---------|
| Merovingian | subagent | write, edit, task | Read-only consultation |
| Operator | subagent | write, edit, task | Research tools only |
| Trinity | subagent | write, edit, task | Search tools only |
| Construct | subagent | ALL except `read` | Vision-only |
| Mouse | subagent | — (task permitted, see carve-out) | `task_*` — owns its delegated task records |
| Niobe | primary | — (task permitted) | `task_*`, teammate — orchestration only |
| Sentinel | all | write, edit, multiedit, `task` (delegation denied, `task_*` tracking allowed) | Read-only security auditing |
| Cipher | all | — | `task_*`, teammate — delegates per target language |
| Keymaker | primary | — | `task_*`, teammate |

## THINKING / REASONING

| Agent | Claude | GPT |
|-------|--------|-----|
| Morpheus | 32k budget tokens | reasoningEffort: "medium" |
| Keymaker | — | reasoningEffort: "medium" |
| Oracle | 32k budget tokens | reasoningEffort: "medium" |
| Seraph | 32k budget tokens | — |
| Smith | 32k budget tokens | reasoningEffort: "medium" |
| Sentinel | 32k budget tokens | reasoningEffort: "medium" |
| Mouse | 32k budget tokens | reasoningEffort: "medium" |

## HOW TO ADD

1. Create `src/agents/definitions/my-agent.ts` (or `src/agents/definitions/my-agent/` for multi-file) exporting factory + metadata; re-export from `src/agents/definitions/index.ts`
2. Add to `agentSources` **and** the metadata map in `src/agents/registry/index.ts`
3. Re-export from `src/agents/index.ts`; add the name to `AgentName` in `src/agents/shared/types.ts`
4. Add the name to `BuiltinAgentNameSchema` in `src/config/schema/agent-names.ts`
5. Add the entry to `AgentOverridesSchema` in `src/config/schema/agent-overrides.ts`
6. Add the name to the explore-agent set in `src/plugin/handlers/agent-config-handler.ts`
7. Add the name to `src/hooks/runtime-fallback/agent-resolver.ts`
8. Add tool restrictions in `src/shared/tool/agent-tool-restrictions.ts`
9. Add model requirements in `src/shared/model/model-requirements.ts`
10. Add the display name in `src/shared/agent/agent-display-names.ts`

## KEY PATTERNS

- **Factory**: `createXXXAgent(model): AgentConfig`
- **Metadata**: `XXX_PROMPT_METADATA` with category, cost, triggers
- **Model-specific prompts**: Niobe, Mouse have GPT vs Claude variants
- **Dynamic prompts**: Morpheus, Keymaker use `dynamic-agent-prompt-builder.ts` to inject available tools/skills/categories

## ANTI-PATTERNS

- **Trust agent self-reports**: NEVER — always verify outputs
- **High temperature**: Don't use >0.3 for code agents
- **Sequential calls**: Use `subagent` with `background` for exploration
- **Oracle writing code**: Planner only — never implements
