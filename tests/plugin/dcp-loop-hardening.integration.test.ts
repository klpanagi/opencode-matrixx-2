/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
/**
 * Local legacy `{info, parts}` shapes (Task 27: the V1 `experimental.chat.messages.transform`
 * fan-out is deleted, so `@opencode-ai/sdk` message types are no longer imported).
 * The live native port operates on flat `Message[]` in `src/plugin/message-hooks/`.
 */
type Message = {
  id?: string
  sessionID?: string
  role?: string
  [key: string]: unknown
}
type Part = {
  type?: string
  text?: string
  [key: string]: unknown
}

import { buildContextDisciplineSection } from "../../src/agents/dynamic-agent-prompt-builder"
import { getModelDirectives } from "../../src/agents/model-directives"
import { createDcpNudgeSanitizerHook } from "../../src/hooks/dcp-nudge-sanitizer/hook"
import { createNudgeLoopBreakerHook } from "../../src/hooks/nudge-loop-breaker/hook"
import { computeBackoffDelay } from "../../src/hooks/nudge-loop-breaker/session-state"
import type { NativePluginContext } from "../../src/shared/session-context-source"

const DEEPSEEK_MODEL = "deepseek/deepseek-v4.1-flash"
const ANTHROPIC_MODEL = "anthropic/claude-sonnet-4"

const NUDGE = "<instruction name=iteration_nudge>use the compress tool on it now</instruction>"
const DSML_ECHO =
  "echo <instruction name=iteration_nudge> use compress now </instruction> </｜DSML｜parameter>"

const SESSION = "ses_integration_loop"

type Activation = { sessionID: string; backoff: number }

type MessageWithParts = { info: Message; parts: Part[] }

function textPart(text: string): Part {
  return { type: "text", text } as unknown as Part
}

function textOf(part: Part): string {
  const candidate = part as { type?: unknown; text?: unknown }
  if (candidate.type === "text" && typeof candidate.text === "string") return candidate.text
  return ""
}

function countNudgeParts(parts: Part[]): number {
  return parts.filter((part) => textOf(part).includes("<instruction name=iteration_nudge>")).length
}

function makeMessage(role: "user" | "assistant", id: string): MessageWithParts {
  return {
    info: { id, sessionID: SESSION, role, time: { created: 0 } } as Message,
    parts: [],
  }
}

function stepEnded(text: string) {
  return {
    type: "session.next.step.ended",
      data: { sessionID: SESSION, assistantMessageID: "msg_x", text },
  }
}

describe("D6 — context-discipline directive is model-keyed", () => {
  test("includes the anti-echo directive for a deepseek model", () => {
    //#given
    const antiEcho = getModelDirectives(DEEPSEEK_MODEL).antiEcho ?? ""
    expect(antiEcho.length).toBeGreaterThan(0)

    //#when
    const section = buildContextDisciplineSection(true, true, "guided", DEEPSEEK_MODEL)

    //#then
    expect(section.length).toBeGreaterThan(0)
    expect(section).toContain(antiEcho)
  })

  test("omits the anti-echo directive for an anthropic model", () => {
    //#given
    const antiEcho = getModelDirectives(DEEPSEEK_MODEL).antiEcho ?? ""

    //#when
    const section = buildContextDisciplineSection(true, true, "guided", ANTHROPIC_MODEL)

    //#then
    expect(section.length).toBeGreaterThan(0)
    expect(section).not.toContain(antiEcho)
  })
})

describe("F5 — nudge loop-breaker throttles repeated DSML-echo turns", () => {
  test("fires once for five identical turns, then escalates after the cooldown", async () => {
    //#given
    const activations: Activation[] = []
    let clock = 1_000
    const hook = createNudgeLoopBreakerHook(
      {
        session: { prompt: async () => {} },
        directory: "/tmp",
      } as unknown as NativePluginContext,
      {
      now: () => clock,
      cooldownMs: 1_000,
      onCorrective: (sessionID, backoff) => activations.push({ sessionID, backoff }),
    })

    //#when — five identical turns arrive in immediate succession
    for (let i = 0; i < 5; i++) {
      await hook.event(stepEnded(DSML_ECHO))
    }
    const immediate = [...activations]

    //#then — exactly one corrective fires, not five, with the base backoff
    expect(immediate.length).toBe(1)
    expect(immediate[0]).toEqual({ sessionID: SESSION, backoff: 1 })

    //#when — advance past the cooldown window and repeat once more
    clock += 1_000
    await hook.event(stepEnded(DSML_ECHO))

    //#then — a second corrective fires with an escalated backoff
    expect(activations.length).toBe(2)
    expect(activations[1].sessionID).toBe(SESSION)
    expect(activations[1].backoff).toBeGreaterThan(activations[0].backoff)
    expect(computeBackoffDelay(6)).toBeGreaterThan(computeBackoffDelay(3))
  })
})

describe("F5 — sanitizer caps sticky nudges at one across the transcript", () => {
  test("reduces multiple nudge parts to exactly one", async () => {
    //#given
    const hook = createDcpNudgeSanitizerHook({} as MatrixxContext)
    const first = makeMessage("assistant", "msg_1")
    first.parts = [textPart("real assistant answer"), textPart(NUDGE), textPart(NUDGE)]
    const second = makeMessage("assistant", "msg_2")
    second.parts = [textPart(NUDGE), textPart("tail")]
    const messages = [first, second]

    //#when
    await hook["experimental.chat.messages.transform"]?.({}, { messages })

    //#then
    // Kept nudge is unwrapped (control tags stripped, inner prose kept + guard)
    const allTexts = messages.flatMap((m) => m.parts.map((part) => textOf(part)))
    const kept = allTexts.filter((text) => text.includes('use the compress tool'))
    expect(kept.length).toBe(1)
    expect(allTexts.some((text) => text.includes('<instruction'))).toBe(false)
    expect(countNudgeParts(first.parts)).toBe(0)
    expect(countNudgeParts(second.parts)).toBe(0)
  })
})
