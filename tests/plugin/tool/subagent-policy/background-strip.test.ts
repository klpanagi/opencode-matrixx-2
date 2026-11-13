/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { stripBackgroundArgs } from "../../../../src/plugin/tool/subagent-policy/background-strip"

describe("stripBackgroundArgs", () => {
  test("removes background: true", () => {
    //#given
    const args: Record<string, unknown> = {
      agent: "mouse-source",
      description: "d",
      prompt: "do it",
      background: true,
    }
    const logged: Array<{ message: string; data?: unknown }> = []
    const logFn = (message: string, data?: unknown) => logged.push({ message, data })

    //#when
    const stripped = stripBackgroundArgs(args, logFn)

    //#then
    expect(stripped).toEqual(["background"])
    expect(args).not.toHaveProperty("background")
    expect(logged).toHaveLength(1)
    expect(logged[0]?.message).toBe("[subagent-policy] stripped background affordance")
    expect(logged[0]?.data).toEqual({ key: "background" })
  })

  test("removes run_in_background: false", () => {
    //#given
    const args: Record<string, unknown> = {
      agent: "mouse-source",
      prompt: "do it",
      run_in_background: false,
    }

    //#when
    const stripped = stripBackgroundArgs(args, () => {})

    //#then
    expect(stripped).toEqual(["run_in_background"])
    expect(args).not.toHaveProperty("run_in_background")
  })

  test("removes both keys and names them in order", () => {
    //#given
    const args: Record<string, unknown> = {
      agent: "mouse-source",
      prompt: "do it",
      background: true,
      run_in_background: true,
    }

    //#when
    const stripped = stripBackgroundArgs(args, () => {})

    //#then
    expect(stripped).toEqual(["background", "run_in_background"])
    expect(args).not.toHaveProperty("background")
    expect(args).not.toHaveProperty("run_in_background")
  })

  test("leaves every other key byte-identical", () => {
    //#given
    const args: Record<string, unknown> = {
      agent: "mouse-source",
      description: "d",
      prompt: "Fix the bug in src/foo.ts line 42.",
      sessionID: "ses_child",
      model: "provider/model",
      background: true,
    }
    const expected = {
      agent: "mouse-source",
      description: "d",
      prompt: "Fix the bug in src/foo.ts line 42.",
      sessionID: "ses_child",
      model: "provider/model",
    }

    //#when
    stripBackgroundArgs(args, () => {})

    //#then
    expect(args).toEqual(expected)
    expect(JSON.stringify(args)).toBe(JSON.stringify(expected))
  })

  test("no-op when neither key is present", () => {
    //#given
    const args: Record<string, unknown> = {
      agent: "mouse-source",
      prompt: "do it",
    }
    const logged: string[] = []

    //#when
    const stripped = stripBackgroundArgs(args, (message) => logged.push(message))

    //#then
    expect(stripped).toEqual([])
    expect(args).toEqual({ agent: "mouse-source", prompt: "do it" })
    expect(logged).toEqual([])
  })

  test("never throws on hostile args", () => {
    //#given
    const args = Object.assign(Object.create({ background: true }), { prompt: "x" }) as Record<string, unknown>
    const logged: string[] = []

    //#when
    const stripped = stripBackgroundArgs(args, (message) => logged.push(message))

    //#then
    expect(stripped).toEqual([])
    expect("background" in args).toBe(true)
    expect(args.prompt).toBe("x")
    expect(logged).toEqual([])
  })

  test("non-configurable own key never throws", () => {
    //#given
    // An undeletable key is deliberately left in place rather than reported: the
    // contract is "never throws", not "always wins", so a false deletion is silence.
    const args: Record<string, unknown> = {}
    Object.defineProperty(args, "background", {
      value: true,
      configurable: false,
      enumerable: true,
      writable: true,
    })
    const logged: Array<{ message: string; data?: unknown }> = []

    //#when
    const stripped = stripBackgroundArgs(args, (message, data) => logged.push({ message, data }))

    //#then
    expect(stripped).toEqual([])
    expect(args.background).toBe(true)
    expect(logged).toEqual([])
  })

  test("configurable own key is reported once", () => {
    //#given
    const args: Record<string, unknown> = { background: true, prompt: "x" }
    const logged: Array<{ message: string; data?: unknown }> = []

    //#when
    const stripped = stripBackgroundArgs(args, (message, data) => logged.push({ message, data }))

    //#then
    expect(stripped).toEqual(["background"])
    expect(args).toEqual({ prompt: "x" })
    expect(logged).toEqual([
      { message: "[subagent-policy] stripped background affordance", data: { key: "background" } },
    ])
  })
})
