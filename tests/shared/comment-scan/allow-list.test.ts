/// <reference types="bun-types" />
//#given the frozen prefix fixture and the shipped allow-list tables
//#when the fixture is parsed and the tables are applied through filter.ts matching
//#then the inline prefixes reproduce the measurement and the measured asymmetries hold
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  AGENT_MEMO_PREFIXES,
  DEFAULT_ALLOW_LIST,
} from "../../../src/shared/comment-scan/allow-list"
import { isAgentMemo } from "../../../src/shared/comment-scan/filter"

const FIXTURE_PATH = join(import.meta.dir, "../../fixtures/comment-scan/agent-memo-prefixes.txt")

function loadAgentMemoPrefixes(text: string): string[] {
  const prefixes: string[] = []
  const seen = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === "" || trimmed.startsWith("#")) continue
    const prefix = trimmed.toLowerCase()
    if (seen.has(prefix)) continue
    seen.add(prefix)
    prefixes.push(prefix)
  }
  return prefixes
}

function matchesMemo(text: string): boolean {
  return isAgentMemo(text, AGENT_MEMO_PREFIXES)
}

describe("loadAgentMemoPrefixes", () => {
  test("parses the frozen fixture into the shipped inline table", () => {
    //#given the fixture the old binary's prefix list was measured into
    const fixtureText = readFileSync(FIXTURE_PATH, "utf8")
    //#when the fixture is parsed
    const parsed = loadAgentMemoPrefixes(fixtureText)
    //#then the inline literal equals the parsed list, entry for entry
    expect(parsed).toEqual(AGENT_MEMO_PREFIXES)
  })

  test("skips header lines and blanks, trims, lowercases, and dedupes in order", () => {
    //#given a fixture-shaped document with headers, blanks, padding, and a repeat
    const text = [
      "# a header comment",
      "",
      "  Added  ",
      "remove",
      "ADDED",
      "\tnote:\t",
      "",
      "# trailing header",
    ].join("\n")
    //#when the document is parsed
    const parsed = loadAgentMemoPrefixes(text)
    //#then headers and blanks are gone, values are trimmed and lowercased, order is stable
    expect(parsed).toEqual(["added", "remove", "note:"])
  })
})

describe("AGENT_MEMO_PREFIXES", () => {
  test("holds the 34 measured lowercase prefixes exactly once each", () => {
    expect(AGENT_MEMO_PREFIXES).toHaveLength(34)
    expect(new Set(AGENT_MEMO_PREFIXES).size).toBe(34)
    for (const prefix of AGENT_MEMO_PREFIXES) {
      expect(prefix).toBe(prefix.toLowerCase())
    }
  })

  test("keeps the bare stems the old binary matched", () => {
    //#given comments that open with a bare stem the binary matched
    const matched = [
      "// remove the dead branch",
      "// delete stale rows",
      "// replace the helper",
      "// update the caller",
      "// rename the field",
      "// migrate the schema",
    ]
    //#when each comment is matched against the prefix table
    //#then every bare stem matches
    for (const comment of matched) {
      expect(matchesMemo(comment)).toBe(true)
    }
  })

  test("does not invent prefixes the old binary never matched", () => {
    //#given comments that open with stems absent from the measured table
    const unmatched = [
      "// add a retry helper",
      "// implement the loader",
      "// switch to the new path",
      "// modify the default",
      "// convert to a number",
    ]
    //#when each comment is matched against the prefix table
    //#then none of them match; absence from the table is the measured behaviour
    for (const comment of unmatched) {
      expect(matchesMemo(comment)).toBe(false)
    }
    expect(AGENT_MEMO_PREFIXES).not.toContain("add")
    expect(AGENT_MEMO_PREFIXES).not.toContain("implement")
    expect(AGENT_MEMO_PREFIXES).not.toContain("switch to")
    expect(AGENT_MEMO_PREFIXES).not.toContain("modify")
    expect(AGENT_MEMO_PREFIXES).not.toContain("convert to")
  })

  test("matches case-insensitively after stripping comment decoration", () => {
    expect(matchesMemo("// Previously we cached the path")).toBe(true)
    expect(matchesMemo("/* UPDATE the caller */")).toBe(true)
    expect(matchesMemo("#\tNOW WE call the helper")).toBe(true)
  })

  test("matches as a plain prefix, not a whole word", () => {
    //#given a comment whose first word extends a table entry
    //#when it is matched
    //#then the prefix rule applies, which is how filter.ts is specified
    expect(matchesMemo("// renames the field")).toBe(true)
  })

  test("matches note: when a body follows it", () => {
    expect(matchesMemo("// note: rotate the signing key")).toBe(true)
  })

  test("ignores comments whose prefix appears later in the body", () => {
    expect(matchesMemo("// we remove the dead branch once the flag flips")).toBe(false)
  })
})

describe("DEFAULT_ALLOW_LIST", () => {
  test("reuses the shipped prefix table", () => {
    expect(DEFAULT_ALLOW_LIST.agentMemoPrefixes).toEqual(AGENT_MEMO_PREFIXES)
  })

  test("drops BDD keywords case-insensitively on a word boundary", () => {
    //#given a comment body that opens with each BDD keyword
    const keywords = ["given a user", "when it loads", "then it renders", "and the rest", "but not this"]
    for (const body of keywords) {
      expect(DEFAULT_ALLOW_LIST.bddKeywords.test(body)).toBe(true)
    }
    //#then casing does not matter
    expect(DEFAULT_ALLOW_LIST.bddKeywords.test("Given a user")).toBe(true)
    //#and prefix lookalikes outside a word boundary are not BDD comments
    expect(DEFAULT_ALLOW_LIST.bddKeywords.test("explain the cache")).toBe(false)
    expect(DEFAULT_ALLOW_LIST.bddKeywords.test("andromeda drift")).toBe(false)
  })

  test("carries the lint and build directive prefixes", () => {
    //#given the directive table the allow-list ships
    const required = [
      "@ts-",
      "eslint-",
      "biome-",
      "rubocop",
      "noqa",
      "type:",
      "istanbul",
      "nolint",
      "prettier-",
      "ts-expect-error",
    ]
    //#then every mandated entry is present
    for (const directive of required) {
      expect(DEFAULT_ALLOW_LIST.directives).toContain(directive)
    }
    //#and the tool prefixes measured as ignored by the old binary are present too
    for (const directive of ["ts-ignore", "pylint:", "ruff:", "mypy:", "pyre:", "flake8:", "pytype:", "clippy:", "pyright:"]) {
      expect(DEFAULT_ALLOW_LIST.directives).toContain(directive)
    }
    //#and the table stays lowercase so it lines up with filter.ts lowering
    for (const directive of DEFAULT_ALLOW_LIST.directives) {
      expect(directive).toBe(directive.toLowerCase())
    }
  })

  test("matches the shebang at the start of a line-1 body", () => {
    expect(DEFAULT_ALLOW_LIST.shebangs).toHaveLength(1)
    expect(DEFAULT_ALLOW_LIST.shebangs[0]?.test("#!/usr/bin/env bun")).toBe(true)
    expect(DEFAULT_ALLOW_LIST.shebangs[0]?.test("! not a shebang")).toBe(false)
  })
})
