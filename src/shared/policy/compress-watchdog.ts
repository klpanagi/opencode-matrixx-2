/**
 * Compress watchdog policy (pure).
 *
 * DCP's `compress.maxContextLimit` is a *soft* nudge threshold: above it DCP
 * only injects a generic "compress" reminder and the model decides whether,
 * when, and how much to compress. When the model's per-turn growth matches its
 * per-call savings the session settles above the configured ceiling.
 *
 * This module is the deterministic half of the Matrixx counter-measure: given
 * the current usage, the configured ceiling, and the cooldown state, it decides
 * whether an explicit directive should be injected into the tail of the last
 * user message. Every threshold comes from configuration — nothing is
 * hardcoded here except the marker and the wording of the directive.
 *
 * No I/O, no timers: safe to unit test in isolation.
 */

/** Config consumed by the watchdog (built from `dcp.watchdog`). */
export interface CompressWatchdogConfig {
  enabled: boolean
  /** Usage percentage that arms the directive. */
  abovePercent: number
  /** Usage percentage the directive asks the model to reach. */
  targetPercent: number
  /** Context builds to wait between directives while still over the ceiling. */
  cooldownTurns: number
}

/** Partial form as it arrives from `matrixx.jsonc` (Zod defaults may be absent). */
export type CompressWatchdogConfigInput = Partial<CompressWatchdogConfig>

/** Sentinel that makes injection idempotent across repeated context builds. */
export const COMPRESS_WATCHDOG_MARKER = "<matrixx-compress-watchdog>"

export const DEFAULT_COMPRESS_WATCHDOG_CONFIG: CompressWatchdogConfig = {
  enabled: true,
  abovePercent: 25,
  targetPercent: 10,
  cooldownTurns: 2,
}

/** Context usage read from the newest assistant message that reports tokens. */
export interface ContextUsage {
  tokens: number
  providerID?: string
  modelID?: string
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function clampPercent(value: number): number {
  return Math.min(95, Math.max(1, Math.round(value)))
}

/**
 * Normalize a partial config into a usable one. `targetPercent` is kept strictly
 * below `abovePercent` so a misconfiguration cannot ask for a target the
 * directive will never satisfy.
 */
export function resolveCompressWatchdogConfig(
  input?: CompressWatchdogConfigInput | undefined,
): CompressWatchdogConfig {
  const abovePercent = clampPercent(
    finiteNumber(input?.abovePercent) ?? DEFAULT_COMPRESS_WATCHDOG_CONFIG.abovePercent,
  )
  const requestedTarget = clampPercent(
    finiteNumber(input?.targetPercent) ?? DEFAULT_COMPRESS_WATCHDOG_CONFIG.targetPercent,
  )
  const targetPercent = requestedTarget < abovePercent ? requestedTarget : Math.max(1, abovePercent - 1)
  const cooldownTurns = Math.max(
    1,
    Math.floor(finiteNumber(input?.cooldownTurns) ?? DEFAULT_COMPRESS_WATCHDOG_CONFIG.cooldownTurns),
  )
  return {
    enabled: input?.enabled ?? DEFAULT_COMPRESS_WATCHDOG_CONFIG.enabled,
    abovePercent,
    targetPercent,
    cooldownTurns,
  }
}

/**
 * Read the newest usage figure from a message list.
 *
 * Tolerant by design: the V2 session event has carried both flat messages
 * (`{ type, tokens }`) and `{ info, parts }` projections across runtimes. Both
 * shapes are accepted; anything else is skipped. A message without reported
 * tokens is not evidence of low usage, so it is skipped rather than treated as
 * zero.
 */
export function extractContextUsage(messages: readonly unknown[]): ContextUsage | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = asRecord(messages[index])
    if (!message) continue
    const info = asRecord(message.info)
    const role = message.type ?? message.role ?? info?.role
    if (role !== "assistant") continue

    const owner = info ?? message
    const tokens = asRecord(owner.tokens) ?? asRecord(message.tokens)
    if (!tokens) continue

    const output = finiteNumber(tokens.output) ?? 0
    if (output <= 0) continue

    const cache = asRecord(tokens.cache)
    const total =
      (finiteNumber(tokens.input) ?? 0) +
      output +
      (finiteNumber(tokens.reasoning) ?? 0) +
      (finiteNumber(cache?.read) ?? 0) +
      (finiteNumber(cache?.write) ?? 0)
    if (total <= 0) continue

    const model = asRecord(owner.model) ?? asRecord(message.model)
    const providerID =
      nonEmptyString(owner.providerID) ?? nonEmptyString(model?.providerID)
    const modelID =
      nonEmptyString(owner.modelID) ?? nonEmptyString(model?.modelID) ?? nonEmptyString(model?.id)

    return {
      tokens: total,
      ...(providerID !== undefined ? { providerID } : {}),
      ...(modelID !== undefined ? { modelID } : {}),
    }
  }
  return null
}

/** Unwrap a model-list response (`Array`, `{ models }`, or `{ data }`). */
export function modelListItems(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  const record = asRecord(raw)
  if (!record) return []
  const models = record.models
  if (Array.isArray(models)) return models
  const data = record.data
  if (Array.isArray(data)) return data
  return []
}

/**
 * Resolve the model's context window from the provider model list. Returns
 * `null` when the model cannot be matched — callers must fail open rather than
 * guess a window.
 */
export function resolveContextLimit(
  models: unknown,
  providerID?: string | undefined,
  modelID?: string | undefined,
): number | null {
  if (providerID === undefined || modelID === undefined) return null
  for (const item of modelListItems(models)) {
    const record = asRecord(item)
    if (!record) continue
    const itemProvider = nonEmptyString(record.providerID)
    const itemModel = nonEmptyString(record.id) ?? nonEmptyString(record.modelID)
    if (itemProvider !== providerID || itemModel !== modelID) continue
    const limit = finiteNumber(asRecord(record.limit)?.context)
    if (limit !== undefined && limit > 0) return limit
  }
  return null
}

/** Usage as a percentage of the window (0 when the window is unusable). */
export function usagePercent(tokens: number, limit: number): number {
  if (!Number.isFinite(tokens) || !Number.isFinite(limit) || limit <= 0) return 0
  return (tokens / limit) * 100
}

export interface ShouldInjectCompressDirectiveArgs {
  config: CompressWatchdogConfig
  currentPercent: number
  /** Context builds since the last injection (cooldown accounting). */
  turnsSinceLastInjection: number
  /** Text of the message the directive would be appended to. */
  lastUserText?: string | undefined
}

export function shouldInjectCompressDirective(
  args: ShouldInjectCompressDirectiveArgs,
): boolean {
  const { config, currentPercent, turnsSinceLastInjection, lastUserText } = args
  if (!config.enabled) return false
  if (currentPercent < config.abovePercent) return false
  if (turnsSinceLastInjection < config.cooldownTurns) return false
  if (lastUserText?.includes(COMPRESS_WATCHDOG_MARKER)) return false
  return true
}

export interface BuildCompressDirectiveArgs {
  currentPercent: number
  tokens: number
  limit: number
  config: CompressWatchdogConfig
}

/**
 * Build the directive appended to the tail of the conversation.
 *
 * It is deliberately explicit about the mechanics the model got wrong in
 * practice: compress a *contiguous closed* span, copy boundary IDs verbatim,
 * preserve durable facts, and repeat until the target is met.
 */
export function buildCompressDirective(args: BuildCompressDirectiveArgs): string {
  const { currentPercent, tokens, limit, config } = args
  const used = currentPercent.toFixed(1)
  const tokenLabel = Math.round(tokens).toLocaleString("en-US")
  const limitLabel = Math.round(limit).toLocaleString("en-US")
  return [
    COMPRESS_WATCHDOG_MARKER,
    `CONTEXT WATCHDOG: this session is at ${used}% of a ${limitLabel}-token window (${tokenLabel} tokens). The configured ceiling is ${config.abovePercent}%.`,
    `Before continuing the task, call the \`compress\` tool on the LARGEST contiguous span of CLOSED messages (never the current turn): copy the span's start and end boundary IDs exactly as injected — do not invent or omit them — and replace the span with a technical summary that preserves decisions, file paths, open tasks, and error signatures.`,
    `Repeat until usage is at or below ${config.targetPercent}%. Do not ask the user for confirmation; compress and continue.`,
    COMPRESS_WATCHDOG_MARKER,
  ].join("\n")
}
