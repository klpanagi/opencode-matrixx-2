import { log } from "../../shared/runtime/logger"
import { TMUX_PROBE_TIMEOUT_MS } from "../../shared/tmux/constants"

let tmuxPath: string | null = null
let initPromise: Promise<string | null> | null = null

async function findTmuxPath(): Promise<string | null> {
  const isWindows = process.platform === "win32"
  const cmd = isWindows ? "where" : "which"

  try {
    let path: string | null = null
    {
      const proc = Bun.spawn([cmd, "tmux"], {
        stdout: "pipe",
        stderr: "pipe",
      })

      let probeTimer: ReturnType<typeof setTimeout> | undefined
      const probeTimeout = new Promise<never>((_, reject) => {
        probeTimer = setTimeout(() => {
          proc.kill()
          reject(new Error("tmux path probe timed out"))
        }, TMUX_PROBE_TIMEOUT_MS)
      })

      let exitCode: number
      try {
        exitCode = await Promise.race([proc.exited, probeTimeout])
      } catch {
        log(
          `[interactive-bash] ${cmd} tmux probe timed out after ${TMUX_PROBE_TIMEOUT_MS}ms`,
        )
        return null
      } finally {
        clearTimeout(probeTimer)
      }

      if (exitCode !== 0) {
        return null
      }

      const stdout = await new Response(proc.stdout).text()
      path = stdout.trim().split("\n")[0] || null
    }

    if (!path) {
      return null
    }

    {
      const proc = Bun.spawn([path, "-V"], {
        stdout: "pipe",
        stderr: "pipe",
      })

      let verifyTimer: ReturnType<typeof setTimeout> | undefined
      const verifyTimeout = new Promise<never>((_, reject) => {
        verifyTimer = setTimeout(() => {
          proc.kill()
          reject(new Error("tmux version probe timed out"))
        }, TMUX_PROBE_TIMEOUT_MS)
      })

      let verifyExitCode: number
      try {
        verifyExitCode = await Promise.race([proc.exited, verifyTimeout])
      } catch {
        log(
          `[interactive-bash] tmux -V probe timed out after ${TMUX_PROBE_TIMEOUT_MS}ms`,
        )
        return null
      } finally {
        clearTimeout(verifyTimer)
      }

      if (verifyExitCode !== 0) {
        return null
      }
    }

    return path
  } catch {
    return null
  }
}

export async function getTmuxPath(): Promise<string | null> {
  if (tmuxPath !== null) {
    return tmuxPath
  }

  if (initPromise) {
    return initPromise
  }

  initPromise = (async () => {
    const path = await findTmuxPath()
    if (path !== null) {
      tmuxPath = path
    }
    initPromise = null
    return path
  })()

  return initPromise
}

export function getCachedTmuxPath(): string | null {
  return tmuxPath
}

export function resetTmuxPathCache(): void {
  tmuxPath = null
  initPromise = null
}

export function startBackgroundCheck(): void {
  if (!initPromise) {
    initPromise = getTmuxPath()
    initPromise.catch((err) => { log("[interactive-bash] Background tmux path resolution failed:", err) })
  }
}
