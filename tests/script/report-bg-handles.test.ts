/// <reference types="bun-types" />
import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const SCRIPT = join(import.meta.dir, "../../script/report-bg-handles.sh")

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

type RunResult = { status: number; stdout: string; stderr: string }

function runReporter(root: string): RunResult {
  //#given the reporter runs against a fixture repo
  try {
    const stdout = execFileSync("bash", [SCRIPT, "--root", root], { encoding: "utf8" })
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

function makeRepo(handleFiles: Record<string, string> | null): string {
  //#given a throwaway git repository with an optional seeded handle directory
  const root = mkdtempSync(join(tmpdir(), "report-bg-handles-"))
  tempDirs.push(root)
  if (handleFiles !== null) {
    const handleDir = join(root, ".matrixx", "bg-handles")
    mkdirSync(handleDir, { recursive: true })
    for (const [name, content] of Object.entries(handleFiles)) {
      writeFileSync(join(handleDir, name), content)
    }
  }
  execFileSync("git", ["init", "-q"], { cwd: root })
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root })
  execFileSync("git", ["config", "user.name", "test"], { cwd: root })
  execFileSync("git", ["add", "-A"], { cwd: root })
  execFileSync("git", ["commit", "-qm", "fixture", "--allow-empty"], { cwd: root })
  return root
}

function gitStatus(root: string): string {
  return execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" })
}

function gitHead(root: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
}

function parseBaseline(stdout: string): { count: string; head: string } {
  //#given the reporter's two-line stdout
  const lines = stdout.trim().split("\n")
  const count = lines.find((line) => line.startsWith("count="))?.slice("count=".length)
  const head = lines.find((line) => line.startsWith("head="))?.slice("head=".length)
  return { count: count ?? "", head: head ?? "" }
}

describe("report-bg-handles.sh", () => {
  test("counts only bg_*.json handle files", () => {
    //#given a handle dir mixing handles, tombstones and unrelated files
    const root = makeRepo({
      "bg_alpha.json": '{"taskId":"alpha"}\n',
      "bg_beta.json": '{"taskId":"beta"}\n',
      "alpha.gen": "1\n",
      "bg_gamma.txt": "not a json handle\n",
      "notes.json": "{}\n",
    })

    //#when running the reporter
    const result = runReporter(root)

    //#then only the two bg_*.json files are counted
    expect(result.status).toBe(0)
    expect(parseBaseline(result.stdout).count).toBe("2")
  })

  test("reports the repository HEAD sha", () => {
    //#given a fixture repo
    const root = makeRepo({ "bg_alpha.json": "{}\n" })

    //#when running the reporter
    const result = runReporter(root)

    //#then head equals git rev-parse HEAD and is a 40-hex sha
    expect(result.status).toBe(0)
    const head = parseBaseline(result.stdout).head
    expect(head).toBe(gitHead(root))
    expect(head).toMatch(/^[0-9a-f]{40}$/)
  })

  test("does not modify the working tree", () => {
    //#given a clean fixture repo
    const root = makeRepo({ "bg_alpha.json": "{}\n" })
    const before = gitStatus(root)

    //#when running the reporter
    runReporter(root)

    //#then git status is unchanged
    expect(gitStatus(root)).toBe(before)
  })

  test("reports count=0 when the handle directory is absent", () => {
    //#given a repo with no .matrixx/bg-handles directory
    const root = makeRepo(null)

    //#when running the reporter
    const result = runReporter(root)

    //#then the count is zero
    expect(result.status).toBe(0)
    expect(parseBaseline(result.stdout).count).toBe("0")
  })
})
