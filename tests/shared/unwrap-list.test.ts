import { describe, expect, it } from "bun:test"
import { unwrapList } from "../../src/shared/unwrap-list"

describe("unwrapList", () => {
  it("returns an array input unchanged", () => {
    //#given
    const input = [{ name: "oracle" }]

    //#when
    const result = unwrapList(input)

    //#then
    expect(result).toEqual([{ name: "oracle" }])
  })

  it("unwraps a located envelope exactly once", () => {
    //#given
    const input = { location: { directory: "/tmp" }, data: [{ name: "oracle", mode: "subagent" }] }

    //#when
    const result = unwrapList(input)

    //#then
    expect(result).toEqual([{ name: "oracle", mode: "subagent" }])
  })

  it("unwraps a bare data envelope", () => {
    //#given
    const input = { data: [{ name: "sati" }] }

    //#when
    const result = unwrapList(input)

    //#then
    expect(result).toEqual([{ name: "sati" }])
  })

  it("returns empty for null, undefined, strings, numbers, and booleans", () => {
    //#given
    const inputs = [null, undefined, "nonsense", 42, true]

    //#when
    const results = inputs.map((v) => unwrapList(v))

    //#then
    for (const r of results) expect(r).toEqual([])
  })

  it("returns empty for a dataless object", () => {
    //#given
    const input = { location: { directory: "/tmp" } }

    //#when
    const result = unwrapList(input)

    //#then
    expect(result).toEqual([])
  })

  it("never unwraps twice: a nested array stays nested", () => {
    //#given
    const input = [[{ name: "x" }]]

    //#when
    const result = unwrapList(input)

    //#then
    expect(result).toEqual([[{ name: "x" }]])
  })

  it("never unwraps twice: an envelope holding an envelope stays single-unwrapped", () => {
    //#given
    const input = { data: { data: [{ name: "y" }] } }

    //#when
    const result = unwrapList(input)

    //#then
    expect(result).toEqual([])
  })
})
