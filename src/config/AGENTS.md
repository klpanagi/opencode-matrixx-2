# CONFIG KNOWLEDGE BASE

## OVERVIEW

Zod schema definitions for plugin configuration. Schema component files composing `MatrixxConfigSchema` with multi-level inheritance and JSONC support.

## STRUCTURE
```
config/
├── schema/                    # schema component files
│   ├── matrixx-config.ts         # Root schema composition (57 lines)
│   ├── agent-names.ts         # BuiltinAgentNameSchema (17 agents), BuiltinSkillNameSchema (50 skills)
│   ├── agent-overrides.ts     # AgentOverrideConfigSchema (model, variant, temp, thinking...)
│   ├── categories.ts          # 8 categories: construct, source, deep-jack, matrix-bend, bullet-time, ...
│   ├── hooks.ts               # HookNameSchema (65 enum + 7 retained literals = 72 accepted; 73 hook entries in 64 dirs + 9 loose .ts on disk)
│   ├── commands.ts            # BuiltinCommandNameSchema
│   ├── experimental.ts        # ExperimentalConfigSchema
│   ├── background-task.ts     # BackgroundTaskConfigSchema
│   ├── claude-code.ts         # ClaudeCodeConfigSchema
│   ├── comment-checker.ts     # CommentCheckerConfigSchema
│   ├── notification.ts        # NotificationConfigSchema
│   ├── matrix-loop.ts          # MatrixLoopConfigSchema
│   ├── morpheus.ts            # MorpheusConfigSchema
│   ├── morpheus-agent.ts      # MorpheusAgentConfigSchema
│   ├── skills.ts              # SkillsConfigSchema (45 lines)
│   ├── tmux.ts                # TmuxConfigSchema, TmuxLayoutSchema
│   ├── browser-automation.ts  # BrowserAutomationConfigSchema
│   ├── git-master.ts          # GitMasterConfigSchema
│   └── babysitting.ts         # BabysittingConfigSchema
├── schema.ts                  # Barrel export (24 lines)
├── schema.test.ts             # Validation tests (735 lines)
├── types.ts                   # TypeScript types from schemas
└── index.ts                   # Barrel export (33 lines)
```

## ROOT SCHEMA

`MatrixxConfigSchema` composes: `$schema`, `global_model`/`default_tier`, `tasks` (unconditional; `enabled` is retained-deprecated and ignored), `default_run_agent`, `auto_update`, `disabled_{mcps,agents,skills,hooks,commands,tools}`, `agents` (17), `categories` (8), `tdd_enforcer` (`{enabled:true}` fail-closed; opt out via `{enabled:false}`), `assembly`, `security`, `headroom`, `context_mode`, `rtk`, `evolution`, `morpheus`, `morpheus_agent`, `matrix_loop`, `background_task`, `babysitting`, `notification`, `browser_automation_engine`, `tmux`, `dcp`, `_migrations`

## CONFIGURATION HIERARCHY

Project (`.opencode/matrixx.jsonc`) → User (`~/.config/opencode/matrixx.jsonc`) → Defaults — both JSONC (`jsonc-parser.ts`, comments + trailing commas). Old agent and hook names auto-migrate via `shared/migration/`; the 4 retired legacy todo hook names map to `null` there so existing `disabled_hooks` lists keep loading. `new_task_system_enabled` and `experimental.task_system` still parse but are ignored, with a one-time deprecation warning (see `docs/legacy-todo-migration.md`).

## AGENT OVERRIDE FIELDS

`model`, `variant`, `category`, `skills`, `request`, `system`, `system_append`, `disabled`, `steps`, `permissions`, `description`, `mode`, `color`, `fallbackChain`

## AFTER SCHEMA CHANGES

Run `bun run build:schema` to regenerate `dist/matrixx.schema.json`
