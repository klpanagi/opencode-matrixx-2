import { describe, expect, test } from "bun:test"

const PLUGIN_HOOKS = `${import.meta.dir}/../../src/plugin/hooks`
const SETUP_DOMAINS = `${import.meta.dir}/../../src/plugin/setup-domains.ts`

async function hookCallOrder(file: string, callee: string): Promise<string[]> {
  //#given
  const source = await Bun.file(file).text()

  //#when
  const pattern = new RegExp(`${callee}\\(\\s*"([^"]+)"`, "g")
  const names: string[] = []
  for (const match of source.matchAll(pattern)) {
    names.push(match[1])
  }

  //#then
  return names
}

describe("hook registration order golden", () => {
  test("session hooks keep injection order", async () => {
    //#given
    const expected = [
      "context-window-monitor",
      "session-recovery",
      "session-notification",
      "think-mode",
      "context-window-limit-recovery",
      "auto-update-checker",
      "agent-usage-reminder",
      "non-interactive-env",
      "interactive-bash-session",
      "matrix-loop",
      "edit-error-recovery",
      "delegate-task-retry",
      "start-work",
      "oracle-md-only",
      "mouse-notepad",
      "anthropic-effort",
      "runtime-fallback",
      "rtk-bash-rewriter",
      "session-memory",
    ]

    //#when
    const actual = await hookCallOrder(`${PLUGIN_HOOKS}/create-session-hooks.ts`, "safeHook")

    //#then
    expect(actual).toEqual(expected)
  })

  test("continuation hooks keep injection order", async () => {
    //#given
    const expected = [
      "stop-continuation-guard",
      "compaction-context-injector",
      "task-continuation-enforcer",
      "unstable-agent-babysitter",
      "nudge-loop-breaker",
      "background-notification",
      "niobe",
      "plan-persister",
      "evolution-hitl",
    ]

    //#when
    const actual = await hookCallOrder(
      `${PLUGIN_HOOKS}/create-continuation-hooks.ts`,
      "safeHook",
    )

    //#then
    expect(actual).toEqual(expected)
  })

  test("tool-guard hooks keep injection order", async () => {
    //#given
    const expected = [
      "background-task-blocker",
      "comment-checker",
      "tool-output-truncator",
      "directory-agents-injector",
      "empty-task-response-detector",
      "rules-injector",
      "write-existing-file-guard",
      "silent-failure-guard",
      "hashline-read-enhancer",
      "secret-leak-guard",
      "env-file-write-guard",
      "json-error-recovery",
      "bash-file-read-guard",
      "context-mode-enforcer",
      "read-image-resizer",
      "webfetch-redirect-guard",
      "quality-gate",
      "task-edit-guard",
      "subagent-block",
      "software-dev-enforcement",
      "task-notepad-writer",
      "document-reader-guard",
      "docs-lookup-guard",
      "knowledge-hub-guard",
      "knowledge-hub-search-nudge",
      "evolution-watcher",
    ]

    //#when
    const actual = await hookCallOrder(
      `${PLUGIN_HOOKS}/create-tool-guard-hooks.ts`,
      "safeHook",
    )

    //#then
    expect(actual).toEqual(expected)
  })

  test("skill hooks keep injection order", async () => {
    //#given
    const expected = ["category-skill-reminder", "auto-slash-command"]

    //#when
    const actual = await hookCallOrder(`${PLUGIN_HOOKS}/create-skill-hooks.ts`, "safeHook")

    //#then
    expect(actual).toEqual(expected)
  })

  test("transform hooks keep injection order", async () => {
    //#given
    const expected = [
      "input-secret-guard",
      "keyword-detector",
      "domain-keyword-detector",
      "knowledge-hub-injector",
      "env-context-injector",
      "thinking-block-validator",
      "tool-pair-validator",
      "dcp-nudge-sanitizer",
      "design-intent-preserver",
    ]

    //#when
    const actual = await hookCallOrder(
      `${PLUGIN_HOOKS}/create-transform-hooks.ts`,
      "safeCreateHook",
    )

    //#then
    expect(actual).toEqual(expected)
  })

  test("composition root keeps domain creation and merge order", async () => {
    //#given
    const source = await Bun.file(SETUP_DOMAINS).text()

    //#when
    const created: string[] = []
    for (const match of source.matchAll(/create(Session|ToolGuard|Transform|Continuation|Skill)Hooks\(/g)) {
      created.push(match[1])
    }
    const merged: string[] = []
    for (const match of source.matchAll(/\.\.\.(session|toolGuard|transform|continuation|skill),/g)) {
      merged.push(match[1])
    }

    //#then
    expect(created).toEqual(["Session", "ToolGuard", "Transform", "Continuation", "Skill"])
    expect(merged).toEqual(["session", "toolGuard", "transform", "continuation", "skill"])
  })
})
