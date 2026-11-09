/// <reference types="bun-types" />
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ManagerStore } from "../../../../src/features/background-agent/manager/store"
import type { ManagerRuntime } from "../../../../src/features/background-agent/manager/types"
import { TaskHistory } from "../../../../src/features/background-agent/task-history"
import type { NativeDomains } from "../../../../src/shared/session/session-context-source"
import { createFakeClock, type FakeClock } from "./fake-clock"

export interface ManagerRuntimeFixtureOptions {
  directory?: string
  config?: ManagerRuntime["config"]
  effortConfig?: ManagerRuntime["effortConfig"]
  native?: ManagerRuntime["native"]
  taskHistory?: TaskHistory
  clock?: FakeClock
}

export interface ManagerRuntimeFixture extends ManagerRuntime {
  readonly clock: FakeClock
  dispose(): void
}

export interface NotificationRecorder {
  readonly calls: unknown[]
  dispose(): void
}

function createNoopNative(): NativeDomains {
  const ok = async () => ({})
  return {
    session: {
      context: async () => ({ messages: [{ type: "assistant", content: [{ type: "text", text: "harness output" }] }] }),
      get: ok,
      list: ok,
      create: async () => ({ id: "ses_harness" }),
      prompt: ok,
      interrupt: ok,
      compact: ok,
      switchAgent: ok,
      switchModel: ok,
      wait: ok,
    },
    agent: { list: async () => [] },
    model: { list: async () => [] },
  }
}

export function createManagerRuntime(
  options: ManagerRuntimeFixtureOptions = {},
): ManagerRuntimeFixture {
  const clock = options.clock ?? createFakeClock()
  const ownsDirectory = options.directory === undefined
  const directory = options.directory ?? mkdtempSync(join(tmpdir(), "mx-manager-runtime-"))

  return {
    store: new ManagerStore(directory, options.config),
    native: options.native ?? createNoopNative(),
    directory,
    config: options.config,
    effortConfig: options.effortConfig,
    taskHistory: options.taskHistory ?? new TaskHistory(),
    now: () => clock.now(),
    timers: {
      setTimeout: (callback, delayMs) => clock.setTimeout(callback, delayMs),
      clearTimeout: (handle) => clock.clearTimeout(handle),
    },
    clock,
    dispose(): void {
      if (ownsDirectory) rmSync(directory, { recursive: true, force: true })
    },
  }
}

export function recordNotifications(runtime: ManagerRuntime): NotificationRecorder {
  const calls: unknown[] = []
  const previous = runtime.notify
  runtime.notify = (payload) => {
    calls.push(payload)
    return previous?.(payload)
  }
  return {
    calls,
    dispose(): void {
      runtime.notify = previous
    },
  }
}
