import { describe, expect, test } from "bun:test"
import { isCommandAvailable } from "../../src/mcps/mcp-validator"

describe("isCommandAvailable", () => {
  test("returns true for an existing command (bun)", () => {
    //#given - bun binary backing the test runner
    //#when
    const result = isCommandAvailable("bun")
    //#then
    expect(result).toBe(true)
  })

  test("returns false for a missing command", () => {
    //#given - a command name that cannot exist
    //#when
    const result = isCommandAvailable("matrixx-definitely-missing-binary-xyz")
    //#then
    expect(result).toBe(false)
  })

  test("does not throw for missing command", () => {
    //#given / #when / #then
    expect(() => isCommandAvailable("matrixx-definitely-missing-binary-xyz")).not.toThrow()
  })
})
