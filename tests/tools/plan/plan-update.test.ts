/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parsePlanFrontMatter } from "../../../src/features/plan-contract"
import { MAX_PLAN_FILE_BYTES } from "../../../src/tools/plan/constants"
import { createPlanCreateTool } from "../../../src/tools/plan/plan-create"
import { createPlanReadTool } from "../../../src/tools/plan/plan-read"
import { createPlanUpdateTool } from "../../../src/tools/plan/plan-update"

const TEST_ABORT = new AbortController()

function testContext(testDir: string): ToolContext {
  return {
    sessionID: "test-session-plan-update",
    messageID: "test-message-plan-update",
    agent: "test-agent",
    abort: TEST_ABORT.signal,
    directory: testDir,
  } as unknown as ToolContext
}

function planPath(dir: string, fileName: string): string {
  return join(dir, ".matrixx/plans", fileName)
}

/** Count leading `---` fences; a single front-matter block renders exactly two. */
function frontMatterFences(content: string): number {
  return (content.match(/^---$/gm) ?? []).length
}

describe("plan_update contract validation + write guards", () => {
  let testDir: string
  let ctx: ToolContext
  let createTool: ReturnType<typeof createPlanCreateTool>
  let readTool: ReturnType<typeof createPlanReadTool>
  let updateTool: ReturnType<typeof createPlanUpdateTool>

  beforeEach(() => {
    testDir = join(tmpdir(), `plan-update-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(join(testDir, ".matrixx/plans"), { recursive: true })
    ctx = testContext(testDir)
    createTool = createPlanCreateTool()
    readTool = createPlanReadTool()
    updateTool = createPlanUpdateTool()
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  /** Resolve the LINE#ID anchor for the first hashline row containing `needle`. */
  async function anchorFor(fileName: string, needle: string): Promise<string> {
    const read = JSON.parse(await readTool.execute({ filePath: `.matrixx/plans/${fileName}` }, ctx))
    const row = (read.hashline as string).split("\n").find((line) => line.includes(needle))
    if (!row) throw new Error(`no hashline row contains: ${needle}`)
    return row.split("|")[0] as string
  }

  test("surfaces contract warnings after a valid edit (WARN-first, non-blocking)", async () => {
    //#given a plan whose first line is a canonical section heading
    const content = ["## TL;DR", "summary", "", "## Context", "", "- [ ] 1. Do thing", ""].join("\n")
    await createTool.execute({ filePath: ".matrixx/plans/warn-plan.md", content }, ctx)
    const anchor = await anchorFor("warn-plan.md", "## TL;DR")

    //#when the canonical heading is replaced with a plain line
    const res = JSON.parse(
      await updateTool.execute(
        { filePath: ".matrixx/plans/warn-plan.md", edits: [{ op: "replace", pos: anchor, lines: ["TLDR removed"] }] },
        ctx,
      ),
    )

    //#then the edit still succeeds and the drift is reported as a warning
    expect(res.success).toBe(true)
    expect(res.error).toBeUndefined()
    expect(Array.isArray(res.warnings)).toBe(true)
    const missing = (res.warnings as Array<{ code: string; message: string }>).find((w) => w.code === "missing_section")
    expect(missing).toBeDefined()
    expect(missing?.message).toContain("TL;DR")
    //#and the edit is persisted
    expect(readFileSync(planPath(testDir, "warn-plan.md"), "utf-8")).toContain("TLDR removed")
  })

  test("rejects an oversize edit with size_exceeded and leaves the file unchanged", async () => {
    //#given a small plan and its exact pre-edit bytes
    await createTool.execute({ filePath: ".matrixx/plans/cap-plan.md", content: "# Title\nline2\n" }, ctx)
    const target = planPath(testDir, "cap-plan.md")
    const before = readFileSync(target, "utf-8")
    const beforeSize = statSync(target).size
    const anchor = await anchorFor("cap-plan.md", "# Title")

    //#when an edit appends more than the hard cap
    const res = JSON.parse(
      await updateTool.execute(
        {
          filePath: ".matrixx/plans/cap-plan.md",
          edits: [{ op: "append", pos: anchor, lines: ["x".repeat(MAX_PLAN_FILE_BYTES + 100)] }],
        },
        ctx,
      ),
    )

    //#then a hard rejection with a split hint, and nothing was persisted
    expect(res.error).toBe("size_exceeded")
    expect(res.message).toMatch(/split the plan/i)
    expect(typeof res.hint).toBe("string")
    expect(res.hint.length).toBeGreaterThan(0)
    expect(readFileSync(target, "utf-8")).toBe(before)
    expect(statSync(target).size).toBe(beforeSize)
  })

  test("enforces the byte cap for multibyte content (char count under cap, byte count over)", async () => {
    //#given a small plan and its exact pre-edit bytes
    await createTool.execute({ filePath: ".matrixx/plans/byte-cap-plan.md", content: "# Title\nline2\n" }, ctx)
    const target = planPath(testDir, "byte-cap-plan.md")
    const before = readFileSync(target, "utf-8")
    const beforeSize = statSync(target).size
    const anchor = await anchorFor("byte-cap-plan.md", "# Title")

    //#when an edit appends a 3-byte-per-char run under the cap in chars but over it in bytes
    const multibyte = "€".repeat(Math.ceil((MAX_PLAN_FILE_BYTES + 500) / 3))
    const res = JSON.parse(
      await updateTool.execute(
        { filePath: ".matrixx/plans/byte-cap-plan.md", edits: [{ op: "append", pos: anchor, lines: [multibyte] }] },
        ctx,
      ),
    )

    //#then the byte cap still rejects it and the file is left unchanged
    expect(res.error).toBe("size_exceeded")
    expect(readFileSync(target, "utf-8")).toBe(before)
    expect(statSync(target).size).toBe(beforeSize)
  })

  test("injects front-matter once on the first edit and not again (idempotent)", async () => {
    //#given a plan without front-matter
    await createTool.execute({ filePath: ".matrixx/plans/fm-plan.md", content: "# Title\nline2\nline3\n" }, ctx)
    const target = planPath(testDir, "fm-plan.md")
    expect(parsePlanFrontMatter(readFileSync(target, "utf-8"))).toBeNull()

    //#when the first edit lands
    const firstAnchor = await anchorFor("fm-plan.md", "# Title")
    const first = JSON.parse(
      await updateTool.execute(
        { filePath: ".matrixx/plans/fm-plan.md", edits: [{ op: "replace", pos: firstAnchor, lines: ["# First Edit"] }] },
        ctx,
      ),
    )

    //#then front-matter is present exactly once
    expect(first.success).toBe(true)
    expect(first.frontMatterInjected).toBe(true)
    const afterFirst = readFileSync(target, "utf-8")
    expect(parsePlanFrontMatter(afterFirst)?.status).toBe("pending")
    expect(frontMatterFences(afterFirst)).toBe(2)

    //#when a second edit lands (anchor re-read after the front-matter shift)
    const secondAnchor = await anchorFor("fm-plan.md", "# First Edit")
    const second = JSON.parse(
      await updateTool.execute(
        { filePath: ".matrixx/plans/fm-plan.md", edits: [{ op: "replace", pos: secondAnchor, lines: ["# Second Edit"] }] },
        ctx,
      ),
    )

    //#then no duplicate front-matter block is added
    expect(second.success).toBe(true)
    expect(second.frontMatterInjected).toBe(false)
    const afterSecond = readFileSync(target, "utf-8")
    expect(frontMatterFences(afterSecond)).toBe(2)
    expect(afterSecond).toContain("# Second Edit")
  })
})


describe("plan_update status-transition enforcement", () => {
  let testDir2: string
  let ctx2: ToolContext
  let createTool2: ReturnType<typeof createPlanCreateTool>
  let readTool2: ReturnType<typeof createPlanReadTool>
  let updateTool2: ReturnType<typeof createPlanUpdateTool>

  beforeEach(() => {
    testDir2 = join(tmpdir(), `plan-status-gate-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(join(testDir2, ".matrixx/plans"), { recursive: true })
    ctx2 = testContext(testDir2)
    createTool2 = createPlanCreateTool()
    readTool2 = createPlanReadTool()
    updateTool2 = createPlanUpdateTool()
  })

  afterEach(() => {
    if (existsSync(testDir2)) {
      rmSync(testDir2, { recursive: true, force: true })
    }
  })

  function statusPlan(status: string, body = "- [ ] 1. Do the thing"): string {
    return `---\nstatus: ${status}\nrevision: 1\n---\n# Plan\n\n${body}\n`
  }

  async function statusAnchor2(fileName: string): Promise<string> {
    const read = JSON.parse(await readTool2.execute({ filePath: `.matrixx/plans/${fileName}` }, ctx2))
    const row = (read.hashline as string).split("\n").find((line: string) => line.includes("status:"))
    if (!row) throw new Error("no status row in hashline")
    return row.split("|")[0] as string
  }

  async function bodyAnchor2(fileName: string, needle: string): Promise<string> {
    const read = JSON.parse(await readTool2.execute({ filePath: `.matrixx/plans/${fileName}` }, ctx2))
    const row = (read.hashline as string).split("\n").find((line: string) => line.includes(needle))
    if (!row) throw new Error(`no hashline row contains: ${needle}`)
    return row.split("|")[0] as string
  }

  test("forward status edit succeeds", async () => {
    //#given a pending plan
    await createTool2.execute({ filePath: ".matrixx/plans/forward-plan.md", content: statusPlan("pending") }, ctx2)
    const anchor = await statusAnchor2("forward-plan.md")

    //#when the status advances forward to in_progress
    const res = JSON.parse(
      await updateTool2.execute(
        { filePath: ".matrixx/plans/forward-plan.md", edits: [{ op: "replace", pos: anchor, lines: ["status: in_progress"] }] },
        ctx2,
      ),
    )

    //#then the write succeeds and the new status is persisted
    expect(res.success).toBe(true)
    expect(res.error).toBeUndefined()
    expect(parsePlanFrontMatter(readFileSync(planPath(testDir2, "forward-plan.md"), "utf-8"))?.status).toBe("in_progress")
  })

  test("backward status edit without flag is rejected", async () => {
    //#given a completed plan
    await createTool2.execute({ filePath: ".matrixx/plans/back-plan.md", content: statusPlan("completed", "- [x] 1. Done") }, ctx2)
    const anchor = await statusAnchor2("back-plan.md")

    //#when a backward jump to pending is attempted without forceCompletion
    const res = JSON.parse(
      await updateTool2.execute(
        { filePath: ".matrixx/plans/back-plan.md", edits: [{ op: "replace", pos: anchor, lines: ["status: pending"] }] },
        ctx2,
      ),
    )

    //#then the write is refused with status_transition_rejected naming from/to
    expect(res.error).toBe("status_transition_rejected")
    expect(res.from).toBe("completed")
    expect(res.to).toBe("pending")
    expect(res.message).toContain("completed")
    expect(res.message).toContain("pending")
    expect(typeof res.hint).toBe("string")
  })

  test("non-status edit is unaffected", async () => {
    //#given a completed plan
    await createTool2.execute({ filePath: ".matrixx/plans/body-plan.md", content: statusPlan("completed", "- [x] 1. Done\n\nNotes here") }, ctx2)
    const anchor = await bodyAnchor2("body-plan.md", "Notes here")

    //#when only the body text changes
    const res = JSON.parse(
      await updateTool2.execute(
        { filePath: ".matrixx/plans/body-plan.md", edits: [{ op: "replace", pos: anchor, lines: ["Notes updated"] }] },
        ctx2,
      ),
    )

    //#then the edit still succeeds
    expect(res.success).toBe(true)
    expect(readFileSync(planPath(testDir2, "body-plan.md"), "utf-8")).toContain("Notes updated")
  })

  test("completed status with unchecked boxes still succeeds (advisory only)", async () => {
    //#given a pending plan with unchecked boxes
    await createTool2.execute({ filePath: ".matrixx/plans/mismatch-plan.md", content: statusPlan("pending", "- [ ] 1. Open work") }, ctx2)
    const anchor = await statusAnchor2("mismatch-plan.md")

    //#when the status jumps forward to completed while boxes stay open
    const res = JSON.parse(
      await updateTool2.execute(
        { filePath: ".matrixx/plans/mismatch-plan.md", edits: [{ op: "replace", pos: anchor, lines: ["status: completed"] }] },
        ctx2,
      ),
    )

    //#then the write stays allowed (advisory only, never a block)
    expect(res.success).toBe(true)
    expect(res.error).toBeUndefined()
    expect(parsePlanFrontMatter(readFileSync(planPath(testDir2, "mismatch-plan.md"), "utf-8"))?.status).toBe("completed")
  })

  test("file with no front-matter plus completed edit is allowed", async () => {
    //#given a plan file without front-matter
    await createTool2.execute({ filePath: ".matrixx/plans/nofm-plan.md", content: "# Title\nline2\n" }, ctx2)

    //#when an edit prepends a completed front-matter block (pending -> completed)
    const res = JSON.parse(
      await updateTool2.execute(
        { filePath: ".matrixx/plans/nofm-plan.md", edits: [{ op: "prepend", lines: ["---", "status: completed", "revision: 1", "---"] }] },
        ctx2,
      ),
    )

    //#then the write is allowed as the forward pending -> completed path
    expect(res.success).toBe(true)
    expect(res.error).toBeUndefined()
  })

  test("rejected backward jump leaves file byte-identical", async () => {
    //#given a completed plan and its exact pre-edit bytes
    await createTool2.execute({ filePath: ".matrixx/plans/identical-plan.md", content: statusPlan("completed", "- [x] 1. Done") }, ctx2)
    const target = planPath(testDir2, "identical-plan.md")
    const before = readFileSync(target, "utf-8")
    const anchor = await statusAnchor2("identical-plan.md")

    //#when an injected backward jump to in_progress is attempted without the flag
    const res = JSON.parse(
      await updateTool2.execute(
        { filePath: ".matrixx/plans/identical-plan.md", edits: [{ op: "replace", pos: anchor, lines: ["status: in_progress"] }] },
        ctx2,
      ),
    )

    //#then the write is refused and the file bytes are unchanged
    expect(res.error).toBe("status_transition_rejected")
    expect(readFileSync(target, "utf-8")).toBe(before)
  })

  test("backward jump with absent flag is rejected (explicit)", async () => {
    //#given a completed plan
    await createTool2.execute({ filePath: ".matrixx/plans/absent-flag-plan.md", content: statusPlan("completed", "- [x] 1. Done") }, ctx2)
    const anchor = await statusAnchor2("absent-flag-plan.md")

    //#when a backward jump is attempted with no forceCompletion key at all
    const res = JSON.parse(
      await updateTool2.execute(
        { filePath: ".matrixx/plans/absent-flag-plan.md", edits: [{ op: "replace", pos: anchor, lines: ["status: pending"] }] },
        ctx2,
      ),
    )

    //#then the gate still rejects
    expect(res.error).toBe("status_transition_rejected")
    expect(res.from).toBe("completed")
    expect(res.to).toBe("pending")
  })

  test("backward jump with forceCompletion:false is still rejected", async () => {
    //#given a completed plan
    await createTool2.execute({ filePath: ".matrixx/plans/false-flag-plan.md", content: statusPlan("completed", "- [x] 1. Done") }, ctx2)
    const anchor = await statusAnchor2("false-flag-plan.md")

    //#when a backward jump is attempted with forceCompletion:false
    const res = JSON.parse(
      await updateTool2.execute(
        {
          filePath: ".matrixx/plans/false-flag-plan.md",
          edits: [{ op: "replace", pos: anchor, lines: ["status: pending"] }],
          forceCompletion: false,
        },
        ctx2,
      ),
    )

    //#then the gate still rejects
    expect(res.error).toBe("status_transition_rejected")
    expect(res.from).toBe("completed")
    expect(res.to).toBe("pending")
  })

  test("backward jump with forceCompletion:true succeeds end-to-end", async () => {
    //#given a completed plan
    await createTool2.execute({ filePath: ".matrixx/plans/true-flag-plan.md", content: statusPlan("completed", "- [x] 1. Done") }, ctx2)
    const anchor = await statusAnchor2("true-flag-plan.md")

    //#when a backward jump is attempted with forceCompletion:true
    const res = JSON.parse(
      await updateTool2.execute(
        {
          filePath: ".matrixx/plans/true-flag-plan.md",
          edits: [{ op: "replace", pos: anchor, lines: ["status: pending"] }],
          forceCompletion: true,
        },
        ctx2,
      ),
    )

    //#then the override is honored and the new status persists
    expect(res.success).toBe(true)
    expect(res.error).toBeUndefined()
    expect(parsePlanFrontMatter(readFileSync(planPath(testDir2, "true-flag-plan.md"), "utf-8"))?.status).toBe("pending")
  })
})