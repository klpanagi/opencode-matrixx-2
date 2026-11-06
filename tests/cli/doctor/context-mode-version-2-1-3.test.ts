/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { evaluateContextModeToolCompat } from "../../../src/cli/doctor/checks/context-mode"

describe("context-mode tool compat version string (2.1.x line)", () => {
  test("fail detail names the 2.1.x line, not an exact pin or the stale 2.0.0-next.24", () => {
    //#given no ctx_* tools registered
    const toolNames: string[] = []

    //#when evaluated
    const result = evaluateContextModeToolCompat(toolNames)

    //#then fail detail points at the 2.1.x range
    expect(result.status).toBe("fail")
    expect(result.detail ?? "").toContain("2.1")
    expect(result.detail).not.toContain("2.0.0-next.24")
    expect(result.detail ?? "").not.toContain("@2.1.3")
  })
})
