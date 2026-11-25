import { describe, expect, test } from "bun:test"
import { CommandNotAllowedError, createExecuteCommand } from "../../../src/shared/command-executor/execute-command"

type FakeResult = { stdout?: string; stderr?: string }

function makeExecImpl(result?: FakeResult, error?: Error & FakeResult) {
  const calls: Array<{ command: string; options: { timeout: number } }> = []
  const execImpl = (command: string, options: { timeout: number }): Promise<FakeResult> => {
    calls.push({ command, options })
    if (error) return Promise.reject(error)
    return Promise.resolve(result ?? { stdout: "", stderr: "" })
  }
  return { execImpl, calls }
}

describe("executeCommand", () => {
  test("throws CommandNotAllowedError unless allowShell is true", async () => {
    //#given an exec seam and options without allowShell
    const { execImpl, calls } = makeExecImpl({ stdout: "nope" })
    const run = createExecuteCommand(execImpl)

    //#when executing without allowShell
    const rejection = run("ls", {}).catch((e: unknown) => e)

    //#then it rejects with CommandNotAllowedError and never touches the seam
    const err = await rejection
    expect(err).toBeInstanceOf(CommandNotAllowedError)
    expect((err as Error).name).toBe("CommandNotAllowedError")
    expect(calls).toHaveLength(0)
  })

  test("runs the command when allowShell is true and forwards the timeout", async () => {
    //#given allowShell true and a custom timeout
    const { execImpl, calls } = makeExecImpl({ stdout: "  hello  " })
    const run = createExecuteCommand(execImpl)

    //#when executing
    const out = await run("ls", { allowShell: true, timeoutMs: 1234 })

    //#then the trimmed stdout is returned and the timeout reached the seam
    expect(out).toBe("hello")
    expect(calls).toEqual([{ command: "ls", options: { timeout: 1234 } }])
  })

  test("redacts secrets in stderr on the success path", async () => {
    //#given a successful run whose stderr carries a labelled credential
    const { execImpl } = makeExecImpl({ stdout: "ok", stderr: "token: supersecret123" })
    const run = createExecuteCommand(execImpl)

    //#when composing the output
    const out = await run("env", { allowShell: true })

    //#then the credential is redacted inside the stderr marker
    expect(out).toBe("ok\n[stderr: token: [REDACTED]]")
    expect(out).not.toContain("supersecret123")
  })

  test("redacts secrets in stderr and e.message on the error path", async () => {
    //#given a rejected run carrying a secret in stderr and in the message
    const { execImpl } = makeExecImpl(undefined, {
      name: "ExecError",
      message: "Command failed: password=hunter2",
      stderr: "npm_abcdefghijklmnopqrstuvwx",
    } as Error & FakeResult)
    const run = createExecuteCommand(execImpl)

    //#when composing the output from the error
    const out = await run("boom", { allowShell: true })

    //#then neither secret survives
    expect(out).toBe("[stderr: [REDACTED]]")
    expect(out).not.toContain("hunter2")
    expect(out).not.toContain("npm_abcdefghijklmnopqrstuvwx")
  })

  test("truncates oversized stdout with a […truncated] suffix", async () => {
    //#given stdout larger than 32 KiB
    const oversized = "x".repeat(32 * 1024 + 100)
    const { execImpl } = makeExecImpl({ stdout: oversized })
    const run = createExecuteCommand(execImpl)

    //#when composing the output
    const out = await run("cat big", { allowShell: true })

    //#then exactly 32 KiB of stdout survive plus the truncation suffix
    expect(out).toBe("x".repeat(32 * 1024) + "[…truncated]")
  })

  test("does not truncate stdout within the limit", async () => {
    //#given stdout smaller than 32 KiB
    const small = "y".repeat(128)
    const { execImpl } = makeExecImpl({ stdout: small })
    const run = createExecuteCommand(execImpl)

    //#when composing the output
    const out = await run("echo y", { allowShell: true })

    //#then the output is unchanged and carries no suffix
    expect(out).toBe(small)
    expect(out.endsWith("[…truncated]")).toBe(false)
  })
})
