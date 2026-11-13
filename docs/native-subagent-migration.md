# Native Subagent Migration Notes

Matrixx delegates through the native `subagent(...)` tool. The legacy
`task(...)` / `delegate_task` calling convention was removed; calling
it now reaches a guard stub that redirects to `subagent` (see Final architecture).

## Syntax map (old → new)

| Old (legacy) | New (native) |
|---|---|
| `task(category="source", ...)` | `subagent(agent="mouse-source", ...)` — same for `construct`, `rabbit-hole`, `glitch`, `bullet-time`, `blue-pill`, `the-one`, `transmission` |
| `task(subagent_type="oracle", ...)` | `subagent(agent="oracle", ...)` — same for `trinity`, `operator`, `sentinel`, `niobe` (see note) |
| `session_id` (subagent input key) | `sessionID` |
| `.task_id` (result handle) | `.sessionID` |
| `background_output(task_id="...")` | `session_read(session_id="...")` |
| `background_wait_all(...)` | Not a fan-in replacement: absorb each child's completion message. `subagent_control(action="wait", session_id="<child-session-id>")` only gates one child |
| `background_cancel(...)` | `subagent_control(action="cancel", session_id="<child-session-id>")` |

`load_skills=[...]` and `complexity=N` stay as keys: the matrixx
subagent-policy transformer consumes them (skill content is prepended,
`complexity` may downgrade the model) and strips them before execution.
Never inline skill content yourself.

`subagent(agent="niobe")` is rejected by design — Niobe only runs via
`/start-work`. Plan-file creation still routes to `oracle`.

## Spawn semantics

```typescript
subagent(agent="mouse-source", description="Implement login", prompt="...")
```

- `agent` (required): which agent runs the work.
- `description`: short 3–5 word title for progress display.
- `prompt`: full instructions — subagents are stateless, include all context.
- Every child is async. The rendezvous sequence is **Fire → Absorb →
  Fetch → Gate**:
  1. **Fire.** `subagent(...)` returns a `sessionID` immediately.
  2. **Absorb.** The host injects the child's completion message into this
     session when the child goes idle; that message is the default rendezvous.
  3. **Fetch.** `session_read(session_id=...)` only when the completion body
     is truncated/empty or the full transcript is needed — at most once per
     child, never in a loop.
  4. **Gate.** `subagent_control(action="wait", session_id=..., timeout=...)`
     only when the next action consumes that child's output (the
     bounded shape is specified under Final architecture below).
- `sessionID`: resume/continue an existing child (see below).
- `model`: optional override (downgrade-only via `complexity`).

## Removed affordances

- The `background` argument and its legacy alias no longer exist;
  `applySubagentPolicy` strips both if supplied.

## Output retrieval

1. Read the auto-injected completion message (the default rendezvous for
   every child).
2. `session_read(session_id="<child-session-id>")` — full child transcript.
3. `session_search` / `session_info` — find or inspect child sessions.

## Continue an existing child

```typescript
subagent(agent="<original-agent>", sessionID="<child-session-id>", prompt="<follow-up>")
```

Continuation requires all three: the same `agent`, the child `sessionID`,
and the follow-up `prompt`.

## Cancel / wait

Via the `subagent_control` tool:

```typescript
subagent_control(action="cancel", session_id="<child-session-id>")
subagent_control(action="wait", session_id="<child-session-id>", timeout=120000)
```

`timeout` defaults to 60s, max 600s.

## Depth limit

Nested delegation is capped. Set in `opencode.jsonc`:

```jsonc
{
  "experimental": {
    "subagent_depth": 3
  }
}
```

- This is a **top-level `experimental` key, not a matrixx key**; restart
  OpenCode after changing it.
- Why 3: the orchestrator spawns a worker, and matrixx workers (`mouse-*`) may
  spawn their own children for parallel exploration or sub-tasks. Three
  levels cover orchestrator, worker, and grandchild; deeper nesting is
  denied with a depth-limit error.
- Matrixx cannot set this programmatically (the V2 plugin API has no
  config writer) — users must set it themselves.

## Final architecture (no dual path)

There is no coexistence path anymore. The final shape is:

- **Native `subagent`** for all delegation: `subagent(agent=...,
  sessionID? for continuation, load_skills?, complexity?)`.
- **`subagent_policy` transformer** (`src/plugin/tool/subagent-policy/`): consumes
  the extra `load_skills` and `complexity` args on native subagent calls,
  prepends skill content, and rewrites the model downgrade-only for
  `mouse-*` workers. It strips both keys before execution, so OpenCode
  never sees them.
- **`subagent_control`** for running children: `action=cancel|wait` with
  `session_id` plus `timeout` (default 60s, max 600s). `action="wait"` is a
  bounded gate (one `session_id`, explicit `timeout`), not a collection
  mechanism; follow it with at most one `session_read`.
- **`session_read` / `session_search` / `session_info`** for output retrieval:
  each completion injects a synthetic message into the
  parent session; read the full child transcript from there.
- **Removed-tools guard stubs** (`src/tools/removed-tools/`): `task`,
  `background_output`, `background_cancel`, `background_revive`, and
  `background_wait_all` are deleted and replaced by guards whose message
  points at the native equivalents above.
- **`task_*` tracking is unchanged**: `task_create` / `task_update` /
  `task_list` / `task_get` / `task_cleanup` remain the file-backed progress
  record layer (see `docs/task-system.md`). Tracking and delegation are
  separate tools: record with `task_*`, delegate with `subagent`.

## Child restrictions

The 8 `mouse-*` worker agents
(`mouse-construct/source/rabbit-hole/glitch/bullet-time/blue-pill/the-one/transmission`)
carry a `subagent: false` tool restriction (`src/shared/tool/agent-tool-restrictions.ts`):
they track work through `task_*` and cannot spawn subagents. The
`<Nested_Delegation>` prompt block (`src/agents/definitions/mouse-subagents.ts`)
states the same rule to the worker: it is a depth-1 child and must complete
the work itself. Only the orchestrator fans out.
