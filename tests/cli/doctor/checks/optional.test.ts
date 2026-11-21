import { afterEach, describe, expect, test } from "bun:test"
import { _setCommentScanProbeForTesting, commentScanCheck } from "../../../../src/cli/doctor/checks/optional"
import { SgUnavailableError } from "../../../../src/shared/comment-scan/sg-invoke"

afterEach(() => {
  _setCommentScanProbeForTesting(null)
})

describe("commentScanCheck", () => {
  test("passes and reports the resolved sg path when a usable binary is found", async () => {
    _setCommentScanProbeForTesting(async () => "/repo/node_modules/@ast-grep/cli/sg")

    const result = await commentScanCheck.check()

    expect(result.status).toBe("pass")
    expect(result.message).toContain("AST tier")
    expect(result.message).toContain("/repo/node_modules/@ast-grep/cli/sg")
    expect(result.detail).toContain("sg: /repo/node_modules/@ast-grep/cli/sg")
  })

  test("warns with the rejection reason and keeps the regex tier available", async () => {
    _setCommentScanProbeForTesting(
      async () => {
        throw new SgUnavailableError("ast-grep (sg) binary not found: rejected 2 candidate(s)")
      },
      async () => false,
    )

    const result = await commentScanCheck.check()

    expect(result.status).toBe("warn")
    expect(result.message).toContain("regex tier only")
    expect(result.message).toContain("rejected 2 candidate(s)")
    expect(result.message).toContain("packaged")
    expect(result.message).toContain("cached")
    expect(result.message).toContain("resolved")
    expect(result.detail).toContain("AST tier unavailable")
  })
})
