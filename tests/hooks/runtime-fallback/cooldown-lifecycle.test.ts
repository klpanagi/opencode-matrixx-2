/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"

import {
  createFallbackState,
  getCooldownStatus,
  markModelSuccess,
  prepareFallback,
} from "../../../src/hooks/runtime-fallback/fallback-state"
import type { RuntimeFallbackConfig } from "../../../src/config"

const CONFIG: Required<RuntimeFallbackConfig> = {
  enabled: true,
  retry_on_errors: [429, 500],
  max_fallback_attempts: 3,
  cooldown_seconds: 60,
  timeout_seconds: 30,
  notify_on_fallback: false,
}

describe("cooldown lifecycle (reset matrix)", () => {
  test("success resets cooldown so the model is admitted again", () => {
    //#given
    let now = 1_000_000
    const clock = () => now
    const state = createFallbackState("model-a")
    prepareFallback("ses_1", state, ["model-b"], CONFIG, clock)

    //#when
    markModelSuccess(state, "model-a")

    //#then
    expect(getCooldownStatus("model-a", state, CONFIG.cooldown_seconds, clock)).toBe("armed")
    expect(state.failedModels.has("model-a")).toBe(false)
  })

  test("defined failure rearms cooldown so the model is held", () => {
    //#given
    let now = 1_000_000
    const clock = () => now
    const state = createFallbackState("model-a")

    //#when
    prepareFallback("ses_1", state, ["model-b"], CONFIG, clock)

    //#then
    expect(getCooldownStatus("model-a", state, CONFIG.cooldown_seconds, clock)).toBe("active")
    expect(state.failedModels.get("model-a")).toBe(now)
  })

  test("unrelated error holds cooldown without touching entries", () => {
    //#given
    let now = 1_000_000
    const clock = () => now
    const state = createFallbackState("model-a")
    prepareFallback("ses_1", state, ["model-b"], CONFIG, clock)
    const before = new Map(state.failedModels)

    //#when
    markModelSuccess(state, "some-other-model")

    //#then
    expect(state.failedModels).toEqual(before)
    expect(getCooldownStatus("model-a", state, CONFIG.cooldown_seconds, clock)).toBe("active")
  })

  test("expired cooldown allows retry of the model", () => {
    //#given
    let now = 1_000_000
    const clock = () => now
    const state = createFallbackState("model-a")
    prepareFallback("ses_1", state, ["model-b"], CONFIG, clock)

    //#when
    now += CONFIG.cooldown_seconds * 1000 + 1

    //#then
    expect(getCooldownStatus("model-a", state, CONFIG.cooldown_seconds, clock)).toBe("expired")
    const result = prepareFallback("ses_1", state, ["model-b", "model-a"], CONFIG, clock)
    expect(result.success).toBe(true)
    expect(result.newModel).toBe("model-a")
  })
})
