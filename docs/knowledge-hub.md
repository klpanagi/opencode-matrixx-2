# Knowledge Hub

> **Audience:** users with an external knowledge corpus and engineers configuring `knowledge` hubs.
> **See also:** `configurations.md` (the `knowledge` key), `hooks.md` §2.3 (`knowledge-hub-guard`, `knowledge-hub-search-nudge`).

External knowledge-base routing with a best-effort write guard. Declare one or more hubs in config; agents consult the router index before answering domain questions and read single files on demand, never bulk-read the corpus. No source changes required.

## AGENTS.md pointer (zero-code setup)

Workers get KB routing today by pointing at the router index. No files under `src/` are touched, and nothing under `<your-knowledge-dir>/` is modified.

### Router format

`<your-knowledge-dir>/_index.md` is the single entry point. Its
`## Reference Documents` section is a routing table with columns:

`| File | Content | When to consult |`

Each row maps a KB file to a summary of its content and the task domain that
should trigger reading it. Consult the index first, then read single files on
demand — never bulk-read the corpus.

### Copy-paste AGENTS.md snippet

Add this line to `AGENTS.md` (or project instructions) for immediate routing:

```markdown
Consult <your-knowledge-dir>/_index.md as router before answering domain questions; read single files on demand, never bulk.
```

### Symlink alternative (optional)

If a relative path is preferred, link the KB into the repo root (link only,
never copy):

```bash
ln -s <your-knowledge-dir> ./knowledge-hub
```

Then the pointer becomes `knowledge-hub/_index.md`. The symlink is convenience
only; the canonical path remains `<your-knowledge-dir>/_index.md`.

### Rules

- KB is treated as read-only: no modification, no commits to KB files. Source
  corpus files stay untouched. The guard enforces this best-effort (see
  Guard behavior below); paths matching a hub's `exclude` list stay writable.
- Router-only discipline: always check `_index.md` first; open only the rows
  whose `When to consult` column matches the task.
- Frontmatter is optional; no metadata changes required.
- Secrets: `_index.md` may reference secret-bearing files (for example `api_access/.env_service_one` and
  `api_access/.env_service_two`) by filename only — never print or commit their contents.

### Verification

```bash
cat docs/knowledge-hub.md
git status --porcelain src/
ls <your-knowledge-dir>/_index.md
```

Expected: pointer line visible in the doc, `git status --porcelain src/` empty
(no source files changed), and the index file exists.

## Configuration

Declare hubs in `matrixx.jsonc` (project `.opencode/matrixx.jsonc` or user
`~/.config/opencode/matrixx.jsonc`) under the `knowledge` key:

```jsonc
{
  // ...
  "knowledge": {
    "hubs": [
      {
        "name": "kb",
        "path": "<your-knowledge-dir>",
        "index": "_index.md",
        "scope": "global",
        "mode": "router-only"
      },
      {
        "name": "project-kb",
        "path": "./docs/kb",
        "index": "_index.md",
        "scope": "project",
        "mode": "pinned",
        "exclude": ["scratch/**"]
      }
    ]
  }
}
```

### Fields

| Field | Required | Default | Meaning |
|---|---|---|---|
| `name` | yes | — | Hub handle; appears in the injected payload tags (`knowledge-hub name=...`, `knowledge-hub-pin name=...`) |
| `path` | yes | — | Hub root. `~`/`~/` expand to home, `$VAR`/`${VAR}` from env, relative paths resolve against the project dir. A path referencing an unset env variable is skipped (one warning) |
| `index` | no | `_index.md` | Router file injected by the native `context` session hook, truncated to 6000 tokens per hub |
| `scope` | no | `global` | `global` (shared KB) or `project` (repo-local) |
| `mode` | no | `router-only` | `router-only` injects the index only; `pinned` additionally injects configured pinned files |
| `exclude` | no | `[]` | Extra picomatch patterns merged over `DEFAULT_KNOWLEDGE_EXCLUDES` (`*.docx`, `*.pptx`, `*.zip`, `node_modules/**`). This is a write allowlist: matched paths stay writable. The defaults no longer cover dotfiles, so hidden files are guarded like everything else |
| `pinnedFiles` | no | `[]` | Hub-relative (or absolute) files injected only when `mode` is `pinned` and the list is non-empty |

### Delivery

Injection is native and event-driven. `knowledge-hub-injector` registers on
the `context` session hook (`ctx.session.hook("context", ...)`) and, once per
session, registers the router payload with the shared context collector, so
the index lands as a synthetic part before the first reasoning step, no
`read` call required.

Registration is gated twice: `knowledge-hub-injector` must not appear in
`disabled_hooks`, and at least one hub must be configured. The gate counts
configured hubs, it does not stat the disk, so an index that appears later
still routes.

The payload is one directive line followed by tagged blocks:

```text
<knowledge-hub name="kb" root="/abs/hub/root" index="/abs/hub/root/_index.md">...</knowledge-hub>
<knowledge-hub-pin name="kb" file="/abs/hub/root/notes.md">...</knowledge-hub-pin>
```

- Each hub contributes a `knowledge-hub` block carrying absolute `root=` and
  `index=` paths. Files are resolved by absolute path under the hub root on
  demand; there is no path-alias resolver of any kind.
- A hub with a missing index file is skipped (`indexPresent: false`), not
  dropped: the block re-appears once the index exists.
- Pinned blocks are emitted only when the hub's `mode` is `pinned` and
  `pinnedFiles` is non-empty.
- Blocks are deduped per session. The per-session cache is cleared by
  event handlers on `session.compacted` and `session.deleted`, so the router
  re-injects after compaction or session deletion.
- Budgets: 6000 tokens per hub index, 12000 tokens across all hubs. When the
  aggregate cap is hit, a single marker line
  (`[knowledge-hub: aggregate cap reached, remaining hub content omitted]`)
  is appended. Note that the shared context collector applies its own
  delivery caps at consumption time (per-entry and merged character limits,
  see `src/features/context-injection/injector/collector.ts`), which bound
  what actually reaches the message.
- Empty `knowledge` config fails open: nothing is registered. A hub whose
  `path` references an unset environment variable is skipped with a single
  warning; the loader's `expandHubPath`, called directly, still expands a
  missing variable to an empty string.

### Guard behavior (best-effort, not a security boundary)

`knowledge-hub-guard` (`tool.execute.before`) is a best-effort write fence.
It is explicitly not a security boundary. It covers:

- Write-shaped tools: `write`, `edit`, `multiedit`, `ast_grep_replace`, and
  `lsp_rename`, including the `rename` destination of `edit`.
- Bash, through a small lexer that tracks `cd`, treats in-command variable
  assignments as prefixes, resolves `>`/`>>` redirection targets, and parses
  destructive verbs (`rm`, `mv`, `ln`, `tee`, `truncate`, `chmod`, `touch`, ...),
  destination-only verbs (`cp`, `rsync`), `dd of=`, `find -delete`, `sed -i`,
  `git -C`, and interpreter one-liners (`sh`/`bash`/`node`/`bun`/`python`/`python3`/`perl`
  with `-c`/`-e`), nested up to two levels.

Writes inside a hub root are denied unless the target matches the hub
`exclude` list. That list is a write allowlist: matched paths stay writable.
Reads are never blocked, paths outside all hub roots are never blocked, and
a missing `knowledge` config fails open (writes allowed, one warning logged).

Named residual bypasses (the analysis is heuristic, not exhaustive):

- commands that take a shell cwd argument other than `git -C` (for example `tar -C`)
- in-command env assignments that smuggle paths past env expansion
- `eval` or other obfuscation
- `&>` and heredocs
- `find -exec` and `xargs`
- symlink traversal
- unquoted globbing
- non-coreutils binaries that perform writes

### Confirm flow (user-approved writes)

The deny error names the hub and the blocked path, then instructs the agent:

1. Ask the user via the question tool for confirmation.
2. If the user approves, call `knowledge_hub_confirm` with the path, then
   retry the blocked write.

The confirm tool refuses a `sessionID` that does not match the active
session, a path outside every configured hub root, and a target that does
not exist. Approvals are session-scoped, in-memory only, exact-path (a
directory approval does not cover its children), and expire after 10
minutes. Without a recorded approval the guard keeps denying. Never bypass
the guard without asking the user first.

### Verification

```bash
bun test tests/hooks/knowledge-hub-guard tests/plugin/message-hooks/e2e-injection.test.ts
rg knowledge-hub-injector src/plugin/message-hooks/
```

### Search nudge (web-first backstop)

`knowledge-hub-search-nudge` (`tool.execute.before`) warns — never blocks —
whenever an agent reaches for `websearch`/`webfetch`: it sets
`output.message` naming the registered hub(s) with the shared
router directive (absolute `root=`-based routing) on one line (<300 chars, no
secrets). Silent when no hubs are configured (fail-open) or for
unrelated tools. The native `context`-hook delivery already puts the router
in context; this nudge is the backstop for
agents that habitually reach for web first.
