// Shared runtime for the uiux skill-pack tools.
//
// Every pack interaction is one short-lived Python subprocess. This module
// owns argv assembly, the environment, the timeout and the stdout cap so the
// individual tools (search / design system / validate) only translate results.
import { pythonEnv } from "./python"
import type {
  PackScriptRequest,
  PackScriptResult,
  SpawnFn,
  SpawnResult,
  UiuxToolDeps,
  UiuxToolError,
  UiuxToolErrorCode,
} from "./types"

/** Builds the failure result shared by every uiux tool. */
export function formatToolError(code: UiuxToolErrorCode, message: string): UiuxToolError {
  return { ok: false, error: code, message }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Runs one pack script under the deps' cwd/env/timeout. Never throws: spawn
 * rejection, signal death, timeout and non-zero exit all become data.
 */
export async function runPackScript(
  deps: UiuxToolDeps,
  request: PackScriptRequest,
): Promise<PackScriptResult> {
  const argv = [deps.pythonBin, request.script, ...(request.args ?? [])]
  const spawn = deps.spawn ?? defaultSpawn

  let result: SpawnResult
  try {
    result = await spawn(argv, {
      cwd: deps.coreSkillRoot,
      env: pythonEnv(process.env),
      timeoutMs: deps.timeoutMs,
    })
  } catch (error) {
    return {
      ...formatToolError("spawn_failed", `Failed to run ${request.script}`),
      detail: errorMessage(error),
    }
  }

  if (result.timedOut) {
    return formatToolError(
      "timeout",
      `${request.script} timed out after ${deps.timeoutMs}ms`,
    )
  }

  if (result.code === null) {
    return {
      ...formatToolError("spawn_failed", `${request.script} terminated without an exit code`),
      detail: result.stderr.trim() || undefined,
    }
  }

  if (result.code !== 0) {
    return {
      ...formatToolError("nonzero_exit", `${request.script} exited with code ${result.code}`),
      detail: result.stderr.trim() || result.stdout.trim() || undefined,
    }
  }

  const capped = capStdout(result.stdout, deps.maxStdoutBytes)
  return { ok: true, stdout: capped.stdout, truncated: capped.truncated, code: result.code }
}

/**
 * Cuts `stdout` to `maxBytes` of UTF-8 and marks the cut. The marker is
 * appended beyond the cap so the captured payload stays exactly `maxBytes`.
 */
function capStdout(stdout: string, maxBytes: number): { stdout: string; truncated: boolean } {
  const buffer = Buffer.from(stdout, "utf8")
  if (buffer.byteLength <= maxBytes) return { stdout, truncated: false }

  // Decoding a sliced buffer can end inside a multi-byte character, which
  // surfaces as a trailing U+FFFD. Drop it rather than emitting mojibake.
  const head = buffer.subarray(0, maxBytes).toString("utf8").replace(/\uFFFD+$/, "")
  return {
    stdout: `${head}\n[truncated: output exceeded ${maxBytes} bytes]`,
    truncated: true,
  }
}

/**
 * Default `SpawnFn` over `Bun.spawn`. Bun has no native spawn timeout, so the
 * exit promise races a timer; on expiry the child is killed and the run is
 * reported as `timedOut`.
 */
const defaultSpawn: SpawnFn = async (argv, options) => {
  const proc = Bun.spawn(argv, {
    cwd: options.cwd,
    env: options.env,
    stdout: "pipe",
    stderr: "pipe",
  })

  const stdoutStream = proc.stdout
  const stderrStream = proc.stderr
  const stdoutPromise = new Response(stdoutStream).text()
  const stderrPromise = new Response(stderrStream).text()

  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), options.timeoutMs)
  })

  const outcome = await Promise.race([
    proc.exited.then(() => "exit" as const),
    timedOut,
  ])

  if (outcome === "timeout") {
    proc.kill()
    const [stdout, stderr] = await Promise.all([
      stdoutPromise.catch(() => ""),
      stderrPromise.catch(() => ""),
    ])
    return { code: null, stdout, stderr, timedOut: true }
  }

  if (timer) clearTimeout(timer)
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])
  return { code: proc.exitCode, stdout, stderr }
}
