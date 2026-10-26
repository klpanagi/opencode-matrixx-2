import { describe, expect, test } from "bun:test"
import { guardCompressDirective, normalizeNudgeText, NUDGE_MARKERS } from "../../../src/hooks/dcp-nudge-sanitizer/constants"

function isNudgeText(text: string): boolean {
  return NUDGE_MARKERS.some((marker) => {
    marker.lastIndex = 0
    return marker.test(text)
  })
}

describe("dcp-nudge-sanitizer constants — passthrough + trim-only", () => {
  test("bare (b1) without adjacency passes through (not a nudge)", () => {
    //#given
    const prose = "see build (b1) for details"
    //#when
    const result = isNudgeText(prose)
    //#then
    expect(result).toBe(false)
  })

  test("adjacent sticky (b2) is detected as nudge", () => {
    //#given
    const sticky = "sticky nudge context (b2) please compress"
    //#when
    const result = isNudgeText(sticky)
    //#then
    expect(result).toBe(true)
  })

  test("normalizeNudgeText is trim-only, preserves fence interior", () => {
    //#given
    const fenced = "  kept  ```js\nconst  x  =  1;\n```  "
    //#when
    const result = normalizeNudgeText(fenced)
    //#then
    expect(result).toBe("kept  ```js\nconst  x  =  1;\n```")
  })

  test("unknown <foo> tag is not a nudge marker", () => {
    //#given
    const foo = "<foo>bar</foo> plain prose"
    //#when
    const result = isNudgeText(foo)
    //#then
    expect(result).toBe(false)
  })

  test("leak scan: foo text survives guard + normalize byte-identical", () => {
    //#given
    const foo = "<foo>bar</foo>"
    //#when
    const result = guardCompressDirective(normalizeNudgeText(foo))
    //#then
    expect(result).toBe(foo)
    expect(result).toContain("<foo>")
  })
})
