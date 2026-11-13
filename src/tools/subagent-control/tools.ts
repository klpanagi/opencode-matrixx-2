import { z } from "zod"
import { defineTool, type MatrixxToolDefinition } from "../../shared/tool/define-tool"
import {
  DEFAULT_SUBAGENT_WAIT_TIMEOUT_MS,
  MAX_SUBAGENT_WAIT_TIMEOUT_MS,
  SUBAGENT_CONTROL_DESCRIPTION,
  SUBAGENT_CONTROL_NAME,
} from "./constants"
import type { SubagentControlArgs, SubagentControlClient } from "./types"

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "")
}

function readPointer(sessionID: string): string {
  return `Read its output with session_read (session_id="${sessionID}"); a background completion also injects a <subagent> message into this parent session automatically.`
}

function clampTimeout(timeout: number | undefined): number {
  if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0) {
    return DEFAULT_SUBAGENT_WAIT_TIMEOUT_MS
  }
  return Math.min(timeout, MAX_SUBAGENT_WAIT_TIMEOUT_MS)
}

function sleep(ms: number): Promise<"timeout"> {
  return new Promise((resolve) => {
    setTimeout(() => resolve("timeout"), ms)
  })
}

export function createSubagentControl(client: SubagentControlClient): MatrixxToolDefinition {
  const cancelled = new Set<string>()

  return defineTool(SUBAGENT_CONTROL_NAME, {
    description: SUBAGENT_CONTROL_DESCRIPTION,
    args: {
      action: z.enum(["cancel", "wait"]).describe("Control action: cancel interrupts the child session, wait blocks until it goes idle"),
      session_id: z.string().describe("Native child sessionID returned by the subagent tool"),
      timeout: z.number().optional().describe("Max wait time in ms (default: 60000, max: 600000). wait only."),
    },
    async execute(args: SubagentControlArgs) {
      const sessionID = (args.session_id ?? "").trim()
      if (sessionID === "") {
        return `[ERROR] Invalid arguments: session_id must be a non-empty child sessionID.`
      }

      if (args.action === "cancel") {
        if (cancelled.has(sessionID)) {
          return `[ERROR] Subagent session ${sessionID} was already cancelled via subagent_control. ${readPointer(sessionID)}`
        }
        try {
          await client.session.interrupt({ sessionID })
        } catch (error) {
          return `[ERROR] Failed to cancel subagent session ${sessionID}: ${errorMessage(error)}`
        }
        cancelled.add(sessionID)
        return `Subagent session ${sessionID} cancelled via session interrupt. ${readPointer(sessionID)}`
      }

      try {
        await client.session.get({ sessionID })
      } catch (error) {
        return `[ERROR] Subagent session not found: ${sessionID}: ${errorMessage(error)}`
      }
      const timeoutMs = clampTimeout(args.timeout)
      const outcome = await Promise.race([client.session.wait({ sessionID }), sleep(timeoutMs)])
      if (outcome === "timeout") {
        return `Subagent session ${sessionID} is still running after ${timeoutMs}ms. This wait is a bounded gate: do not poll — read the transcript with \`session_read(session_id=...)\` if you need it, or cancel it; do not refire the subagent. ${readPointer(sessionID)}`
      }
      return `Subagent session ${sessionID} finished. ${readPointer(sessionID)}`
    },
  })
}
