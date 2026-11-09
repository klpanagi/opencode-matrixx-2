/// <reference types="bun-types" />
import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const SCRIPT = join(import.meta.dir, "../../script/check-dead-symbols.sh")
const HEADER = "# test inventory: symbol | path | status | evidence | proof-scope | row-kind"

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

type Fixture = {
  files: Record<string, string>
  rows: string[]
}

function makeRepo(fixture: Fixture): string {
  //#given a throwaway git repository containing fixture sources and inventory
  const root = mkdtempSync(join(tmpdir(), "dead-symbols-check-"))
  tempDirs.push(root)
  mkdirSync(join(root, "src"), { recursive: true })
  mkdirSync(join(root, "tests"), { recursive: true })
  mkdirSync(join(root, "script"), { recursive: true })

  for (const [relativePath, content] of Object.entries(fixture.files)) {
    const absolutePath = join(root, relativePath)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, content)
  }

  writeFileSync(
    join(root, "script", "dead-symbols.txt"),
    `${HEADER}\n${fixture.rows.join("\n")}\n`,
  )

  execFileSync("git", ["init", "-q"], { cwd: root })
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root })
  execFileSync("git", ["config", "user.name", "test"], { cwd: root })
  execFileSync("git", ["add", "-A"], { cwd: root })
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root })
  return root
}

type RunResult = { status: number; stdout: string; stderr: string }

function runChecker(root: string, extraArgs: string[] = []): RunResult {
  //#given the checker runs against a fixture repo, with typecheck stubbed out
  try {
    const stdout = execFileSync(
      "bash",
      [SCRIPT, "--root", root, "--file", join(root, "script", "dead-symbols.txt"), ...extraArgs],
      {
        encoding: "utf8",
        env: { ...process.env, DEAD_SYMBOLS_SKIP_TYPECHECK: "1" },
      },
    )
    return { status: 0, stdout, stderr: "" }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    return {
      status: failure.status ?? 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    }
  }
}

describe("check-dead-symbols.sh", () => {
  test("(a) DELETE passes when only a same-named local remains outside the proof scope", () => {
    //#given declaration removed, no imports, but a namesake local lives elsewhere
    const root = makeRepo({
      files: {
        "src/decl.ts": "export const unrelated = 1\n",
        "src/other.ts": "const foo = 2\nexport { foo }\n",
      },
      rows: ["foo|src/decl.ts|DELETE|declaration and imports removed|src/decl.ts|declaration"],
    })

    //#when the checker runs
    const result = runChecker(root)

    //#then the local namesake is not a consumer and the DELETE row passes
    expect(result.status).toBe(0)
  })

  test("(b) DELETE passes when only prose or comment mentions remain", () => {
    //#given the symbol survives only in comments and string prose
    const root = makeRepo({
      files: {
        "src/decl.ts": "export const unrelated = 1\n",
        "src/notes.ts": '// foo is documented here\nexport const note = "foo"\n',
      },
      rows: ["foo|src/decl.ts|DELETE|declaration and imports removed|src/decl.ts|declaration"],
    })

    //#when the checker runs
    const result = runChecker(root)

    //#then prose mentions are not consumers
    expect(result.status).toBe(0)
  })

  test("(c) DELETE fails when a real import remains", () => {
    //#given a source module still imports the symbol
    const root = makeRepo({
      files: {
        "src/decl.ts": "export const unrelated = 1\n",
        "src/use.ts": 'import { foo } from "./decl"\nexport const use = foo\n',
      },
      rows: ["foo|src/decl.ts|DELETE|declaration and imports removed|src/decl.ts|declaration"],
    })

    //#when the checker runs
    const result = runChecker(root)

    //#then the import check flags the row
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("import")
  })

  test("(d) DELETE fails when the declaration remains", () => {
    //#given the declaring file still declares the symbol
    const root = makeRepo({
      files: { "src/decl.ts": "export const foo = 1\n" },
      rows: ["foo|src/decl.ts|DELETE|declaration and imports removed|src/decl.ts|declaration"],
    })

    //#when the checker runs
    const result = runChecker(root)

    //#then the declaration check flags the row
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("declaration")
  })

  test("(e) KEEP fails when no consumer is named", () => {
    //#given a KEEP row whose evidence names no import, pin, or call site
    const root = makeRepo({
      files: { "src/decl.ts": "export const foo = 1\n" },
      rows: ["foo|src/decl.ts|KEEP|no consumer known|—|declaration"],
    })

    //#when the checker runs
    const result = runChecker(root)

    //#then the KEEP consumer rule fails the row
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("consumer")
  })

  test("(f) DELETE row missing proof-scope fails", () => {
    //#given a DELETE row with an empty proof-scope column
    const root = makeRepo({
      files: { "src/decl.ts": "export const unrelated = 1\n" },
      rows: ["foo|src/decl.ts|DELETE|declaration removed||declaration"],
    })

    //#when the checker runs
    const result = runChecker(root)

    //#then the schema rule rejects the row
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("proof-scope")
  })

  test("(g) readSrc assertion in a different statement is not a consumer", () => {
    //#given a readSrc pin whose assertion lives on a separate statement
    const root = makeRepo({
      files: {
        "src/decl.ts": "export const unrelated = 1\n",
        "tests/pinned.test.ts": [
          'const source = readSrc("src/decl.ts")',
          "expect(source).toMatch(/foo/)",
          "",
        ].join("\n"),
      },
      rows: ["foo|src/decl.ts|DELETE|declaration and imports removed|src/decl.ts|declaration"],
    })

    //#when the checker runs
    const result = runChecker(root)

    //#then the different-statement pin does not block deletion
    expect(result.status).toBe(0)
  })

  test("(g) readSrc same-statement pin is a consumer and blocks DELETE", () => {
    //#given a same-statement readSrc assertion
    const root = makeRepo({
      files: {
        "src/decl.ts": "export const unrelated = 1\n",
        "tests/pinned.test.ts": 'expect(readSrc("src/decl.ts")).toMatch(/foo/)\n',
      },
      rows: ["foo|src/decl.ts|DELETE|declaration and imports removed|src/decl.ts|declaration"],
    })

    //#when the checker runs
    const result = runChecker(root)

    //#then the pin is a consumer
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("readSrc")
  })

  test("(h) method row fails when the method remains", () => {
    //#given a class method that still exists in the proof scope
    const root = makeRepo({
      files: {
        "src/decl.ts": "export class Store {\n  getFoo(): number {\n    return 1\n  }\n}\n",
      },
      rows: ["getFoo|src/decl.ts|DELETE|method removed|src/decl.ts|method"],
    })

    //#when the checker runs
    const result = runChecker(root)

    //#then the method check flags the row
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("declaration")
  })

  test("(i) KEEP row with an em-dash proof-scope passes --inventory", () => {
    //#given a KEEP row whose declaring file is not yet known
    const root = makeRepo({
      files: { "src/decl.ts": "export const foo = 1\n" },
      rows: ["foo|src/decl.ts|KEEP|consumer: tests/foo.test.ts:12|—|declaration"],
    })

    //#when inventory mode runs
    const result = runChecker(root, ["--inventory"])

    //#then it prints the row and exits successfully
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("foo")
    expect(result.stdout).toContain("KEEP")
    expect(result.stdout).toContain("—")
  })

  test("(j) two rows sharing a symbol but differing in path are evaluated independently", () => {
    //#given one declaration remains in src/a.ts while src/b.ts is clean
    const root = makeRepo({
      files: {
        "src/a.ts": "export const dup = 1\n",
        "src/b.ts": "export const other = 2\n",
      },
      rows: [
        "dup|src/a.ts|DELETE|declaration removed|src/a.ts|declaration",
        "dup|src/b.ts|DELETE|declaration removed|src/b.ts|declaration",
      ],
    })

    //#when the checker runs
    const result = runChecker(root)

    //#then only the row whose proof scope still declares the symbol is reported
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("src/a.ts")
    expect(result.stderr).not.toContain("src/b.ts")
  })
  test("(k) const row-kind passes the declaration check when the declaration is gone", () => {
    //#given a DELETE row marked const with no surviving declaration
    const root = makeRepo({
      files: { "src/consts.ts": "export const OTHER = 1\n" },
      rows: ["DEAD_CONST|src/consts.ts|DELETE|declaration removed|src/consts.ts|const"],
    })

    //#when the checker runs
    const result = runChecker(root)

    //#then the const alias uses the declaration check and reports no unknown row-kind
    expect(result.status).toBe(0)
    expect(result.stderr).not.toContain("unknown row-kind")
  })

  test("(l) const row-kind fails the declaration check when the declaration remains", () => {
    //#given a DELETE row marked const whose declaration still exists
    const root = makeRepo({
      files: { "src/consts.ts": "export const DEAD_CONST = 1\n" },
      rows: ["DEAD_CONST|src/consts.ts|DELETE|declaration removed|src/consts.ts|const"],
    })

    //#when the checker runs
    const result = runChecker(root)

    //#then the declaration check flags it without an unknown row-kind finding
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("declaration remains")
    expect(result.stderr).not.toContain("unknown row-kind")
  })
})

describe("script metadata", () => {
  test("checker never uses git grep -w", () => {
    //#given the checker script on disk
    const script = readFileSync(SCRIPT, "utf8")

    //#when inspecting its grep invocations
    const usesWordRegex = /git grep[^\n]*\s-w(\s|$)/.test(script)

    //#then the banned tree-wide word flag is absent
    expect(usesWordRegex).toBe(false)
  })
})
