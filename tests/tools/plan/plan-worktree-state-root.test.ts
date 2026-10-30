/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { MatrixxContext } from "../../../src/plugin/context"
import { createPlanListTool } from "../../../src/tools/plan/plan-list"
import { createPlanReadTool } from "../../../src/tools/plan/plan-read"
import { createPlanUpdateTool } from "../../../src/tools/plan/plan-update"
import { createTaskList } from "../../../src/tools/task/task-list"

const TEST_ABORT = new AbortController()
const PLAN_NAME = "worktree-state-root-plan.md"

function castMatrixxContext(value: { directory: string; worktree?: string }): MatrixxContext {
  return value as unknown as MatrixxContext
}

function toolContext(directory: string) {
  return {
    sessionID: "test-session-worktree-state-root",
    messageID: "test-message-worktree-state-root",
    agent: "test-agent",
    abort: TEST_ABORT.signal,
    directory,
  }
}

function seedLinkedWorktree(dir: string): void {
  writeFileSync(join(dir, ".git"), "gitdir: /nowhere/.git/worktrees/wt\n", "utf-8")
}

describe("plan and task tools resolve state under the project canonical root", () => {
  let projectRoot: string
  let worktreeDir: string

  beforeEach(() => {
    projectRoot = join(tmpdir(), `sr-plan-root-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    worktreeDir = join(tmpdir(), `sr-plan-wt-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(join(projectRoot, ".matrixx", "plans"), { recursive: true })
    writeFileSync(join(projectRoot, ".matrixx", "plans", PLAN_NAME), "# Plan\n\n- [ ] one\n", "utf-8")
    mkdirSync(worktreeDir, { recursive: true })
    seedLinkedWorktree(worktreeDir)
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
    rmSync(worktreeDir, { recursive: true, force: true })
  })

  //#given a session moved into a linked worktree while the plan lives in the project root
  //#when plan_read is called with the relative plan path
  //#then the plan is read from the project root instead of reporting file_not_found
  test("plan_read reads the plan from the canonical root", async () => {
    const pluginCtx = castMatrixxContext({ directory: worktreeDir, worktree: projectRoot })
    const tool = createPlanReadTool(pluginCtx)

    const raw = await tool.execute({ filePath: `.matrixx/plans/${PLAN_NAME}` }, toolContext(worktreeDir))
    const result = JSON.parse(String(raw))

    expect(result.error).toBeUndefined()
    expect(String(raw)).toContain("# Plan")
  })

  //#given a session moved into a linked worktree
  //#when plan_read is called with the absolute project-root plan path
  //#then the path is accepted rather than rejected as invalid_file_path
  test("plan_read accepts an absolute canonical plan path", async () => {
    const pluginCtx = castMatrixxContext({ directory: worktreeDir, worktree: projectRoot })
    const tool = createPlanReadTool(pluginCtx)

    const raw = await tool.execute(
      { filePath: join(projectRoot, ".matrixx", "plans", PLAN_NAME) },
      toolContext(worktreeDir),
    )
    const result = JSON.parse(String(raw))

    expect(result.error).toBeUndefined()
  })

  //#given a session moved into a linked worktree
  //#when plan_list runs
  //#then it lists the canonical root's plans, not the empty worktree
  test("plan_list lists canonical plans", async () => {
    const pluginCtx = castMatrixxContext({ directory: worktreeDir, worktree: projectRoot })
    const tool = createPlanListTool(pluginCtx)

    const raw = String(await tool.execute({}, toolContext(worktreeDir)))

    expect(raw).toContain(PLAN_NAME)
  })

  //#given a session moved into a linked worktree
  //#when plan_update marks a line complete
  //#then the canonical plan file is the one mutated
  test("plan_update mutates the canonical plan", async () => {
    const pluginCtx = castMatrixxContext({ directory: worktreeDir, worktree: projectRoot })
    const readTool = createPlanReadTool(pluginCtx)
    const updateTool = createPlanUpdateTool(pluginCtx)

    const readPayload = JSON.parse(
      String(await readTool.execute({ filePath: `.matrixx/plans/${PLAN_NAME}` }, toolContext(worktreeDir))),
    ) as { hashline?: string }
    const anchorMatch = (readPayload.hashline ?? "").match(/^(\d+#[A-Z]{4})\|- \[ \] one$/m)
    expect(anchorMatch).not.toBeNull()
    const anchor = anchorMatch?.[1] ?? ""

    const updateRaw = String(
      await updateTool.execute(
        { filePath: `.matrixx/plans/${PLAN_NAME}`, edits: [{ op: "replace", pos: anchor, lines: ["- [x] one"] }] },
        toolContext(worktreeDir),
      ),
    )
    expect(updateRaw).not.toContain("file_not_found")
  })

  //#given a session moved into a linked worktree
  //#when task_list runs against tasks stored in the canonical root
  //#then the canonical tasks are visible
  test("task_list reads tasks from the canonical root", async () => {
    const tasksDir = join(projectRoot, ".matrixx", "tasks")
    mkdirSync(tasksDir, { recursive: true })
    writeFileSync(
      join(tasksDir, "T-11111111-1111-1111-1111-111111111111.json"),
      JSON.stringify({
        id: "T-11111111-1111-1111-1111-111111111111",
        subject: "canonical task",
        description: "state-root visibility",
        status: "pending",
        threadID: "test-thread",
        blockedBy: [],
        blocks: [],
      }),
      "utf-8",
    )

    const pluginCtx = castMatrixxContext({ directory: worktreeDir, worktree: projectRoot })
    const tool = createTaskList({}, pluginCtx)

    const raw = String(await tool.execute({}, toolContext(worktreeDir)))

    expect(raw).toContain("canonical task")
  })
})
