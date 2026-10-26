import { describe, expect, test } from "bun:test"
import { bindSafeHook } from "../../src/shared/safe-create-hook"

describe("bindSafeHook", () => {
  test("passes factory result through when enabled", () => {
    //#given
    const hook = { handler: () => {} }
    const safeHook = bindSafeHook(true)

    //#when
    const result = safeHook("test-hook", () => hook)

    //#then
    expect(result).toBe(hook)
  })

  test("returns null when factory throws and enabled", () => {
    //#given
    const safeHook = bindSafeHook(true)

    //#when
    const result = safeHook("test-hook", () => {
      throw new Error("boom")
    })

    //#then
    expect(result).toBeNull()
  })

  test("propagates factory throw when disabled", () => {
    //#given
    const safeHook = bindSafeHook(false)

    //#when + #then
    expect(() =>
      safeHook("test-hook", () => {
        throw new Error("boom")
      }),
    ).toThrow("boom")
  })

  test("passes factory result through when disabled", () => {
    //#given
    const hook = { handler: () => {} }
    const safeHook = bindSafeHook(false)

    //#when
    const result = safeHook("test-hook", () => hook)

    //#then
    expect(result).toBe(hook)
  })

  test("bound helper is reusable across hook names", () => {
    //#given
    const safeHook = bindSafeHook(true)

    //#when
    const first = safeHook("hook-a", () => 1)
    const second = safeHook("hook-b", () => 2)

    //#then
    expect(first).toBe(1)
    expect(second).toBe(2)
  })
})
