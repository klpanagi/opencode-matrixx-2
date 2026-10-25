import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createSilentFailureGuardHook } from "../../../src/hooks/silent-failure-guard"

type GuardHook = ReturnType<typeof createSilentFailureGuardHook>

describe("silent-failure-guard", () => {
  let tempDir: string
  let hook: GuardHook

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "silent-failure-guard-"))
    hook = createSilentFailureGuardHook({ directory: tempDir } as never)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  function writeFile(relPath: string, content: string): string {
    const fullPath = join(tempDir, relPath)
    mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, content)
    return fullPath
  }

  function editOutput(title: string, filePath: string, body = "ok") {
    return { title, output: body, metadata: { filePath } }
  }

  test("flags a `except: pass` in a finance Python edit", async () => {
    //#given
    const filePath = writeFile("price_publisher/feed.py", "def run():\n    try:\n        tick()\n    except:\n        pass\n")
    const output = editOutput(filePath, filePath)

    //#when
    await hook["tool.execute.after"]({ tool: "edit", sessionID: "ses_1", callID: "call_1" }, output)

    //#then
    expect(output.output).toContain("silent-failure-guard")
    expect(output.output).toContain("SF001")
  })

  test("is a no-op for a non-Python finance file", async () => {
    //#given
    const filePath = writeFile("recorder/writer.ts", "try {\n} catch {}\n")
    const output = editOutput(filePath, filePath)

    //#when
    await hook["tool.execute.after"]({ tool: "edit", sessionID: "ses_1", callID: "call_1" }, output)

    //#then
    expect(output.output).toBe("ok")
  })

  test("is a no-op for a Python file outside the finance path set", async () => {
    //#given
    const filePath = writeFile("src/util.py", "def run():\n    try:\n        tick()\n    except:\n        pass\n")
    const output = editOutput(filePath, filePath)

    //#when
    await hook["tool.execute.after"]({ tool: "edit", sessionID: "ses_1", callID: "call_1" }, output)

    //#then
    expect(output.output).toBe("ok")
  })

  test("is a no-op for non-write/edit tools", async () => {
    //#given
    const filePath = writeFile("pipeline/run.py", "def run():\n    try:\n        tick()\n    except:\n        pass\n")
    const output = editOutput(filePath, filePath)

    //#when
    await hook["tool.execute.after"]({ tool: "read", sessionID: "ses_1", callID: "call_1" }, output)

    //#then
    expect(output.output).toBe("ok")
  })
})
