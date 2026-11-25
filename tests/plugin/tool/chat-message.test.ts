/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"

import type { MatrixxConfig } from "../../../src/config"
import type { DomainHooks } from "../../../src/plugin/setup-domains"
import { createChatMessageHandler } from "../../../src/plugin/tool/chat-message"
import type { MatrixxContext } from "../../../src/plugin/tool/context"

type ChatMessageInput = {
  sessionID: string
  agent?: string
  model?: { providerID: string; modelID: string }
}
type ChatMessageOutput = {
  message: Record<string, unknown>
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>
}
type Stub = (input: ChatMessageInput, output: ChatMessageOutput) => Promise<void>

// The prompt/state mutators, in the order they have always run in. Each one
// reads `parts` and folds content into it, so they can never overlap.
const PROMPT_CHAIN = [
  "inputSecretGuard",
  "keywordDetector",
  "autoSlashCommand",
  "startWork",
  "designIntentPreserver",
] as const

// Side-effect-only hooks: they never touch `output.parts`, so they may overlap
// with each other and with the prompt chain.
const OBSERVERS = ["stopContinuationGuard", "runtimeFallback"] as const

const ALL_HOOKS = [...PROMPT_CHAIN, ...OBSERVERS] as const

function buildHooks(behaviours: Partial<Record<string, Stub>> = {}): DomainHooks {
  const hooks: Record<string, { "chat.message": Stub }> = {}
  for (const name of ALL_HOOKS) {
    hooks[name] = { "chat.message": behaviours[name] ?? (async () => {}) }
  }
  return hooks as unknown as DomainHooks
}

function createHandler(hooks: DomainHooks) {
  return createChatMessageHandler({
    ctx: {} as unknown as MatrixxContext,
    pluginConfig: {} as MatrixxConfig,
    firstMessageVariantGate: {
      shouldOverride: () => false,
      markApplied: () => {},
    },
    hooks,
  })
}

function createInput(): ChatMessageInput {
  return { sessionID: "ses_chat_wave" }
}

function createOutput(text = "base"): ChatMessageOutput {
  return { message: {}, parts: [{ type: "text", text }] }
}

describe("createChatMessageHandler - read-only observer wave", () => {
  test("prompt mutators run sequentially in the documented order", async () => {
    //#given every mutator records itself and how many mutators are in flight
    const order: string[] = []
    let activeMutators = 0
    let peakMutators = 0
    const behaviours: Partial<Record<string, Stub>> = {}
    for (const name of PROMPT_CHAIN) {
      behaviours[name] = async () => {
        order.push(name)
        activeMutators++
        peakMutators = Math.max(peakMutators, activeMutators)
        await Promise.resolve()
        activeMutators--
      }
    }
    const handler = createHandler(buildHooks(behaviours))

    //#when the handler processes a message
    await handler(createInput(), createOutput())

    //#then the mutators ran in order, one at a time
    expect(order).toEqual([...PROMPT_CHAIN])
    expect(peakMutators).toBe(1)
  })

  test("observers overlap with each other and with the prompt chain", async () => {
    //#given observers that stay in flight for two microtasks while mutators do the same
    let activeObservers = 0
    let peakObservers = 0
    let activeMutators = 0
    let sawObserverDuringMutator = false
    const behaviours: Partial<Record<string, Stub>> = {}
    for (const name of OBSERVERS) {
      behaviours[name] = async () => {
        activeObservers++
        peakObservers = Math.max(peakObservers, activeObservers)
        await Promise.resolve()
        if (activeMutators > 0) sawObserverDuringMutator = true
        await Promise.resolve()
        activeObservers--
      }
    }
    for (const name of PROMPT_CHAIN) {
      behaviours[name] = async () => {
        activeMutators++
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
        activeMutators--
      }
    }
    const handler = createHandler(buildHooks(behaviours))

    //#when the handler processes a message
    await handler(createInput(), createOutput())

    //#then both observers were in flight at once, and overlapped the chain
    expect(peakObservers).toBe(OBSERVERS.length)
    expect(sawObserverDuringMutator).toBe(true)
  })

  test("mutations keep their order when observer work interleaves", async () => {
    //#given every hook awaits once and then prepends its name to the prompt
    const behaviours: Partial<Record<string, Stub>> = {}
    for (const name of ALL_HOOKS) {
      behaviours[name] = async (_input, output) => {
        await Promise.resolve()
        if (name === "stopContinuationGuard") return
        if (name === "runtimeFallback") {
          output.message.model = { providerID: "fallback", modelID: "model" }
          return
        }
        const part = output.parts[0]
        if (part) part.text = `${name};${part.text}`
      }
    }
    const handler = createHandler(buildHooks(behaviours))
    const output = createOutput()

    //#when the handler processes a message
    await handler(createInput(), output)

    //#then the prompt chain's prepends nest exactly in the documented order
    expect(output.parts[0]?.text).toBe(
      "designIntentPreserver;startWork;autoSlashCommand;keywordDetector;inputSecretGuard;base",
    )
    //#then the observer's disjoint message write still landed
    expect(output.message.model).toEqual({ providerID: "fallback", modelID: "model" })
  })

  test("a rejecting observer is isolated from the chain and its sibling", async () => {
    //#given the stop-continuation observer rejects while everything else runs
    const ran: string[] = []
    const behaviours: Partial<Record<string, Stub>> = {
      stopContinuationGuard: async () => {
        ran.push("stopContinuationGuard")
        throw new Error("observer exploded")
      },
      runtimeFallback: async (_input, output) => {
        ran.push("runtimeFallback")
        output.message.model = { providerID: "fallback", modelID: "model" }
      },
    }
    for (const name of PROMPT_CHAIN) {
      behaviours[name] = async () => {
        ran.push(name)
      }
    }
    const handler = createHandler(buildHooks(behaviours))
    const output = createOutput()

    //#when the handler processes a message
    const run = handler(createInput(), output)

    //#then the rejection was absorbed and every other hook still ran
    await expect(run).resolves.toBeUndefined()
    expect(ran).toContain("runtimeFallback")
    for (const name of PROMPT_CHAIN) expect(ran).toContain(name)
    expect(output.message.model).toEqual({ providerID: "fallback", modelID: "model" })
  })

  test("disabled hooks are skipped without breaking the chain", async () => {
    //#given a hook set that only carries the observers
    const hooks = {
      stopContinuationGuard: { "chat.message": async () => {} },
      runtimeFallback: { "chat.message": async () => {} },
    } as unknown as DomainHooks
    const handler = createHandler(hooks)

    //#when the handler processes a message
    const run = handler(createInput(), createOutput())

    //#then it resolves without touching any absent hook
    await expect(run).resolves.toBeUndefined()
  })
})
