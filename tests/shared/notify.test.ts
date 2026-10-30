import { afterEach, describe, expect, it } from "bun:test"
import { notify, resetNotifySink, setNotifySink } from "../../src/shared/notify"

afterEach(() => {
  resetNotifySink()
})

describe("notify", () => {
  it("captures level, message and data on the installed sink", () => {
    //#given a recording sink
    const seen: Array<{ level: string; message: string; data?: unknown }> = []
    setNotifySink((level, message, data) => seen.push({ level, message, data }))

    //#when a notification is raised
    notify("info", "Background task finished", { id: "T-1" })

    //#then the sink receives the explicit fields
    expect(seen).toEqual([{ level: "info", message: "Background task finished", data: { id: "T-1" } }])
  })

  it("is a no-op when no sink is installed", () => {
    //#given no installed sink
    resetNotifySink()

    //#when a notification is raised
    const raised = () => notify("warn", "nothing to draw with")

    //#then it neither throws nor returns a value
    expect(raised).not.toThrow()
    expect(notify("info", "again")).toBeUndefined()
  })

  it("never defaults to the error level", () => {
    //#given a recording sink
    const levels: string[] = []
    setNotifySink((level) => levels.push(level))

    //#when notifications are raised without an explicit error level
    notify("info", "a")
    notify("warn", "b")
    notify("success", "c")

    //#then every recorded level is the one the caller asked for
    expect(levels).toEqual(["info", "warn", "success"])
    expect(levels).not.toContain("error")
  })
})
