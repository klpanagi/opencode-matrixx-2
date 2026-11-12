# SHARED UTILITIES KNOWLEDGE BASE

## OVERVIEW

~128 cross-cutting utilities across 12 scoped domains + 5 legacy subdirs. Import via scope barrel (e.g. `import { log } from "../../shared/runtime"`) or the root barrel.

## STRUCTURE

12 scoped domains + 5 legacy subdirs. Import via scope barrel (`../../shared/<scope>`) or the root barrel:

```
shared/
├── index.ts                      # Root barrel (explicit named re-exports)
├── command-executor.ts           # Loose legacy entry (see command-executor/ scope)
├── agent/                        # Agent variant, display names, labels (6 files)
├── compaction/                   # Compaction log, model resolver, context limits (8 files)
├── config/                       # Data paths, deep-merge, opencode dirs, version (9 files)
├── io/                           # File utils, frontmatter, shell-env, zip, ports (9 files)
├── migration/                    # Legacy config migration (legacy subdir; agent/hook/model names)
├── model/                        # Model resolution pipeline, requirements, retry (8 files)
├── opencode/                     # HTTP API, server auth, plugin detector (6 files)
├── policy/                       # Context-mode enforcement, DCP, RTK, injection (8 files)
├── runtime/                      # Logger, notify, abort-error + helpers (8 files)
├── session/                      # Session utils, cursor, ephemeral sessions (15 files)
├── subagent/                     # Delegation policy: complexity, depth cap, skill resolver, task titles (12 files)
├── text/                         # jsonc-parser, system-directive, formatting (8 files)
├── tool/                         # define-tool, merge-categories + helpers (7 files)
├── command-executor/             # Shell execution (legacy subdir, 3 files)
├── git-worktree/                 # Git status/diff parsing (legacy subdir, 5 files)
├── software-dev-enforcement/     # Software-dev gating helpers (legacy subdir, 3 files)
└── tmux/                         # Tmux TUI integration (legacy subdir, 3 files)
```

 scope rule: new cross-cutting code goes in the matching scoped dir
 (`agent/`, `compaction/`, `config/`, `io/`, `model/`, `opencode/`,
 `policy/`, `runtime/`, `session/`, `subagent/`, `text/`, `tool/`); the 5 legacy subdirs
 (`command-executor/`, `git-worktree/`, `migration/`, `software-dev-enforcement/`,
 `tmux/`, plus loose `command-executor.ts`) stay where they are for import stability.

## MOST IMPORTED

| Utility | Imports | Purpose |
|---------|---------|---------|
| logger.ts | 62 | Background task visibility |
| data-path.ts | 11 | XDG storage resolution |
| model-requirements.ts | 11 | Agent fallback chains |
| system-directive.ts | 11 | System message filtering |
| frontmatter.ts | 10 | YAML metadata extraction |
| permission-compat.ts | 9 | Tool restrictions |
| file-utils.ts | 9 | File operations |
| dynamic-truncator.ts | 7 | Token-aware truncation |

## KEY PATTERNS

**3-Step Model Resolution** (Override → Fallback → Default):
1. **Override**: UI-selected or user-configured model
2. **Fallback**: Provider/model chain with availability checking
3. **Default**: System fallback when no matches found

**System Directive Filtering**:
```typescript
if (isSystemDirective(message)) return  // Skip system-generated
const directive = createSystemDirective("TASK CONTINUATION") // was TODO CONTINUATION pre-v2.5
```

## ANTI-PATTERNS

- **Raw JSON.parse**: Use `jsonc-parser.ts` for comment support
- **Hardcoded paths**: Use `opencode-config-dir.ts` or `data-path.ts`
- **console.log**: Use `logger.ts` for background task visibility
- **Unbounded output**: Use `dynamic-truncator.ts` to prevent overflow
- **Manual version check**: Use `opencode-version.ts` for semver safety
