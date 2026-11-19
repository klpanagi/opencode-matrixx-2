import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"

describe("CLI module exports", () => {
  test("main function is exported", async () => {
    const cli = await import("../../src/cli/index")
    expect(cli.main).toBeDefined()
    expect(typeof cli.main).toBe("function")
  })
})

describe("CLI skill command", () => {
  test("runSkillCommand is exported from the skill module", async () => {
    const skill = await import("../../src/cli/skill/index")
    expect(typeof skill.runSkillCommand).toBe("function")
  })

  test("runSkillCommand returns a usage exit code without exiting the process", async () => {
    const { runSkillCommand } = await import("../../src/cli/skill/index")
    //#given a bogus skill subcommand
    //#when dispatching it with silent sinks
    const code = await runSkillCommand(["bogus"], { stdout: () => {}, stderr: () => {} })

    //#then the caller receives exit code 2
    expect(code).toBe(2)
  })

  test("main dispatches the skill command and exits 0 for an empty list", () => {
    //#given an empty packs root
    const root = mkdtempSync(path.join(tmpdir(), "matrixx-cli-skill-"))
    try {
      //#when running the CLI as a subprocess
      const result = Bun.spawnSync({
        cmd: [process.execPath, "src/cli/index.ts", "skill", "list", "--root", root],
        cwd: path.resolve(import.meta.dir, "../.."),
        stdout: "pipe",
        stderr: "pipe",
      })

      //#then the wired command succeeds and prints the hint
      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain("No skill packs installed")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
