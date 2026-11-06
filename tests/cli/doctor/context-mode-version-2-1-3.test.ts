/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { evaluateContextModeToolCompat } from "../../../src/cli/doctor/checks/context-mode"

describe("context-mode tool compat version string (2.1.3 lock)", () => {
  test("fail detail names context-mode@2.1.3, not the stale 2.0.0-next.24", () => {
    //#given no ctx_* tools registered
    const toolNames: string[] = []

    //#when evaluated
    const result = evaluateContextModeToolCompat(toolNames)

    //#then fail detail points at the locked 2.1.3 line
    expect(result.status).toBe("fail")
    expect(result.detail).toContain("2.1.3")
    expect(result.detail).not.toContain("2.0.0-next.24")
  })
})
