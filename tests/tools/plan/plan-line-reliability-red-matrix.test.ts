/// <reference types="bun-types" />
/**
 * Plan-tool reliability RED matrix (plan item 3) - 7 failure categories.
 *
 * SCOPE: reproduction ONLY. This file MUST NOT fix source. Each category targets
 * the plan-tool sources under src/tools/plan/ (NOT src/plugin-handlers/):
 * section-edit.ts, section-locate.ts, plan-update.ts, plan-write-guard.ts,
 * plus the hashline-edit remap path (validation.ts / hashline-edit-executor.ts).
 *
 * LABELS:
 * - BASELINE-OK: current behavior already matches the contract. The test passes
 *   and records the verbatim payload for the matrix.
 * - RED: asserts the T5-forgiveness TARGET (cats 1-4: stale auto-refresh payload
 *   with expectedHash+actualHash+retryEdit; header-label alias label-wins;
 *   top-level tl-dr folding; better hints - error codes stay distinct). The test
 *   FAILS against current behavior; the failure plus the logged ACTUAL payload
 *   is the reproduction evidence.
 *
 * CONVENTIONS: temp-dir plan files only (never real .matrixx/plans); relative
 * ../../../src imports; BDD //#given //#when //#then comments. No mock.module().
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { serializePlanFrontMatter } from "../../../src/features/plan-contract"
import { PLAN_ERROR_CODES } from "../../../src/tools/plan/error-codes"
import { buildSectionIndex } from "../../../src/tools/plan/section-index"
import { createPlanReadTool } from "../../../src/tools/plan/plan-read"
import { createPlanUpdateTool } from "../../../src/tools/plan/plan-update"
import {
  TRIM_REQUIRED_AFTER_CONSECUTIVE_REFUSALS,
  enforcePlanCap,
  resetPlanWriteGuardForTesting,
} from "../../../src/tools/plan/plan-write-guard"

const TEST_ABORT = new AbortController()
const PLAN_REL = ".matrixx/plans/red-matrix.md"

function testContext(testDir: string) {
  return {
    sessionID: "test-session-red-matrix",
    messageID: "test-message-red-matrix",
    agent: "test-agent",
    abort: TEST_ABORT.signal,
    directory: testDir,
  }
}

function makePlanDir(): string {
  const dir = join(tmpdir(), `red-matrix-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(join(dir, ".matrixx/plans"), { recursive: true })
  return dir
}

function planFile(testDir: string): string {
  return join(testDir, PLAN_REL)
}

function buildMatrixPlan(): string {
  const body = [
    "# Red Matrix Fixture",
    "",
    "## TL;DR",
    "Tldr marker line.",
    "",
    "## Execution Strategy",
    "Strategy body one.",
    "Strategy body two.",
    "",
    "## TODOs",
    "- [ ] 1. first task",
    "- [ ] 2. second task",
    "",
    "## Commit Strategy",
    "Merge commit only.",
    "",
  ].join("\n")
  return `${serializePlanFrontMatter({ status: "pending", revision: 1 })}${body}`
}

function corruptHashChar(hash: string): string {
  const first = hash[0] === "Z" ? "P" : "Z"
  return `${first}${hash.slice(1)}`
}

describe("plan-tool reliability RED matrix - 7 categories", () => {
  let testDir: string
  let ctx: ReturnType<typeof testContext>
  const updateTool = createPlanUpdateTool()
  const readTool = createPlanReadTool()

  beforeEach(() => {
    testDir = makePlanDir()
    ctx = testContext(testDir)
    writeFileSync(planFile(testDir), buildMatrixPlan(), "utf-8")
  })

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
  })

  test("cat1 BASELINE-OK: stale contentHash -> section_stale with expectedHash+actualHash+hint", async () => {
    //#given a plan_read contentHash for the todos section
    const before = readFileSync(planFile(testDir), "utf-8")
    const stale = buildSectionIndex(before).find((e) => e.id === "todos")?.contentHash as string
    //#when a concurrent edit lands in that section before our write
    writeFileSync(
      planFile(testDir),
      before.replace("- [ ] 2. second task", "- [ ] 2. second task\n- [ ] 9. concurrent edit"),
      "utf-8",
    )
    const actual = buildSectionIndex(readFileSync(planFile(testDir), "utf-8")).find((e) => e.id === "todos")
      ?.contentHash as string
    expect(actual).not.toBe(stale)
    //#when we write with the stale hash (src/tools/plan/section-edit.ts:85-96)
    const raw = await updateTool.execute(
      { filePath: PLAN_REL, edits: [{ op: "append", section: "todos", contentHash: stale, lines: ["- [ ] 3. stale probe"] }] },
      ctx as never,
    )
    const res = JSON.parse(raw as string)
    console.log(`CAT1 section_stale ACTUAL: ${raw}`)
    //#then refused closed with both hashes and the re-read hint; nothing applied
    expect(res.error).toBe(PLAN_ERROR_CODES.sectionStale)
    expect(res.selector).toBe("todos")
    expect(res.expectedHash).toBe(stale)
    expect(res.actualHash).toBe(actual)
    expect(String(res.hint)).toContain("Re-read the section")
    expect(readFileSync(planFile(testDir), "utf-8")).not.toContain("stale probe")
  })

  test("cat1 RED: T5 stale auto-refresh payload carries retryEdit with the fresh hash", async () => {
    //#given a stale hash as above
    const before = readFileSync(planFile(testDir), "utf-8")
    const stale = buildSectionIndex(before).find((e) => e.id === "todos")?.contentHash as string
    writeFileSync(
      planFile(testDir),
      before.replace("- [ ] 2. second task", "- [ ] 2. second task\n- [ ] 9. concurrent edit"),
      "utf-8",
    )
    //#when the stale write is refused
    const raw = await updateTool.execute(
      { filePath: PLAN_REL, edits: [{ op: "append", section: "todos", contentHash: stale, lines: ["- [ ] 3. stale probe"] }] },
      ctx as never,
    )
    const res = JSON.parse(raw as string)
    console.log(`CAT1-RETRY ACTUAL (no retryEdit yet): ${raw}`)
    //#then TARGET (T5 forgiveness): the refusal carries a ready-to-retry edit with the fresh contentHash, error code stays section_stale
    expect(res.error).toBe(PLAN_ERROR_CODES.sectionStale)
    expect(res).toHaveProperty("retryEdit")
  })

  test("cat2 BASELINE-OK: renamed/deleted section -> section_not_found listing availableSections", async () => {
    //#when we write to a section id no heading in this plan has (src/tools/plan/section-locate.ts:54-58)
    const raw = await updateTool.execute(
      { filePath: PLAN_REL, edits: [{ op: "append", section: "deleted-section", lines: ["orphan line"] }] },
      ctx as never,
    )
    const res = JSON.parse(raw as string)
    console.log(`CAT2 section_not_found ACTUAL: ${raw}`)
    //#then fail-closed with the file's own ids; nothing applied
    expect(res.error).toBe(PLAN_ERROR_CODES.sectionNotFound)
    expect(String(res.message)).toContain("Available sections:")
    expect(res.availableSections).toContain("todos")
    expect(res.availableSections).toContain("tl-dr")
    expect(readFileSync(planFile(testDir), "utf-8")).not.toContain("orphan line")
  })

  test("cat2 RED: T5 better hints - section_not_found carries a hint", async () => {
    //#when the same renamed-section write is refused
    const raw = await updateTool.execute(
      { filePath: PLAN_REL, edits: [{ op: "append", section: "deleted-section", lines: ["orphan line"] }] },
      ctx as never,
    )
    const res = JSON.parse(raw as string)
    console.log(`CAT2-HINT ACTUAL (no hint yet): ${raw}`)
    //#then TARGET (T5 forgiveness): a hint names the remedy, error code stays section_not_found
    expect(res.error).toBe(PLAN_ERROR_CODES.sectionNotFound)
    expect(res).toHaveProperty("hint")
  })

  test("cat3 BASELINE-OK: top-level section/contentHash misplacement -> validation_error", async () => {
    //#when section/contentHash sit at the TOP level of the args (src/tools/plan/plan-update.ts:85-88)
    const raw = await updateTool.execute(
      { filePath: PLAN_REL, section: "todos", contentHash: "deadbeefdeadbeef", edits: [{ op: "append", lines: ["- [ ] misplaced"] }] },
      ctx as never,
    )
    const res = JSON.parse(raw as string)
    console.log(`CAT3 validation_error ACTUAL: ${raw}`)
    //#then refused before any file read/edit, naming the correct shape
    expect(res.error).toBe(PLAN_ERROR_CODES.validationError)
    expect(String(res.message)).toContain("must be supplied INSIDE an edit object in edits[]")
    expect(readFileSync(planFile(testDir), "utf-8")).not.toContain("misplaced")
  })

  test("cat3 RED: T5 top-level tl-dr folding - top-level section folds into section-less edits", async () => {
    //#given a top-level section naming a REAL section with section-less edits
    //#when submitted (TARGET T5 forgiveness: folded into each edit instead of refused)
    const raw = await updateTool.execute(
      { filePath: PLAN_REL, section: "tl-dr", edits: [{ op: "append", lines: ["folded line"] }] },
      ctx as never,
    )
    const res = JSON.parse(raw as string)
    console.log(`CAT3-FOLD ACTUAL (still refused): ${raw}`)
    //#then TARGET: the write succeeds via folding; CURRENT: validation_error -> RED
    expect(res.error).toBeUndefined()
    expect(res.success).toBe(true)
  })

  test("cat4 BASELINE-OK: heading-text selector resolves like its registry id", async () => {
    //#when the same section is addressed by heading text vs kebab id
    const byLabel = JSON.parse((await readTool.execute({ filePath: PLAN_REL, section: "TODOs" }, ctx as never)) as string)
    const byId = JSON.parse((await readTool.execute({ filePath: PLAN_REL, section: "todos" }, ctx as never)) as string)
    console.log(`CAT4 heading-text ACTUAL id=${byLabel.section?.id} startLine=${byLabel.section?.startLine}`)
    //#then both resolve to the same span
    expect(byLabel.error).toBeUndefined()
    expect(byId.error).toBeUndefined()
    expect(byLabel.section?.id).toBe("todos")
    expect(byLabel.section?.startLine).toBe(byId.section?.startLine)
  })

  test("cat4 RED: T5 header-label alias label-wins - 'tldr' resolves to the tl-dr section", async () => {
    //#when the TL;DR section is addressed by its joined label alias (no dash)
    const raw = (await readTool.execute({ filePath: PLAN_REL, section: "tldr" }, ctx as never)) as string
    const res = JSON.parse(raw)
    console.log(`CAT4-ALIAS ACTUAL (miss today): ${raw}`)
    //#then TARGET (T5 label-wins): resolves to tl-dr; CURRENT: section_not_found -> RED
    expect(res.error).toBeUndefined()
    expect(res.section?.id).toBe("tl-dr")
  })

  test("cat5 BASELINE: preamble selector is not a section - capture actual code verbatim", async () => {
    //#when the preamble (bytes before the first H2/H3 - NOT a section) is selected
    const readRaw = (await readTool.execute({ filePath: PLAN_REL, section: "preamble" }, ctx as never)) as string
    const updateRaw = (await updateTool.execute(
      { filePath: PLAN_REL, edits: [{ op: "append", section: "preamble", lines: ["preamble line"] }] },
      ctx as never,
    )) as string
    console.log(`CAT5 read preamble ACTUAL: ${readRaw}`)
    console.log(`CAT5 update preamble ACTUAL: ${updateRaw}`)
    //#then both fail closed (codes captured verbatim above for the matrix)
    expect(JSON.parse(readRaw).error).toBeDefined()
    expect(JSON.parse(updateRaw).error).toBeDefined()
  })

  test("cat5 RED: T5 preamble selector failure is validation_error", async () => {
    //#when the preamble is selected on read
    const readRaw = (await readTool.execute({ filePath: PLAN_REL, section: "preamble" }, ctx as never)) as string
    const res = JSON.parse(readRaw)
    console.log(`CAT5-TARGET ACTUAL: ${readRaw}`)
    //#then TARGET: a dedicated preamble validation_error (preamble is addressable-but-not-a-section); CURRENT: section_not_found -> RED
    expect(res.error).toBe(PLAN_ERROR_CODES.validationError)
  })

  test("cat6 BASELINE-OK: stale anchor after content remap -> 'Error: hash mismatch - ...'", async () => {
    //#given a fresh hashline anchor for a TODOs line
    const readRaw = (await readTool.execute({ filePath: PLAN_REL, format: "hashline" }, ctx as never)) as string
    const hashline = (JSON.parse(readRaw) as { hashline: string }).hashline
    const row = hashline.split("\n").find((l) => l.includes("1. first task")) as string
    const anchor = row.split("|")[0] as string
    //#when content remaps above the target (line shifts) and the old hash is reused
    const shifted = readFileSync(planFile(testDir), "utf-8").replace(
      "Strategy body one.",
      "Strategy body one.\nInserted line that remaps every later anchor.",
    )
    writeFileSync(planFile(testDir), shifted, "utf-8")
    const lineNo = anchor.split("#")[0] as string
    const hash = anchor.split("#")[1] as string
    const staleAnchor = `${lineNo}#${corruptHashChar(hash)}`
    //#when the stale anchor is used (executor maps at hashline-edit-executor.ts:162-164)
    const result = (await updateTool.execute(
      { filePath: PLAN_REL, edits: [{ op: "replace", pos: staleAnchor, lines: ["- [ ] 1. first task EDITED"] }] },
      ctx as never,
    )) as string
    console.log(`CAT6 hash-mismatch ACTUAL (truncated): ${result.slice(0, 900)}`)
    //#then the HashlineMismatchError formatMessage payload (validation.ts:92/:194, :126-149)
    expect(result.startsWith("Error: hash mismatch - ")).toBe(true)
    expect(result).toContain("changed since last read")
    expect(result).toContain("Tip: reuse LINE#ID")
  })

  test("cat7 BASELINE-OK: size_exceeded first refusals escalate to trim_required; shrinking write resets", () => {
    //#given the guard chain (src/tools/plan/plan-write-guard.ts:67-79)
    resetPlanWriteGuardForTesting()
    const cap = 500
    const resolved = join(tmpdir(), `red-matrix-guard-${Date.now()}-${Math.random().toString(36).slice(2)}.md`)
    const original = "x".repeat(cap - 100)
    const applied = `${original}${"y".repeat(200)}`
    //#when the same growing write is refused past the consecutive-refusal threshold
    const codes: string[] = []
    const payloads: string[] = []
    for (let i = 0; i < TRIM_REQUIRED_AFTER_CONSECUTIVE_REFUSALS + 1; i++) {
      const verdict = enforcePlanCap(resolved, original, applied, cap)
      if (verdict.kind !== "rolled-back") throw new Error("expected a refusal")
      payloads.push(verdict.payload)
      codes.push((JSON.parse(verdict.payload) as { error: string }).error)
    }
    const lastPayload = payloads[payloads.length - 1] as string
    console.log(`CAT7 refusal-1 ACTUAL: ${payloads[0]}`)
    console.log(`CAT7 trim_required ACTUAL: ${lastPayload}`)
    //#then early refusals stay size_exceeded and the escalation carries trim diagnostics
    expect(codes[0]).toBe(PLAN_ERROR_CODES.sizeExceeded)
    expect(codes[codes.length - 1]).toBe(PLAN_ERROR_CODES.trimRequired)
    const parsed = JSON.parse(lastPayload) as Record<string, unknown>
    expect(parsed.actual).toBe(applied.length)
    expect(parsed.cap).toBe(cap)
    expect(parsed.overBy).toBe(applied.length - cap)
    expect(typeof parsed.headroom).toBe("number")
    expect(String(parsed.hint).toLowerCase()).toContain("trim")
    //#when a write shrinks the content it is still accepted past the threshold
    const stillOverButSmaller = `${"x".repeat(cap - 100)}${"y".repeat(150)}`
    expect(stillOverButSmaller.length).toBeLessThan(applied.length)
    const shrinkVerdict = enforcePlanCap(resolved, applied, stillOverButSmaller, cap)
    expect(shrinkVerdict.kind).toBe("keep")
    if (existsSync(resolved)) rmSync(resolved, { force: true })
  })
})

