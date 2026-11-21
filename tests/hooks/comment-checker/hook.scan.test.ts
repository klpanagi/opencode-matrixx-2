import { afterEach, describe, expect, test } from "bun:test"
import {
  _setCommentScanSourcesForTesting,
  createCommentCheckerHooks,
} from "../../../src/hooks/comment-checker/hook"
import { scanSources } from "../../../src/shared/comment-scan"
import { SgUnavailableError } from "../../../src/shared/comment-scan/sg-invoke"

const SESSION_ID = "ses_scan_test"
let callCounter = 0

afterEach(() => {
  _setCommentScanSourcesForTesting(null)
})

function nextCallID(): string {
  callCounter += 1
  return `call_scan_${callCounter}`
}

function resultOutput(text = "ok") {
  return { title: "ok", output: text, metadata: undefined as unknown }
}

describe("comment-checker in-process scan", () => {
  test("appends the report when a write adds an AI-slop comment", async () => {
    //#given a write with an AI-slop comment
    const hooks = createCommentCheckerHooks()
    const callID = nextCallID()
    await hooks["tool.execute.before"](
      { tool: "write", sessionID: SESSION_ID, callID },
      { args: { filePath: "/repo/queries/report.sql", content: "-- added the helper\nSELECT 1;\n" } },
    )
    const output = resultOutput()

    //#when the after hook runs
    await hooks["tool.execute.after"]({ tool: "write", sessionID: SESSION_ID, callID }, output)

    //#then the finding is appended
    expect(output.output).toContain("COMMENT/DOCSTRING DETECTED")
    expect(output.output).toContain("added the helper")
  })

  test("appends nothing when a write has no comments", async () => {
    //#given a write without comments
    const hooks = createCommentCheckerHooks()
    const callID = nextCallID()
    await hooks["tool.execute.before"](
      { tool: "write", sessionID: SESSION_ID, callID },
      { args: { filePath: "/repo/queries/report.sql", content: "SELECT 1;\n" } },
    )
    const output = resultOutput()

    //#when the after hook runs
    await hooks["tool.execute.after"]({ tool: "write", sessionID: SESSION_ID, callID }, output)

    //#then the output is untouched
    expect(output.output).toBe("ok")
  })

  test("appends nothing when an edit only carries pre-existing comments", async () => {
    //#given an edit whose old and new text share a comment
    const hooks = createCommentCheckerHooks()
    const callID = nextCallID()
    const oldString = "-- added the helper\nSELECT 1;\n"
    const newString = "-- added the helper\nSELECT 1;\nSELECT 2;\n"
    await hooks["tool.execute.before"](
      { tool: "edit", sessionID: SESSION_ID, callID },
      { args: { filePath: "/repo/queries/report.sql", oldString, newString } },
    )
    const output = resultOutput()

    //#when the after hook runs
    await hooks["tool.execute.after"]({ tool: "edit", sessionID: SESSION_ID, callID }, output)

    //#then the pre-existing comment is not reported
    expect(output.output).toBe("ok")
  })

  test("appends the report when an edit adds a comment", async () => {
    //#given an edit that introduces a comment
    const hooks = createCommentCheckerHooks()
    const callID = nextCallID()
    await hooks["tool.execute.before"](
      { tool: "edit", sessionID: SESSION_ID, callID },
      {
        args: {
          filePath: "/repo/queries/report.sql",
          oldString: "SELECT 1;\n",
          newString: "-- added the helper\nSELECT 1;\n",
        },
      },
    )
    const output = resultOutput()

    //#when the after hook runs
    await hooks["tool.execute.after"]({ tool: "edit", sessionID: SESSION_ID, callID }, output)

    //#then the new comment is reported
    expect(output.output).toContain("COMMENT/DOCSTRING DETECTED")
    expect(output.output).toContain("added the helper")
  })

  test("reports both concurrent edits instead of dropping one", async () => {
    //#given two concurrent edits
    const hooks = createCommentCheckerHooks()
    const firstCallID = nextCallID()
    const secondCallID = nextCallID()
    await hooks["tool.execute.before"](
      { tool: "edit", sessionID: SESSION_ID, callID: firstCallID },
      {
        args: {
          filePath: "/repo/queries/first.sql",
          oldString: "SELECT 1;\n",
          newString: "-- added first helper\nSELECT 1;\n",
        },
      },
    )
    await hooks["tool.execute.before"](
      { tool: "edit", sessionID: SESSION_ID, callID: secondCallID },
      {
        args: {
          filePath: "/repo/queries/second.sql",
          oldString: "SELECT 2;\n",
          newString: "-- added second helper\nSELECT 2;\n",
        },
      },
    )
    const firstOutput = resultOutput()
    const secondOutput = resultOutput()

    //#when both after hooks run
    await Promise.all([
      hooks["tool.execute.after"](
        { tool: "edit", sessionID: SESSION_ID, callID: firstCallID },
        firstOutput,
      ),
      hooks["tool.execute.after"](
        { tool: "edit", sessionID: SESSION_ID, callID: secondCallID },
        secondOutput,
      ),
    ])

    //#then each output carries its own finding
    expect(firstOutput.output).toContain("added first helper")
    expect(secondOutput.output).toContain("added second helper")
  })

  test("appends nothing when the tool output indicates a failure", async () => {
    //#given a write whose tool output reports a failure
    const hooks = createCommentCheckerHooks()
    const callID = nextCallID()
    await hooks["tool.execute.before"](
      { tool: "write", sessionID: SESSION_ID, callID },
      { args: { filePath: "/repo/queries/report.sql", content: "-- added the helper\nSELECT 1;\n" } },
    )
    const output = {
      title: "Error: file not found",
      output: "Error: file not found",
      metadata: undefined as unknown,
    }

    //#when the after hook runs
    await hooks["tool.execute.after"]({ tool: "write", sessionID: SESSION_ID, callID }, output)

    //#then the failed write is not flagged
    expect(output.output).toBe("Error: file not found")
  })

  test("appends nothing for allow-listed BDD and directive comments", async () => {
    //#given writes with a BDD comment and a machine directive
    const hooks = createCommentCheckerHooks()
    const bddCallID = nextCallID()
    const directiveCallID = nextCallID()
    await hooks["tool.execute.before"](
      { tool: "write", sessionID: SESSION_ID, callID: bddCallID },
      {
        args: {
          filePath: "/repo/queries/bdd.sql",
          content: "-- given a user exists\nSELECT 1;\n",
        },
      },
    )
    await hooks["tool.execute.before"](
      { tool: "write", sessionID: SESSION_ID, callID: directiveCallID },
      {
        args: { filePath: "/repo/queries/directive.sql", content: "-- noqa\nSELECT 1;\n" },
      },
    )
    const bddOutput = resultOutput()
    const directiveOutput = resultOutput()

    //#when the after hooks run
    await hooks["tool.execute.after"](
      { tool: "write", sessionID: SESSION_ID, callID: bddCallID },
      bddOutput,
    )
    await hooks["tool.execute.after"](
      { tool: "write", sessionID: SESSION_ID, callID: directiveCallID },
      directiveOutput,
    )

    //#then both are suppressed
    expect(bddOutput.output).toBe("ok")
    expect(directiveOutput.output).toBe("ok")
  })

  test("renders regex findings when the AST tier reports sg missing in a mixed batch", async () => {
    //#given a mixed TypeScript and SQL patch whose AST partition throws SgUnavailableError
    _setCommentScanSourcesForTesting((sources) =>
      scanSources(sources, {
        scanAst: async () => {
          throw new SgUnavailableError()
        },
      }),
    )
    const hooks = createCommentCheckerHooks()
    const output = {
      title: "ok",
      output: "ok",
      metadata: {
        files: [
          { filePath: "/repo/src/a.ts", before: "", after: "export const value = 1\n" },
          { filePath: "/repo/queries/q.sql", before: "", after: "-- added the helper\nSELECT 1;\n" },
        ],
      },
    }

    //#when the after hook runs
    await hooks["tool.execute.after"](
      { tool: "apply_patch", sessionID: SESSION_ID, callID: nextCallID() },
      output,
    )

    //#then the regex-tier finding is reported despite the binary-missing marker
    expect(output.output).toContain("COMMENT/DOCSTRING DETECTED")
    expect(output.output).toContain("added the helper")
  })

  test("scans a write whose path contains a failure-looking substring", async () => {
    //#given a successful write whose path contains "error:"
    const hooks = createCommentCheckerHooks()
    const callID = nextCallID()
    await hooks["tool.execute.before"](
      { tool: "write", sessionID: SESSION_ID, callID },
      {
        args: {
          filePath: "/repo/queries/error:notes.sql",
          content: "-- added the helper\nSELECT 1;\n",
        },
      },
    )
    const output = resultOutput("Wrote file successfully: /repo/queries/error:notes.sql")

    //#when the after hook runs
    await hooks["tool.execute.after"]({ tool: "write", sessionID: SESSION_ID, callID }, output)

    //#then the comment is still reported
    expect(output.output).toContain("COMMENT/DOCSTRING DETECTED")
  })

  test("skips when the output title reports a failure", async () => {
    //#given a write whose title starts with a failure word
    const hooks = createCommentCheckerHooks()
    const callID = nextCallID()
    await hooks["tool.execute.before"](
      { tool: "write", sessionID: SESSION_ID, callID },
      { args: { filePath: "/repo/queries/report.sql", content: "-- added the helper\nSELECT 1;\n" } },
    )
    const output = {
      title: "Error: permission denied",
      output: "Wrote file successfully: /repo/queries/report.sql",
      metadata: undefined as unknown,
    }

    //#when the after hook runs
    await hooks["tool.execute.after"]({ tool: "write", sessionID: SESSION_ID, callID }, output)

    //#then the failed write is not flagged
    expect(output.output).not.toContain("COMMENT/DOCSTRING DETECTED")
  })
})


describe("comment-checker per-edit report shape", () => {
  test("does not emit the agent-memo line listing", async () => {
    //#given a write that adds a comment starting with an agent-memo prefix
    const hooks = createCommentCheckerHooks()
    const callID = nextCallID()
    await hooks["tool.execute.before"](
      { tool: "write", sessionID: SESSION_ID, callID },
      { args: { filePath: "/repo/queries/report.sql", content: "-- added the thing\nSELECT 1;\n" } },
    )
    const output = resultOutput()

    //#when the after hook runs
    await hooks["tool.execute.after"]({ tool: "write", sessionID: SESSION_ID, callID }, output)

    //#then the finding is still reported without the memo line listing
    expect(output.output).toContain("added the thing")
    expect(output.output).not.toMatch(/- Line \d+:/)
  })
})