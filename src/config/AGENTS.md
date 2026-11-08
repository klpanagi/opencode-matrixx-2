# CONFIG KNOWLEDGE BASE

## OVERVIEW

Zod schema definitions for plugin configuration. Schema component files composing `MatrixxConfigSchema` with multi-level inheritance and JSONC support.

## STRUCTURE
```
config/
├── schema/                    # ~40 schema component files
│   ├── matrixx-config.ts         # Root schema composition
│   ├── agent-names.ts         # BuiltinAgentNameSchema (13 agents), BuiltinSkillNameSchema (70 skills)
│   ├── agent-overrides.ts     # AgentOverrideConfigSchema (model, variant, temp, thinking...)
│   ├── agent-definitions.ts
│   ├── assembly.ts
│   ├── babysitting.ts
│   ├── background-task.ts     # BackgroundTaskConfigSchema
│   ├── browser-automation.ts  # BrowserAutomationConfigSchema
│   ├── categories.ts          # 8 categories: construct, source, rabbit-hole, glitch, bullet-time, blue-pill, the-one, transmission
│   ├── commands.ts            # BuiltinCommandNameSchema (24 commands)
│   ├── comment-checker.ts     # CommentCheckerConfigSchema
│   ├── context-mode.ts
│   ├── dcp.ts
│   ├── evolution.ts
│   ├── experimental.ts        # ExperimentalConfigSchema
│   ├── headroom.ts
│   ├── hooks.ts               # HookNameSchema (66 enum + 7 retained literals = 73 accepted; 65 hook dirs + 9 loose .ts on disk)
│   ├── internal/
│   ├── knowledge.ts
│   ├── matrix-loop.ts          # MatrixLoopConfigSchema
│   ├── memory.ts
│   ├── model-config.ts
│   ├── model-presets.ts
│   ├── morpheus.ts            # MorpheusConfigSchema
│   ├── morpheus-agent.ts      # MorpheusAgentConfigSchema
│   ├── notification.ts        # NotificationConfigSchema
│   ├── plans.ts
│   ├── rtk.ts
│   ├── runtime-fallback.ts
│   ├── security.ts
│   ├── skills.ts              # SkillsConfigSchema
│   ├── software-dev-enforcement.ts
│   ├── subagent-block.ts
│   ├── tasks.ts
│   ├── task.ts
│   ├── tdd-enforcer.ts
│   ├── tmux.ts                # TmuxConfigSchema, TmuxLayoutSchema
│   └── tool-policy.ts
├── schema.ts                  # Barrel export
├── index.ts                   # Barrel export
├── migrations/
└── preset-applier.ts
```

(Tests mirror under `tests/config/` — never co-located `*.test.ts` in `src/`.)

## ROOT SCHEMA

`MatrixxConfigSchema` composes: `$schema`, `global_model`, `model_presets`, `tasks` (unconditional; `enabled` is retained-deprecated and ignored), `default_run_agent`, `auto_update`, `disabled_{mcps,agents,skills,hooks,commands,tools}`, `agents` (13), `categories` (8), `skills`, `knowledge`, `tdd_enforcer`, `softwareDevEnforcement`, `subagent_block`, `assembly`, `security`, `tool_gating`, `matrixx_self_config`, `memory`, `headroom`, `context_mode`, `rtk`, `evolution`, `morpheus`, `morpheus_agent`, `matrix_loop`, `background_task`, `babysitting`, `notification`, `plans`, `browser_automation_engine`, `tmux`, `dcp`, `modelRequirements`, `complexityDowngrades`, `_migrations`

## CONFIGURATION HIERARCHY

Project (`.opencode/matrixx.jsonc`) → User (`~/.config/opencode/matrixx.jsonc`) → Defaults — both JSONC (`src/shared/text/jsonc-parser.ts`, comments + trailing commas). Old agent and hook names auto-migrate via `shared/migration/`; the 4 retired legacy todo hook names map to `null` there so existing `disabled_hooks` lists keep loading. `new_task_system_enabled` and `experimental.task_system` still parse but are ignored, with a one-time deprecation warning (see `docs/legacy-todo-migration.md`).

## AGENT OVERRIDE FIELDS

`model`, `variant`, `category`, `skills`, `request`, `system`, `system_append`, `disabled`, `steps`, `permissions`, `description`, `mode`, `color`, `fallbackChain`

## AFTER SCHEMA CHANGES

Run `bun run build:schema` to regenerate `dist/matrixx.schema.json`
