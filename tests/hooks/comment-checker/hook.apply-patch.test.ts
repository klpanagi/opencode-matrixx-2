import { describe, expect, it } from "bun:test"
import { createCommentCheckerHooks } from "../../../src/hooks/comment-checker/hook"

const SESSION_ID = "ses_apply_patch_test"

function resultOutput(text = "ok") {
  return { title: "ok", output: text, metadata: undefined as unknown }
}

describe("comment-checker apply_patch integration", () => {
  it("scans metadata.files with before/after pairs and skips deletes", async () => {
    // given
    const hooks = createCommentCheckerHooks()
    const input = { tool: "apply_patch", sessionID: SESSION_ID, callID: "call_apply_patch" }
    const output = {
      title: "ok",
      output: "Success. Updated the following files:\nM src/a.sql",
      metadata: {
        files: [
          {
            filePath: "/repo/queries/a.sql",
            before: "SELECT 1;\n",
            after: "-- added in a\nSELECT 1;\n",
            type: "update",
          },
          {
            filePath: "/repo/queries/old.sql",
            movePath: "/repo/queries/new.sql",
            before: "SELECT 2;\n",
            after: "-- moved comment\nSELECT 2;\n",
            type: "move",
          },
          {
            filePath: "/repo/queries/delete.sql",
            before: "-- deleted comment\n",
            after: "-- deleted comment\n",
            type: "delete",
          },
        ],
      },
    }

    // when
    await hooks["tool.execute.after"](input, output)

    // then
    expect(output.output).toContain("added in a")
    expect(output.output).toContain("moved comment")
    expect(output.output).toContain('file="/repo/queries/new.sql"')
    expect(output.output).not.toContain("deleted comment")
    expect(output.output).not.toContain('file="/repo/queries/old.sql"')
  })

  it("appends nothing when apply_patch metadata.files is missing", async () => {
    // given
    const hooks = createCommentCheckerHooks()
    const input = { tool: "apply_patch", sessionID: SESSION_ID, callID: "call_apply_patch_empty" }
    const output = resultOutput()

    // when
    await hooks["tool.execute.after"](input, { ...output, metadata: {} })

    // then
    expect(output.output).toBe("ok")
  })

  it("appends nothing when the apply_patch output indicates a failure", async () => {
    // given
    const hooks = createCommentCheckerHooks()
    const input = { tool: "apply_patch", sessionID: SESSION_ID, callID: "call_apply_patch_error" }
    const output = {
      title: "Error: patch failed to apply",
      output: "Error: patch failed to apply",
      metadata: {
        files: [
          {
            filePath: "/repo/queries/a.sql",
            before: "SELECT 1;\n",
            after: "-- added in a\nSELECT 1;\n",
          },
        ],
      },
    }

    // when
    await hooks["tool.execute.after"](input, output)

    // then
    expect(output.output).toBe("Error: patch failed to apply")
  })
})
