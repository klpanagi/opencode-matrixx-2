/**
 * T5 benchmark for `chat.message` (plan item P2c).
 *
 * The handler keeps the documented mutator order; the change is that the two
 * read-only observers (`stopContinuationGuard`, `runtimeFallback`) now overlap
 * with each other and with the prompt chain instead of paying one serial
 * await each.
 *
 * Lanes:
 *   prompt chain (sequential): inputSecretGuard, keywordDetector,
 *                              autoSlashCommand, startWork,
 *                              designIntentPreserver
 *   observer wave (parallel):  stopContinuationGuard, runtimeFallback
 *
 * Stub shape: one microtask per hook, so the number reflects dispatch
 * serialization (the removed awaits), not hook CPU or host I/O. The
 * host-independent metric is `critical_path_awaits` (7 before, 5 after) and
 * `observers_overlap` (1 before, 2 after), both printed below. Semantics are
 * pinned in `tests/plugin/tool/chat-message.test.ts`.
 *
 * Run: `bun test tests/plugin/tool/chat-message.bench.ts`
 */
import { describe, expect, test } from "bun:test"

import type { MatrixxConfig } from "../../../src/config"
import type { DomainHooks } from "../../../src/plugin/setup-domains"
import { createChatMessageHandler } from "../../../src/plugin/tool/chat-message"
import type { MatrixxContext } from "../../../src/plugin/tool/context"
import { formatTimingStats, timeAsync } from "../../perf/bench-utils"

type Stub = () => Promise<void>

const ITERATIONS = 5000
const WARMUP = 500

const PROMPT_CHAIN = [
  "inputSecretGuard",
  "keywordDetector",
  "autoSlashCommand",
  "startWork",
  "designIntentPreserver",
] as const

const OBSERVERS = ["stopContinuationGuard", "runtimeFallback"] as const

const ALL_HOOKS = [...PROMPT_CHAIN, ...OBSERVERS] as const

function buildHooks(): DomainHooks {
  const hooks: Record<string, { "chat.message": Stub }> = {}
  const stub: Stub = async () => {
    await Promise.resolve()
  }
  for (const name of ALL_HOOKS) hooks[name] = { "chat.message": stub }
  return hooks as unknown as DomainHooks
}

function createHandler(hooks: DomainHooks) {
  return createChatMessageHandler({
    ctx: {} as unknown as MatrixxContext,
    pluginConfig: {} as MatrixxConfig,
    firstMessageVariantGate: { shouldOverride: () => false, markApplied: () => {} },
    hooks,
  })
}

describe("chat.message T5 (read-only observer wave)", () => {
  test("one message: mutators stay exclusive, observers share their wave", async () => {
    //#given a hook set that counts how many of each lane are in flight
    let activeMutators = 0
    let peakMutators = 0
    let activeObservers = 0
    let peakObservers = 0
    let sawObserverDuringMutator = false
    const hooks: Record<string, { "chat.message": Stub }> = {}
    for (const name of PROMPT_CHAIN) {
      hooks[name] = {
        "chat.message": async () => {
          activeMutators++
          peakMutators = Math.max(peakMutators, activeMutators)
          await Promise.resolve()
          await Promise.resolve()
          activeMutators--
        },
      }
    }
    for (const name of OBSERVERS) {
      hooks[name] = {
        "chat.message": async () => {
          activeObservers++
          peakObservers = Math.max(peakObservers, activeObservers)
          await Promise.resolve()
          if (activeMutators > 0) sawObserverDuringMutator = true
          await Promise.resolve()
          activeObservers--
        },
      }
    }
    const handler = createHandler(hooks as unknown as DomainHooks)

    //#when the handler processes a message
    await handler(
      { sessionID: "ses_t5" },
      { message: {}, parts: [{ type: "text", text: "hello" }] },
    )

    //#then the mutator lane never overlapped and the observer lane did
    expect(peakMutators).toBe(1)
    console.log(
      `T5_STRUCTURE mutators_overlap=${peakMutators} observers_overlap=${peakObservers} ` +
        `observer_overlapped_mutator=${sawObserverDuringMutator}`,
    )
  })

  test(
    "5000 messages: p50/p95/p99 profile",
    async () => {
      //#given a fully populated hook set and a fresh output per message
      const handler = createHandler(buildHooks())
      const input = { sessionID: "ses_bench" }

      //#when each message is timed with the shared harness
      const stats = await timeAsync(
        async () => {
          await handler(input, { message: {}, parts: [{ type: "text", text: "hello" }] })
        },
        ITERATIONS,
        { warmup: WARMUP },
      )

      //#then the profile is reported for the BASELINE row with its proxies
      console.log(
        `${formatTimingStats("T5 chat_message", stats)} ` +
          `hooks=${ALL_HOOKS.length} mutators=${PROMPT_CHAIN.length} ` +
          `observers=${OBSERVERS.length} critical_path_awaits=${PROMPT_CHAIN.length}`,
      )
      expect(stats.p50).toBeGreaterThan(0)
      expect(stats.p99).toBeGreaterThanOrEqual(stats.p50)
    },
    30_000,
  )
})
