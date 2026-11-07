import type { RuntimeFallbackConfig } from "../../config"
import { log } from "../../shared/runtime/logger"
import { HOOK_NAME } from "./constants"
import type { FallbackResult, FallbackState } from "./types"

export function createFallbackState(originalModel: string): FallbackState {
  return {
    originalModel,
    currentModel: originalModel,
    fallbackIndex: -1,
    failedModels: new Map<string, number>(),
    attemptCount: 0,
    pendingFallbackModel: undefined,
  }
}

export type CooldownStatus = "armed" | "active" | "expired"

export type ClockFn = () => number

const defaultClock: ClockFn = () => Date.now()

export function getCooldownStatus(
  model: string,
  state: FallbackState,
  cooldownSeconds: number,
  now: ClockFn = defaultClock
): CooldownStatus {
  const failedAt = state.failedModels.get(model)
  if (failedAt === undefined) return "armed"
  return now() - failedAt < cooldownSeconds * 1000 ? "active" : "expired"
}

export function recordModelFailure(
  state: FallbackState,
  model: string,
  now: ClockFn = defaultClock
): void {
  state.failedModels.set(model, now())
}

export function markModelSuccess(state: FallbackState, model: string): void {
  state.failedModels.delete(model)
  if (state.pendingFallbackModel === model) {
    state.pendingFallbackModel = undefined
  }
}

function isModelInCooldown(
  model: string,
  state: FallbackState,
  cooldownSeconds: number,
  now: ClockFn = defaultClock
): boolean {
  return getCooldownStatus(model, state, cooldownSeconds, now) === "active"
}

function findNextAvailableFallback(
  state: FallbackState,
  fallbackModels: string[],
  cooldownSeconds: number,
  now: ClockFn = defaultClock
): string | undefined {
  for (let i = state.fallbackIndex + 1; i < fallbackModels.length; i++) {
    const candidate = fallbackModels[i]
    const status = getCooldownStatus(candidate, state, cooldownSeconds, now)
    if (status === "expired") {
      state.failedModels.delete(candidate)
    }
    if (!isModelInCooldown(candidate, state, cooldownSeconds, now)) {
      return candidate
    }
    log(`[${HOOK_NAME}] Skipping fallback model in cooldown`, { model: candidate, index: i })
  }
  return undefined
}

export function prepareFallback(
  sessionID: string,
  state: FallbackState,
  fallbackModels: string[],
  config: Required<RuntimeFallbackConfig>,
  now: ClockFn = defaultClock
): FallbackResult {
  if (state.attemptCount >= config.max_fallback_attempts) {
    log(`[${HOOK_NAME}] Max fallback attempts reached`, { sessionID, attempts: state.attemptCount })
    return { success: false, error: "Max fallback attempts reached", maxAttemptsReached: true }
  }

  const nextModel = findNextAvailableFallback(state, fallbackModels, config.cooldown_seconds, now)

  if (!nextModel) {
    log(`[${HOOK_NAME}] No available fallback models`, { sessionID })
    return { success: false, error: "No available fallback models (all in cooldown or exhausted)" }
  }

  log(`[${HOOK_NAME}] Preparing fallback`, {
    sessionID,
    from: state.currentModel,
    to: nextModel,
    attempt: state.attemptCount + 1,
  })

  const failedModel = state.currentModel

  state.fallbackIndex = fallbackModels.indexOf(nextModel)
  recordModelFailure(state, failedModel, now)
  state.attemptCount++
  state.currentModel = nextModel
  state.pendingFallbackModel = nextModel

  return { success: true, newModel: nextModel }
}
