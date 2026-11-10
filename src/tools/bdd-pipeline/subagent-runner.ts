import {
  type NativeSubagentClient,
  spawnNativeSubagent,
  waitNativeSubagent,
} from "../../shared/session/native-subagent"
import { resolveSkillContent } from "../delegate-task/skill-resolver"
import type {
  BddPipelineStageName,
  BddPipelineStageResult,
  BddPipelineStageStatus,
} from "./types"

const POLL_INTERVAL_MS = 250
const POLL_TIMEOUT_MS = 600_000

const STAGE_AGENT: Record<BddPipelineStageName, string> = {
  tests: "bdd-tests",
  frontend: "bdd-frontend",
  backend: "bdd-backend",
}

const STAGE_SKILLS: Record<BddPipelineStageName, string[]> = {
  tests: ["bdd-tests"],
  frontend: ["bdd-frontend"],
  backend: ["bdd-backend"],
}

export type SkillResolver = typeof resolveSkillContent

function terminalStatusToStageStatus(status: string): BddPipelineStageStatus {
  if (status === "timeout") return "timeout"
  return "failed"
}

function extractJsonPayload(raw: string): Record<string, unknown> | null {
  if (!raw) return null
  const direct = tryParse(raw.trim())
  if (direct) return direct
  const fence = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/)
  if (fence) {
    const parsed = tryParse(fence[1].trim())
    if (parsed) return parsed
  }
  const firstBrace = raw.indexOf("{")
  const lastBrace = raw.lastIndexOf("}")
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return tryParse(raw.slice(firstBrace, lastBrace + 1))
  }
  return null
}

function tryParse(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s)
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === "string")
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function buildEmptyStage(stage: BddPipelineStageName, error?: string): BddPipelineStageResult {
  return {
    stage,
    status: "failed",
    filesCreated: [],
    testsRun: 0,
    testsPassed: 0,
    testsFailed: 0,
    testOutput: "",
    error,
  }
}

export interface SpawnSubagentOptions {
  client: NativeSubagentClient
  stage: BddPipelineStageName
  prompt: string
  contractPath: string
  parentSessionID: string
  abort?: AbortSignal
  outDir: string
  skillResolver?: SkillResolver
}

export async function spawnStageSubagent(opts: SpawnSubagentOptions): Promise<BddPipelineStageResult> {
  const { client, stage, prompt, contractPath } = opts
  const resolve = opts.skillResolver ?? resolveSkillContent
  const { content: skillContent } = resolve(STAGE_SKILLS[stage], {})
  const basePrompt =
    `Contract JSON path: ${contractPath}\n` +
    `Output directory: ${opts.outDir}\n\n` +
    `${prompt}\n\n` +
    `When finished, return a JSON object on the LAST line of your output with this exact shape:\n` +
    `{"stage":"${stage}","files_created":[...absolute paths...],"tests_run":N,"tests_passed":N,"tests_failed":N,"test_output":"<first 200 lines of failing test output, or empty>","error":"<message or empty>"}`
  // Phase 5: relocate skill-prepend to shared. Runtime spawns bypass the
  // Task 1.2 transformer, so load_skills content is resolved and prepended here.
  const fullPrompt =
    skillContent && skillContent.length > 0 ? `${skillContent}\n\n${basePrompt}` : basePrompt

  if (opts.abort?.aborted) {
    return buildEmptyStage(stage, "aborted")
  }

  const spawned = await spawnNativeSubagent(client, {
    agent: STAGE_AGENT[stage],
    prompt: fullPrompt,
    parentSessionID: opts.parentSessionID,
    title: `[bdd-pipeline] ${stage}`,
  })
  if (!spawned.ok) {
    return buildEmptyStage(stage, spawned.error)
  }

  const waited = await waitNativeSubagent(client, {
    sessionID: spawned.sessionID,
    timeoutMs: POLL_TIMEOUT_MS,
    pollIntervalMs: POLL_INTERVAL_MS,
    signal: opts.abort,
  })

  if (opts.abort?.aborted) {
    await client.session.interrupt({ sessionID: spawned.sessionID }).catch(() => undefined)
    return buildEmptyStage(stage, "aborted")
  }
  if (waited.status === "timeout") {
    return buildEmptyStage(stage, "poll timeout")
  }
  if (waited.status !== "completed") {
    return {
      stage,
      status: terminalStatusToStageStatus(waited.error ?? "failed"),
      filesCreated: [],
      testsRun: 0,
      testsPassed: 0,
      testsFailed: 0,
      testOutput: "",
      error: waited.error ?? "subagent failed",
    }
  }
  const output = waited.output ?? ""
  const payload = extractJsonPayload(output)
  if (payload) {
    return {
      stage,
      status: "completed",
      filesCreated: asStringArray(payload.files_created),
      testsRun: asNumber(payload.tests_run),
      testsPassed: asNumber(payload.tests_passed),
      testsFailed: asNumber(payload.tests_failed),
      testOutput: typeof payload.test_output === "string" ? payload.test_output : "",
      error: typeof payload.error === "string" && payload.error ? payload.error : undefined,
    }
  }
  return {
    stage,
    status: "failed",
    filesCreated: [],
    testsRun: 0,
    testsPassed: 0,
    testsFailed: 0,
    testOutput: output,
    error: "subagent returned no parseable JSON report",
  }
}
