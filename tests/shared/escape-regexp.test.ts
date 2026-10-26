//#given a set of regex-special input strings
//#when escapeRegExp is applied
//#then all regex metacharacters are backslash-escaped (snapshot)
import { describe, expect, test } from "bun:test"
import { escapeRegExp } from "../../src/shared/escape-regexp"

describe("escapeRegExp golden", () => {
  test("escapes all metacharacters", () => {
    //#given representative inputs covering every char in /[.*+?^${}()|[\]\\]/
    const inputs = [
      "hello.world",
      "a*b+c?d",
      "price $100 (sale) [new] {x} ^start end$ a|b",
      String.raw`back\slash`,
      "no-specials-abc123",
      "",
    ]
    //#when mapping through the canonical helper
    const outputs = inputs.map(escapeRegExp)
    //#then snapshot of input→output pairs
    expect(outputs).toEqual([
      String.raw`hello\.world`,
      String.raw`a\*b\+c\?d`,
      String.raw`price \$100 \(sale\) \[new\] \{x\} \^start end\$ a\|b`,
      String.raw`back\\slash`,
      "no-specials-abc123",
      "",
    ])
    // escaped output must be usable as a literal RegExp source
    for (let i = 0; i < inputs.length; i++) {
      expect(new RegExp(`^${outputs[i]}$`).test(inputs[i])).toBe(true)
    }
  })
})
