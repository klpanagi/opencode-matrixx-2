/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { BackgroundTaskConfig, MatrixxConfig } from "../../../src/config/schema"
import type { EffortConfig } from "../../../src/config/schema/effort"
import { BackgroundManager } from "../../../src/features/background-agent/manager"
import type { MatrixxContext } from "../../../src/plugin/tool/context"

const CONFIG: EffortConfig = {
  enabled: true,
  report: ["parent"],
  weights: { compute: 0.5, action: 0.25, epistemic: 0.15, coord: 0.1 },
  prices: {
    inputPer1k: 0.003,
    outputPer1k: 0.015,
    cacheReadPer1k: 0.0003,
    cacheWritePer1k: 0.00375,
  },
  toolCosts: {},
  maxMessages: 200,
  maxBytes: 2_097_152,
  rollup: false,
}

const WALLCLOCK_CONFIG = { wallClockTimeoutMs: 10 } as unknown as BackgroundTaskConfig

function assistantMessage(): Record<string, unknown> {
  return {
    type: "assistant",
    info: {
      role: "assistant",
      tokens: {
        input: 10,
        output: 20,
        reasoning: 0,
        cache: { read: 3, write: 4 },
      },
    },
    content: [{ type: "tool", tool: "read" }],
  }
}

function createManager(
  directory: string,
  effort: EffortConfig | undefined,
): { manager: BackgroundManager; contextCalls: () => number } {
  let calls = 0
  const context = async () => {
    calls += 1
    return [assistantMessage()]
  }
  const native = {
    directory,
    session: {
      create: async () => ({ id: "ses_wallclock_1" }),
      prompt: async () => ({}),
      interrupt: async () => ({}),
      context,
    },
    agent: { list: async () => [] },
    model: { list: async () => [] },
  }
  const manager =
    effort === undefined
      ? new BackgroundManager(native as unknown as MatrixxContext, WALLCLOCK_CONFIG)
      : new BackgroundManager(native as unknown as MatrixxContext, WALLCLOCK_CONFIG, {
          pluginConfig: { effort } as unknown as Partial<MatrixxConfig>,
        })
  return { manager, contextCalls: () => calls }
}

async function launchAndWait(manager: BackgroundManager): Promise<void> {
  await manager.launch({
    description: "wall clock effort",
    prompt: "do work",
    agent: "task",
    parentSessionID: "ses_parent",
    parentMessageID: "msg_1",
  })
  await new Promise((resolve) => setTimeout(resolve, 40))
}

describe("agent-effort wiring: wall-clock terminal path", () => {
  let dir: string

  beforeEach(() => {
    //#given
    dir = mkdtempSync(join(tmpdir(), "effort-wallclock-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("wall-clock timeout records effort through the callback", async () => {
    //#given
    const { manager, contextCalls } = createManager(dir, CONFIG)

    //#when
    await launchAndWait(manager)
    const [task] = [...manager.tasks.values()]
    manager.store.wallclock.disarmAll()

    //#then
    expect(task.status).toBe("error")
    expect(task.terminalReason).toBe("wall-clock-timeout")
    expect(contextCalls()).toBeGreaterThan(0)
  })

  test("wall-clock timeout without effort config still errors but never reads session context", async () => {
    //#given
    const { manager, contextCalls } = createManager(dir, undefined)

    //#when
    await launchAndWait(manager)
    const [task] = [...manager.tasks.values()]
    manager.store.wallclock.disarmAll()

    //#then
    expect(task.status).toBe("error")
    expect(task.terminalReason).toBe("wall-clock-timeout")
    expect(contextCalls()).toBe(0)
  })
})
