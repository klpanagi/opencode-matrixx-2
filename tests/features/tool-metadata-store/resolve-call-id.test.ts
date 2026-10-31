import { describe, expect, test } from "bun:test"
import { resolveToolCallID } from "../../../src/features/tool-metadata-store/call-id"

describe("resolveToolCallID", () => {
  test("prefers callID when all variants present", () => {
    //#given
    const ctx = { callID: "call_ID", callId: "call_Id", call_id: "call_id" }

    //#when
    const result = resolveToolCallID(ctx)

    //#then
    expect(result).toBe("call_ID")
  })

  test("falls back to callId when callID absent", () => {
    //#given
    const ctx = { callId: "call_Id" }

    //#when
    const result = resolveToolCallID(ctx)

    //#then
    expect(result).toBe("call_Id")
  })

  test("falls back to call_id when others absent", () => {
    //#given
    const ctx = { call_id: "call_id" }

    //#when
    const result = resolveToolCallID(ctx)

    //#then
    expect(result).toBe("call_id")
  })

  test("returns undefined when no variant present", () => {
    //#given
    const ctx = {}

    //#when
    const result = resolveToolCallID(ctx)

    //#then
    expect(result).toBeUndefined()
  })

  test("ignores blank strings", () => {
    //#given
    const ctx = { callID: "   ", callId: "", call_id: "ok" }

    //#when
    const result = resolveToolCallID(ctx)

    //#then
    expect(result).toBe("ok")
  })
})
