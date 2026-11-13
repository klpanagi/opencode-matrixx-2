# TOOLS KNOWLEDGE BASE

## OVERVIEW

30 tool dirs (LSP ×6, AST-grep ×2, grep/glob/github-search, session-manager ×4, task ×5 `create/list/get/update/cleanup`, plan ×6 `create/read/update/list/delete/tasks` for `.matrixx/plans/*.md`, removed-tools (deleted-tool guard stubs), handoff, hashline-edit, interactive-bash, look-at, skill, slashcommand, assembly, knowledge-hub-confirm, preset, bdd-* ×4, pdf-extract-figures, dashboard-flux-validator, market-symbol-validator, notepad ×4, session-cleanup, silent-failure-scanner, staleness-gap-checker). Two patterns: Direct `MatrixxToolDefinition` (static) and Factory Function (context-dependent). Conditional registration via `src/plugin/tool/tool-policy.ts` — bdd/pdf-figures/look_at/session-cleanup/knowledge-hub-confirm/preset only load when relevant (see `tool-policy.ts`).

## STRUCTURE
```
tools/
├── task/             # 5 individual tools: create, list, get, update, cleanup (task-create.ts, task-list.ts, task-get.ts, task-update.ts, task-cleanup.ts)
├── plan/             # 6 plan tools: create, read, update, list, delete, tasks for `.matrixx/plans/*.md` (kebab-case, hashline IDs, atomicWrite, unconditional registry; plan_tasks reads T-*.json tasks)
├── lsp/              # 6 LSP tools: goto_definition, find_references, symbols, diagnostics, prepare_rename, rename
├── ast-grep/         # 2 tools: search, replace (25 languages)
├── grep/             # Custom grep (60s timeout, 10MB limit)
├── glob/             # File search (60s timeout, 100 file limit)
├── session-manager/  # 4 tools: list, read, search, info
├── handoff/          # Multi-action handoff: create, read, list, archive
├── hashline-edit/    # Hash-based line-precise file editing
├── interactive-bash/ # Tmux session management
├── look-at/          # Multimodal PDF/image analysis (gated: construct agent + media file)
├── skill/            # Skill execution with MCP support
├── assembly/         # Multi-model voting (assembly tool, gated by assembly.enabled)
├── bdd-create-contract/ # BDD contract generation (gated: *.feature file or override)
├── bdd-parse-gherkin/ # Gherkin parsing (gated)
├── bdd-pipeline/      # BDD pipeline (gated)
├── bdd-validate-contract/ # BDD validation (gated)
├── github-search/     # Native GitHub code search (replaced white-rabbit MCP)
├── knowledge-hub-confirm/ # Knowledge-hub write confirm gate (gated: hubs configured)
├── pdf-extract-figures/ # PDF figure extraction (gated: *.pdf file or override)
├── preset/            # Model preset switch (opt-in only)
├── dashboard-flux-validator/ # Grafana dashboard validation
├── market-symbol-validator/ # Market symbol validation
├── notepad/           # Persistent notepads (create/append/list/read)
├── session-cleanup/   # Session cleanup (gated: opt-in)
├── silent-failure-scanner/ # Silent-failure scan
├── staleness-gap-checker/ # Staleness gap check
├── subagent-control/  # Subagent cancel/wait control
├── removed-tools/     # Guard stubs for removed delegation tools (`task`, `background_*`)
└── slashcommand/     # Slash command dispatch
```

## TOOL INVENTORY

| Tool | Category | Pattern | Key Logic |
|------|----------|---------|-----------|
| `task_create` | Task | Factory | Create task with auto-generated T-{uuid} ID, threadID recording |
| `task_list` | Task | Factory | List active tasks with summary (excludes completed/deleted) |
| `task_get` | Task | Factory | Retrieve full task object by ID |
| `task_update` | Task | Factory | Update task fields, supports addBlocks/addBlockedBy for dependencies |
| `task_cleanup` | Task | Factory | Delete completed tasks from storage |
| `handoff` | Session | Factory | Multi-action: create, read, list, archive |
| `lsp_goto_definition` | LSP | Direct | Jump to symbol definition |
| `lsp_find_references` | LSP | Direct | Find all usages across workspace |
| `lsp_symbols` | LSP | Direct | Document or workspace symbol search |
| `lsp_diagnostics` | LSP | Direct | Get errors/warnings from language server |
| `lsp_prepare_rename` | LSP | Direct | Validate rename is possible |
| `lsp_rename` | LSP | Direct | Rename symbol across workspace |
| `ast_grep_search` | Search | Factory | AST-aware code search (25 languages) |
| `ast_grep_replace` | Search | Factory | AST-aware code replacement |
| `grep` | Search | Factory | Regex content search with safety limits |
| `glob` | Search | Factory | File pattern matching |
| `session_list` | Session | Factory | List all sessions |
| `session_read` | Session | Factory | Read session messages |
| `session_search` | Session | Factory | Search across sessions |
| `session_info` | Session | Factory | Session metadata and stats |
| `interactive_bash` | System | Direct | Tmux session management |
| `look_at` | System | Factory | Multimodal PDF/image analysis |
| `skill` | Skill | Factory | Execute skill with MCP capabilities |
| `slashcommand` | Command | Factory | Slash command dispatch |

## TASK TOOLS

Task management system with auto-generated T-{uuid} IDs, dependency tracking, and OpenCode Todo API sync.

### task_create

Create one or more tasks with auto-generated IDs and threadID recording. **Returns `{ tasks: [...], errors: [...] }` always, including for a single task** — a breaking change from the old `{ task: { id, subject } }` return. Batches are partial-success: one invalid item fails only itself and is reported in `errors` with its `index`. See `docs/task-system.md` §3.5 for who receives `task_*` in the first place.

**Args:**
| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `subject` | string | Yes | Task subject/title |
| `description` | string | No | Task description |
| `activeForm` | string | No | Active form (present continuous) |
| `metadata` | Record<string, unknown> | No | Task metadata |
| `blockedBy` | string[] | No | Task IDs that must complete before this task |
| `blocks` | string[] | No | Task IDs this task blocks |
| `repoURL` | string | No | Repository URL |
| `parentID` | string | No | Parent task ID |
| `priority` | "low" \| "medium" \| "high" | No | Stored but **not read by anything** — see note below |

**Example:**
```typescript
task_create({
  subject: "Implement user authentication",
  description: "Add JWT-based auth to API endpoints",
  blockedBy: ["T-abc123"] // Wait for database migration
})
```

**Returns:** `{ tasks: [{ id, subject }], errors: [] }` — one shape, always, N=1 included. A caller still reading `result.task` is reading the pre-change contract and will get `undefined`.

**`priority` (`low` | `medium` | `high`, optional) has no reader.** It is stored and round-trips through `task_create` / `task_update`, but nothing currently sorts, filters or renders on it. Do not build a plan or workflow that depends on it having an effect.

### task_list

List all active tasks with summary information.

**Args:** None

**Returns:** Array of task summaries with id, subject, status, owner, blockedBy. Excludes completed and deleted tasks. The blockedBy field is filtered to only include unresolved (non-completed) blockers.

**Example:**
```typescript
task_list() // Returns all active tasks
```

**Response includes reminder:** "1 task = 1 task. Maximize parallel execution by running independent tasks (tasks with empty blockedBy) concurrently."

### task_get

Retrieve a full task object by ID.

**Args:**
| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `id` | string | Yes | Task ID (format: T-{uuid}) |

**Example:**
```typescript
task_get({ id: "T-2a200c59-1a36-4dad-a9c3-3064d180f694" })
```

**Returns:** `{ task: TaskObject | null }` with all fields: id, subject, description, status, activeForm, blocks, blockedBy, owner, metadata, repoURL, parentID, threadID.

### task_update

Update an existing task with new values. Supports additive updates for dependencies.

**Args:**
| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `id` | string | Yes | Task ID to update |
| `subject` | string | No | New subject |
| `description` | string | No | New description |
| `status` | "pending" \| "in_progress" \| "completed" \| "deleted" | No | Task status |
| `activeForm` | string | No | Active form (present continuous) |
| `owner` | string | No | Task owner (agent name) |
| `addBlocks` | string[] | No | Task IDs to add to blocks (additive) |
| `addBlockedBy` | string[] | No | Task IDs to add to blockedBy (additive) |
| `metadata` | Record<string, unknown> | No | Metadata to merge (set key to null to delete) |

**Example:**
```typescript
task_update({
  id: "T-2a200c59-1a36-4dad-a9c3-3064d180f694",
  status: "completed"
})

// Add dependencies
task_update({
  id: "T-2a200c59-1a36-4dad-a9c3-3064d180f694",
  addBlockedBy: ["T-other-task"]
})
```

**Returns:** `{ task: TaskObject }` with full updated task.

**Dependency Management:** Use `addBlockedBy` to declare dependencies on other tasks. Properly managed dependencies enable maximum parallel execution.

## DELEGATION SYSTEM (native subagent)

8 built-in categories: `construct`, `source`, `rabbit-hole`, `glitch`, `bullet-time`, `blue-pill`, `the-one`, `transmission`

Each category defines: model, variant, temperature, max tokens, thinking/reasoning config, prompt append, stability flag.

### Per-Task Complexity Routing (v2.0.0+)

The `subagent` policy accepts an optional `complexity: 1-5 | "auto"` field. When set, the resolver may downgrade the model to a cheaper tier per category (downgrade-only, never upgrade). `auto` scores the task from description/prompt/skills. Omitting the field disables downgrades.

Files: `src/shared/subagent/complexity-{types,constants,scorer}.ts` + `skill-resolver.ts`. Tests: `tests/shared/subagent/complexity-scorer.test.ts` and `complexity-constants.test.ts`.


## HOW TO ADD

1. Create `src/tools/[name]/` with index.ts, tools.ts, types.ts, constants.ts (some dirs legitimately differ — e.g. `session-cleanup/` is index-only)
2. Static tools → `builtinTools` export, Factory → separate export
3. Register in `src/plugin/tool/tool-catalog.ts`

## NAMING

- **Tool names**: snake_case (`lsp_goto_definition`)
- **Functions**: camelCase (`createDelegateTask`)
- **Directories**: kebab-case (`task-notepad-writer/`)
