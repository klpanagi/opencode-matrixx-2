import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createCommentCheckerHooks } from "../../../src/hooks/comment-checker/hook"

const SESSION_ID = "ses_patch_scan_test"
const fixtureRoot = join(process.cwd(), ".matrixx")
mkdirSync(fixtureRoot, { recursive: true })
// The hook confines patch reads to process.cwd(), so fixtures live inside it.
const directory = mkdtempSync(join(fixtureRoot, "comment-patch-"))
let callCounter = 0

afterAll(() => {
  rmSync(directory, { recursive: true, force: true })
})

function nextCallID(): string {
  callCounter += 1
  return `call_patch_${callCounter}`
}

function writeFixture(name: string, content: string): string {
  const path = join(directory, name)
  writeFileSync(path, content)
  return path
}

async function runAfterPatch(metadata: unknown, text = "ok") {
  const hooks = createCommentCheckerHooks()
  const output = { title: "ok", output: text, metadata }
  await hooks["tool.execute.after"](
    { tool: "patch", sessionID: SESSION_ID, callID: nextCallID() },
    output,
  )
  return output
}

describe("comment-checker V2 patch metadata", () => {
  test("appends the report when a patch hunk adds a comment", async () => {
    //#given a V2 patch whose hunk adds the comment line
    const file = writeFixture("added.ts", "// added the helper\nexport const value = 1\n")
    const metadata = {
      files: [
        {
          file,
          patch: "@@ -0,0 +1,2 @@\n+// added the helper\n+export const value = 1",
          status: "modified",
          additions: 2,
          deletions: 0,
        },
      ],
    }

    //#when the patch after hook runs
    const output = await runAfterPatch(metadata)

    //#then the added comment is reported without the predates annotation
    expect(output.output).toContain("COMMENT/DOCSTRING DETECTED")
    expect(output.output).toContain("added the helper")
    expect(output.output).not.toContain("may predate the patch")
  })

  test("reports a comment the diff labels as context with the predates annotation", async () => {
    //#given a consistent diff that lists a real comment as context and adds no comment
    const file = writeFixture("reformat.ts", "// added the helper\nexport const value = 2\n")
    const metadata = {
      files: [
        {
          file,
          patch: "@@ -1,2 +1,2 @@\n // added the helper\n export const value = 2",
          status: "modified",
          additions: 0,
          deletions: 0,
        },
      ],
    }

    //#when the patch after hook runs
    const output = await runAfterPatch(metadata)

    //#then the whole file is reported and the outside-range finding is labelled
    expect(output.output).toContain("COMMENT/DOCSTRING DETECTED")
    expect(output.output).toContain("added the helper")
    expect(output.output).toContain("1 finding(s) in this file may predate the patch.")
  })

  test("skips files whose patch status is deleted", async () => {
    //#given a deleted file that still exists on disk with a comment
    const file = writeFixture("deleted.ts", "// added the helper\nexport const value = 1\n")
    const metadata = {
      files: [{ file, patch: "@@ -1,2 +0,0 @@\n-// added the helper\n-export const value = 1", status: "deleted" }],
    }

    //#when the patch after hook runs
    const output = await runAfterPatch(metadata)

    //#then the deletion is not scanned
    expect(output.output).toBe("ok")
  })

  test("falls back to the whole file when the patch string is unparsable", async () => {
    //#given a patch string that is not a unified diff
    const file = writeFixture("unparsable.ts", "// added the helper\nexport const value = 1\n")
    const metadata = { files: [{ file, patch: "not a unified diff", status: "modified" }] }

    //#when the patch after hook runs
    const output = await runAfterPatch(metadata)

    //#then the whole file is scanned, the hook does not throw, and nothing is annotated
    expect(output.output).toContain("COMMENT/DOCSTRING DETECTED")
    expect(output.output).toContain("added the helper")
    expect(output.output).not.toContain("may predate the patch")
  })
})
