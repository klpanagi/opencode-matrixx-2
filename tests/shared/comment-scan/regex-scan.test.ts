//#given regex-tier sources for every language in plan §4.1
//#when scanRegexSources and scanRegexText run the line-based fallback tier
//#then each comment is emitted once with a 1-based line, tier "regex", and fixture-pinned trailing
import { describe, expect, test } from "bun:test"

import { DEFAULT_MAX_FINDINGS, MAX_FILE_BYTES } from "../../../src/shared/comment-scan/constants"
import { scanRegexSources, scanRegexText } from "../../../src/shared/comment-scan/regex-scan"
import type { RegexLanguage } from "../../../src/shared/comment-scan/types"

function scanOne(filePath: string, text: string) {
  return scanRegexSources([{ filePath, text }])
}

const LEADER_ROWS: ReadonlyArray<readonly [RegexLanguage, string, string]> = [
  ["ocaml", "sample.ml", "(* ocaml block *)"],
  ["ocaml", "sample.mli", "(* ocaml signature *)"],
  ["sql", "sample.sql", "-- sql line"],
  ["sql", "sample.sql", "/* sql block */"],
  ["toml", "Cargo.toml", "# toml line"],
  ["hcl", "main.tf", "# hcl hash"],
  ["hcl", "main.tf", "// hcl slash"],
  ["hcl", "main.hcl", "/* hcl block */"],
  ["dockerfile", "Dockerfile", "# docker line"],
  ["proto", "api.proto", "// proto line"],
  ["proto", "api.proto", "/* proto block */"],
  ["svelte", "App.svelte", "// svelte script"],
  ["svelte", "App.svelte", "<!-- svelte markup -->"],
  ["elm", "Main.elm", "-- elm line"],
  ["elm", "Main.elm", "{- elm block -}"],
  ["groovy", "build.gradle", "// groovy line"],
  ["groovy", "build.gradle", "/* groovy block */"],
  ["cue", "schema.cue", "// cue line"],
]

describe("scanRegexSources leader coverage", () => {
  test.each(LEADER_ROWS)("scans a %s comment in %s", (language, filePath, comment) => {
    //#given a single comment line for the language
    const findings = scanOne(filePath, `${comment}\n`)
    //#when scanning the source
    //#then exactly one regex finding starts at line 1 with the raw comment text
    expect(findings).toHaveLength(1)
    expect(findings[0]).toEqual({
      file: filePath,
      line: 1,
      text: comment,
      tier: "regex",
      isDocstring: false,
      trailing: false,
      language,
    })
  })
})

describe("scanRegexSources jsonc", () => {
  test("emits one finding for a // line comment", () => {
    //#given a jsonc document with a standalone line comment
    const text = '{\n  // primary\n  "a": 1\n}\n'
    //#when scanning
    const findings = scanOne("config.jsonc", text)
    //#then only that comment is emitted, on its 1-based line
    expect(findings).toEqual([
      {
        file: "config.jsonc",
        line: 2,
        text: "// primary",
        tier: "regex",
        isDocstring: false,
        trailing: false,
        language: "jsonc",
      },
    ])
  })

  test("emits one finding for a /* */ block comment", () => {
    //#given a block comment after code on the same line
    const findings = scanOne("x.jsonc", '{\n  "a": /* keep */ 1\n}\n')
    //#when scanning
    //#then the block is one finding and it is trailing
    expect(findings).toHaveLength(1)
    expect(findings[0]?.line).toBe(2)
    expect(findings[0]?.text).toBe("/* keep */")
    expect(findings[0]?.trailing).toBe(true)
  })

  test("collapses a multi-line block into a single finding at the opening line", () => {
    //#given a three-line block comment
    const text = '{\n  /*\n   * block\n   */\n  "a": 1\n}\n'
    //#when scanning
    const findings = scanOne("multi.jsonc", text)
    //#then exactly one finding holds the trimmed full block at the opening line
    expect(findings).toHaveLength(1)
    expect(findings[0]?.line).toBe(2)
    expect(findings[0]?.text).toBe("/*\n   * block\n   */")
    expect(findings[0]?.trailing).toBe(false)
  })

  test("does not treat a // inside a block as a second comment", () => {
    //#given a block whose body contains a line-comment leader
    const findings = scanOne("body.jsonc", "/*\n // still block\n*/\n")
    //#when scanning
    //#then the body stays part of the single block finding
    expect(findings).toHaveLength(1)
    expect(findings[0]?.text).toBe("/*\n // still block\n*/")
  })

  test("emits a block and a trailing line comment from the same line", () => {
    //#given a block comment followed by a line comment
    const findings = scanOne("two.jsonc", "/* a */ // b\n")
    //#when scanning
    //#then both are emitted with the second marked trailing
    expect(findings.map((finding) => finding.text)).toEqual(["/* a */", "// b"])
    expect(findings.map((finding) => finding.trailing)).toEqual([false, true])
  })

  test("marks a block that opens after code as trailing", () => {
    //#given a multi-line block that opens after code
    const findings = scanOne("trail.jsonc", "x: /* start\nmiddle\nend */\n")
    //#when scanning
    //#then the single finding sits on line 1 and is trailing
    expect(findings).toHaveLength(1)
    expect(findings[0]?.line).toBe(1)
    expect(findings[0]?.trailing).toBe(true)
    expect(findings[0]?.text).toBe("/* start\nmiddle\nend */")
  })

  test("emits an unterminated block once and resets state at EOF", () => {
    //#given two sources where the first opens a block that never closes
    const findings = scanRegexSources([
      { filePath: "a.jsonc", text: "/* open\nstill" },
      { filePath: "b.jsonc", text: "// after\n" },
    ])
    //#when scanning both
    //#then the open block is emitted for its own file and does not leak into the next
    expect(findings).toHaveLength(2)
    expect(findings[0]?.file).toBe("a.jsonc")
    expect(findings[0]?.text).toBe("/* open\nstill")
    expect(findings[1]?.file).toBe("b.jsonc")
    expect(findings[1]?.text).toBe("// after")
  })
})

describe("scanRegexSources trailing", () => {
  test("is false for an indented standalone comment", () => {
    //#given a comment preceded only by whitespace
    const findings = scanOne("a.sql", "SELECT 1;\n    -- standalone\n")
    //#when scanning
    //#then the comment is not trailing
    expect(findings).toHaveLength(1)
    expect(findings[0]?.trailing).toBe(false)
  })

  test("is true when code precedes the comment", () => {
    //#given a comment after a statement
    const findings = scanOne("a.sql", "SELECT 1; -- trailing\n")
    //#when scanning
    //#then the comment is trailing
    expect(findings).toHaveLength(1)
    expect(findings[0]?.trailing).toBe(true)
  })
})

describe("scanRegexSources string literals", () => {
  test("ignores leaders inside string literals", () => {
    //#given strings whose bodies contain comment leaders
    //#when scanning each source
    //#then no finding is produced
    expect(scanOne("a.toml", 'msg = "a # b"\n')).toHaveLength(0)
    expect(scanOne("a.tf", 'url = "https://example.com/x"\n')).toHaveLength(0)
    expect(scanOne("a.sql", 'SELECT "a -- b"\n')).toHaveLength(0)
  })

  test("keeps a leader that follows a closed string literal", () => {
    //#given a string followed by a real comment
    const findings = scanOne("a.toml", 'msg = "a # b" # real\n')
    //#when scanning
    //#then only the real comment is emitted as trailing
    expect(findings).toHaveLength(1)
    expect(findings[0]?.text).toBe("# real")
    expect(findings[0]?.trailing).toBe(true)
  })
})

describe("scanRegexSources limits and filtering", () => {
  test("caps findings at the explicit maxFindings option", () => {
    //#given five line comments and a cap of two
    const text = ["// a", "// b", "// c", "// d", "// e"].join("\n")
    //#when scanning with maxFindings 2
    const findings = scanRegexSources([{ filePath: "cap.jsonc", text }], { maxFindings: 2 })
    //#then only the first two are kept
    expect(findings.map((finding) => finding.text)).toEqual(["// a", "// b"])
  })

  test("defaults to DEFAULT_MAX_FINDINGS", () => {
    //#given more comments than the default cap
    const text = Array.from({ length: DEFAULT_MAX_FINDINGS + 10 }, (_, index) => `// c${index}`).join("\n")
    //#when scanning without options
    const findings = scanRegexSources([{ filePath: "cap.jsonc", text }])
    //#then the default cap applies
    expect(findings).toHaveLength(DEFAULT_MAX_FINDINGS)
  })

  test("skips sources that do not resolve to a regex language", () => {
    //#given an AST source, an unknown source, and a regex source
    const findings = scanRegexSources([
      { filePath: "a.ts", text: "// ts\n" },
      { filePath: "notes.txt", text: "# nope\n" },
      { filePath: "b.cue", text: "// cue\n" },
    ])
    //#when scanning the batch
    //#then only the regex-tier source contributes findings
    expect(findings.map((finding) => finding.file)).toEqual(["b.cue"])
  })

  test("numbers lines per source", () => {
    //#given two sources with different comment offsets
    const findings = scanRegexSources([
      { filePath: "a.cue", text: "x: 1\n// a\n" },
      { filePath: "b.cue", text: "y: 2\n\n// b\n" },
    ])
    //#when scanning both
    //#then line numbers restart per source
    expect(findings.map((finding) => [finding.file, finding.line])).toEqual([
      ["a.cue", 2],
      ["b.cue", 3],
    ])
  })

  test("returns no findings for empty or comment-free text", () => {
    //#given empty and comment-free sources
    //#when scanning
    //#then nothing is emitted
    expect(scanOne("empty.jsonc", "")).toHaveLength(0)
    expect(scanOne("plain.jsonc", '{\n  "a": 1\n}\n')).toHaveLength(0)
  })

  test("skips an oversize source and reports it through the errors sink", () => {
    //#given one source above the byte cap and one small source
    const errors: string[] = []
    const findings = scanRegexSources(
      [
        { filePath: "huge.sql", text: `-- ${"a".repeat(MAX_FILE_BYTES)}` },
        { filePath: "small.sql", text: "-- kept\n" },
      ],
      undefined,
      errors,
    )

    //#then the oversize source is skipped loudly and the rest is scanned
    expect(findings.map((item) => item.file)).toEqual(["small.sql"])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain("huge.sql")
    expect(errors[0]).toContain(`${MAX_FILE_BYTES}-byte limit`)
  })
})

describe("scanRegexText", () => {
  test("scans one text without a cap and stamps the language", () => {
    //#given a jsonc text with two line comments
    //#when scanning it directly
    const findings = scanRegexText("// a\n// b\n", "x.jsonc", "jsonc")
    //#then both are emitted on consecutive 1-based lines
    expect(findings.map((finding) => finding.line)).toEqual([1, 2])
    expect(findings.every((finding) => finding.language === "jsonc" && finding.tier === "regex")).toBe(true)
  })
})
