/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import type { BackgroundTask } from "../../../src/features/background-agent/types"
import { formatResolvedTitle } from "../../../src/tools/background-task/create-background-output"

function makeTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "bg_test",
    parentSessionID: "ses_parent",
    parentMessageID: "msg_parent",
    description: "Do the thing",
    prompt: "prompt",
    agent: "mouse",
    status: "running",
    ...overrides,
  }
}

describe("formatResolvedTitle (issue #94)", () => {
  test("mouse with category renders labeled title with — separator", () => {
    //#given a mouse task with a category
    //#when formatting the resolved title
    const title = formatResolvedTitle(makeTask({ agent: "mouse", category: "source" }))

    //#then the labeled form renders with an em-dash separator
    expect(title).toBe("Mouse[source] — Do the thing")
  })

  test("mouse display name resolves via config key", () => {
    //#given the canonical display name instead of the key
    //#when formatting
    const title = formatResolvedTitle(makeTask({ agent: "Mouse", category: "source" }))

    //#then it still delegates to the labeled title
    expect(title).toBe("Mouse[source] — Do the thing")
  })

  test("non-mouse agent renders without category label", () => {
    //#given a non-mouse agent
    //#when formatting
    const title = formatResolvedTitle(makeTask({ agent: "oracle" }))

    //#then no category leaks in and the separator is an em-dash
    expect(title).toBe("Oracle — Do the thing")
    expect(title).not.toContain(" - ")
  })
})
