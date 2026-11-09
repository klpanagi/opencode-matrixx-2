/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"

import { dcpCheck } from "../../../../src/cli/doctor/checks/dcp"

describe("dcpCheck", () => {
  test("check returns a named pass/warn result", async () => {
    //#given the DCP integration check
    //#when running it
    const result = await dcpCheck.check()

    //#then it reports the expected check identity and a valid status
    expect(result.name).toBe("dcp-integration")
    expect(["pass", "warn"]).toContain(result.status)
    expect(typeof result.message).toBe("string")
  })
})
