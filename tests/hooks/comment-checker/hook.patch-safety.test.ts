import { afterAll, describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { createCommentCheckerHooks } from "../../../src/hooks/comment-checker/hook"

const SESSION_ID = "ses_patch_safety_test"
const fixtureRoot = join(process.cwd(), ".matrixx")
mkdirSync(fixtureRoot, { recursive: true })
const directory = mkdtempSync(join(fixtureRoot, "comment-patch-safety-"))
const outsideRoot = mkdtempSync(join(tmpdir(), "comment-patch-outside-"))
let callCounter = 0

afterAll(() => {
  rmSync(directory, { recursive: true, force: true })
  rmSync(outsideRoot, { recursive: true, force: true })
})

function nextCallID(): string {
  callCounter += 1
  return `call_safety_${callCounter}`
}

function writeFixture(name: string, content: string): string {
  const path = join(directory, name)
  writeFileSync(path, content)
  return path
}

const ADDED_HUNK = "@@ -0,0 +1,2 @@\n+// added the helper\n+export const value = 1"

async function runPatch(file: string, patch: string, status = "modified") {
  const hooks = createCommentCheckerHooks()
  const output = {
    title: "Patch",
    output: "ok",
    metadata: { files: [{ file, patch, status, additions: 2, deletions: 0 }] },
  }
  const started = Date.now()
  await hooks["tool.execute.after"](
    { tool: "patch", sessionID: SESSION_ID, callID: nextCallID() },
    output,
  )
  return { output, elapsedMs: Date.now() - started }
}

describe("comment-checker patch read confinement", () => {
  test("skips a path outside the working root", async () => {
    //#given a comment-bearing file outside the hook root
    const outside = join(outsideRoot, "outside.ts")
    writeFileSync(outside, "// added the helper\nexport const value = 1\n")

    //#when the patch metadata points at it
    const { output } = await runPatch(outside, ADDED_HUNK)

    //#then the file is skipped without a report
    expect(output.output).toBe("ok")
  })

  test("skips a relative path that escapes the working root", async () => {
    //#given a comment-bearing file reached through ../
    const outside = join(outsideRoot, "escape.ts")
    writeFileSync(outside, "// added the helper\nexport const value = 1\n")
    const escaping = relative(process.cwd(), outside)

    //#when the patch metadata points at it
    const { output } = await runPatch(escaping, ADDED_HUNK)

    //#then the escape is refused
    expect(output.output).toBe("ok")
  })

  test("skips a symlink inside the root", async () => {
    //#given a symlink inside the root pointing at an outside comment file
    const outside = join(outsideRoot, "target.ts")
    writeFileSync(outside, "// added the helper\nexport const value = 1\n")
    const link = join(directory, "link.ts")
    symlinkSync(outside, link)

    //#when the patch metadata points at the symlink
    const { output } = await runPatch(link, ADDED_HUNK)

    //#then the symlink itself is refused
    expect(output.output).toBe("ok")
  })

  test("skips a path through a symlinked directory", async () => {
    //#given a directory symlink inside the root that points outside it
    const outside = join(outsideRoot, "linked", "secret.ts")
    mkdirSync(dirname(outside), { recursive: true })
    writeFileSync(outside, "// added the helper\nexport const value = 1\n")
    const linkDir = join(directory, "linkdir")
    symlinkSync(outsideRoot, linkDir)

    //#when the patch metadata points through the symlinked directory
    const { output } = await runPatch(join(linkDir, "linked", "secret.ts"), ADDED_HUNK)

    //#then the canonical path is outside the root and the file is skipped
    expect(output.output).toBe("ok")
  })

  test("skips /dev/zero without reading it", async () => {
    //#given patch metadata pointing at a character device
    const { output, elapsedMs } = await runPatch("/dev/zero", ADDED_HUNK)

    //#then nothing is read or reported, and the call returns quickly
    expect(output.output).toBe("ok")
    expect(elapsedMs).toBeLessThan(100)
  })

  test("skips a FIFO without blocking", async () => {
    //#given a named pipe inside the root
    const fifo = join(directory, "pipe.ts")
    const made = Bun.spawnSync(["mkfifo", fifo])
    if (made.exitCode !== 0) return

    //#when the patch metadata points at it
    const { output, elapsedMs } = await runPatch(fifo, ADDED_HUNK)

    //#then the pipe is refused instead of blocking the hook
    expect(output.output).toBe("ok")
    expect(elapsedMs).toBeLessThan(100)
  })

  test("skips a file above the size cap", async () => {
    //#given a comment-bearing regex-tier file larger than the scan cap
    const filler = "SELECT 1;\n".repeat(260_000)
    const file = writeFixture("large.sql", `-- added the helper\n${filler}`)

    //#when the patch metadata points at it
    const { output } = await runPatch(file, "@@ -0,0 +1,2 @@\n+-- added the helper\n+SELECT 1;")

    //#then the oversized file is skipped
    expect(output.output).toBe("ok")
  })

  test("scans a normal in-tree file", async () => {
    //#given an in-tree file and an added hunk
    const file = writeFixture("normal.ts", "// added the helper\nexport const value = 1\n")

    //#when the patch metadata points at it
    const { output } = await runPatch(file, ADDED_HUNK)

    //#then the advisory is appended
    expect(output.output).toContain("COMMENT/DOCSTRING DETECTED")
  })
})

describe("comment-checker patch diff validation", () => {
  test("falls back to the whole file when hunk counts do not match", async () => {
    //#given a hunk that claims three new lines but supplies two
    const file = writeFixture("ambiguous.ts", "// added the helper\nexport const value = 1\n")
    const patch = "@@ -10,3 +10,3 @@\n+export const a = 1\n+export const b = 2"

    //#when the patch metadata points at it
    const { output } = await runPatch(file, patch)

    //#then the whole file is scanned and the comment is still reported
    expect(output.output).toContain("COMMENT/DOCSTRING DETECTED")
  })

  test("counts a blank context line so later ranges stay aligned", async () => {
    //#given a hunk with a blank context line before the added comment
    const file = writeFixture(
      "blank-line.ts",
      "// added the helper\n\n// added the new helper\nexport const value = 1\n",
    )
    const patch = "@@ -1,2 +1,3 @@\n // added the helper\n\n+// added the new helper"

    //#when the patch metadata points at it
    const { output } = await runPatch(file, patch)

    //#then the added comment is found on its real new-file line
    expect(output.output).toContain("added the new helper")
  })
})

describe("comment-checker patch debug redaction", () => {
  test("does not log patch bodies", () => {
    //#given a debug-enabled child process logging a patch tool call
    const logRoot = mkdtempSync(join(fixtureRoot, "comment-patch-log-"))
    const marker = "SECRET_DIFF_MARKER_9f3c"
    const hookPath = join(process.cwd(), "src/hooks/comment-checker/hook.ts")
    const script = `
const { createCommentCheckerHooks } = await import("file://${hookPath}")
const hooks = createCommentCheckerHooks()
await hooks["tool.execute.before"](
  { tool: "patch", sessionID: "ses_debug", callID: "call_debug" },
  { args: { files: [{ file: "x.ts", patch: "${marker}" }] } },
)
process.exit(0)
`

    //#when the child runs with debug logging pointed at a temp directory
    const child = Bun.spawnSync([process.execPath, "-e", script], {
      cwd: process.cwd(),
      env: { ...process.env, COMMENT_CHECKER_DEBUG: "1", TMPDIR: logRoot },
    })
    const logPath = join(logRoot, "comment-checker-debug.log")

    //#then the run succeeds and the patch body never reaches the log
    expect(child.exitCode).toBe(0)
    const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : ""
    expect(log).not.toContain(marker)
  })
})
