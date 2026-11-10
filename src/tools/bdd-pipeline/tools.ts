import * as fs from "node:fs"
import { resolve as resolvePath } from "node:path"
import { z } from "zod"
import { type Contract, ContractSchema } from "../../features/bdd/schema"
import {
  type NativeSubagentClient,
  spawnNativeSubagent,
  waitNativeSubagent,
} from "../../shared/session/native-subagent"
import { defineTool, type MatrixxToolDefinition } from "../../shared/tool/define-tool"
import { createBddCreateContractTool } from "../bdd-create-contract/tools"
import { createBddParseGherkinTool } from "../bdd-parse-gherkin/tools"
import { resolveSkillContent } from "../delegate-task/skill-resolver"
import { buildAnalysisReport } from "./analysis-report"
import { BDD_PIPELINE_DESCRIPTION, PIPELINE_REQUIRED_OUTPUTS } from "./constants"
import { resolveFeaturePaths } from "./feature-resolver"
import { runBddPipeline } from "./pipeline-runner"
import { type SkillResolver, spawnStageSubagent } from "./subagent-runner"
import type {
  BddPipelineContext,
  BddPipelineDeps,
  BddPipelineResult,
  BddPipelineStageName,
  CreateContractResult,
  EnrichContractResult,
  GateResult,
  ParseFeatureResult,
} from "./types"

const ENRICH_AGENT = "mouse"
const ENRICH_SKILLS = ["bdd-contract"]
const ENRICH_POLL_TIMEOUT_MS = 600_000
const ENRICH_POLL_INTERVAL_MS = 250

export function createBddPipelineTool(opts: {
  client: NativeSubagentClient
}): MatrixxToolDefinition {
  const { client } = opts
  const parseTool = createBddParseGherkinTool()
  const createTool = createBddCreateContractTool()

  return defineTool("bdd_pipeline_run", {
    description: BDD_PIPELINE_DESCRIPTION,
    args: {
      featurePaths: z
        .array(z.string())
        .describe(
          "One or more .feature file paths, directories, or glob patterns (e.g. 'features/**/*.feature').",
        ),
      outDir: z.string().describe("Output directory root; per-feature dirs are created under it"),
      force: z
        .boolean()
        .default(false)
        .describe("Overwrite existing contract / output files"),
    },
    async execute(args, ctx): Promise<string> {
      try {
        const featurePaths = resolveFeaturePaths(
          (args.featurePaths as string[]) ?? [],
        )
        if (featurePaths.length === 0) {
          return JSON.stringify({
            success: false,
            error: "no .feature files matched the provided inputs",
          })
        }
        const pipelineCtx: Omit<BddPipelineContext, "outDir" | "force" | "featureName"> = {
          parentSessionID: ctx.sessionID,
          parentMessageID: ctx.messageID,
          parentAgent: ctx.agent,
          abort: ctx.abort,
        }
        const results: BddPipelineResult[] = []
        for (const featurePath of featurePaths) {
          const deps = makeDeps({
            client,
            parseTool,
            createTool,
            parentSessionID: ctx.sessionID,
            parentMessageID: ctx.messageID,
            parentAgent: ctx.agent,
            outDir: args.outDir as string,
            featurePath,
            abort: ctx.abort,
            force: Boolean(args.force),
          })
          const result = await runBddPipeline(
            { featurePaths: [featurePath], outDir: args.outDir as string, force: Boolean(args.force) },
            pipelineCtx,
            deps,
          )
          results.push(result)
        }
        return JSON.stringify({
          success: true,
          count: results.length,
          passed: results.filter((r) => r.status === "PASS").length,
          failed: results.filter((r) => r.status === "FAIL").length,
          results,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return JSON.stringify({ success: false, error: message })
      }
    },
  })
}

function makeDeps(args: {
  client: NativeSubagentClient
  parseTool: MatrixxToolDefinition
  createTool: MatrixxToolDefinition
  parentSessionID: string
  parentMessageID: string
  parentAgent: string
  outDir: string
  featurePath: string
  abort?: AbortSignal
  force: boolean
}): BddPipelineDeps {

  return {
    parseFeature: async (path: string): Promise<ParseFeatureResult> => {
      const raw = await args.parseTool.execute({ filePath: path }, dummyCtx(args))
      return typeof raw === "string" ? JSON.parse(raw) : (raw as unknown as ParseFeatureResult)
    },
    readFeatureSource: async (path: string): Promise<string> => {
      return fs.readFileSync(path, "utf-8")
    },
    createContract: async (a): Promise<CreateContractResult> => {
      const raw = await args.createTool.execute(
        {
          parsedAst: a.parsedAst,
          sourceFile: a.sourceFile,
          sourceText: a.sourceText,
          force: a.force ?? args.force,
          outputPath: a.outputPath ?? `${a.sourceFile}.contract.json`,
        },
        dummyCtx(args),
      )
      return typeof raw === "string" ? JSON.parse(raw) : (raw as unknown as CreateContractResult)
    },
    enrichContract: async (contractPath: string): Promise<EnrichContractResult> => {
      return runEnrich(args.client, contractPath, args)
    },
    spawnSubagent: async (stage: BddPipelineStageName, prompt: string, _contract: Contract, ctx: BddPipelineContext) => {
      return spawnStageSubagent({
        client: args.client,
        stage,
        prompt,
        contractPath: `${ctx.outDir}/contract.json`,
        parentSessionID: args.parentSessionID,
        abort: args.abort,
        outDir: ctx.outDir,
      })
    },
    gateRequiredOutputs: async (dir: string): Promise<GateResult> => {
      const missing: string[] = []
      for (const name of PIPELINE_REQUIRED_OUTPUTS) {
        if (!fs.existsSync(resolvePath(dir, name))) missing.push(name)
      }
      return { ok: missing.length === 0, missing }
    },
    writeAnalysis: async (dir: string, result: BddPipelineResult): Promise<void> => {
      const contractPath = resolvePath(dir, "contract.json")
      if (!fs.existsSync(contractPath)) {
        fs.writeFileSync(resolvePath(dir, "ANALYSIS.md"), "# Feature Analysis\n\n(no contract found)\n", "utf-8")
        return
      }
      const contract: Contract = ContractSchema.parse(
        JSON.parse(fs.readFileSync(contractPath, "utf-8")),
      )
      const report = buildAnalysisReport({ contract, result, featureDir: dir })
      fs.writeFileSync(resolvePath(dir, "ANALYSIS.md"), report, "utf-8")
    },
  }
}

function dummyCtx(args: { parentSessionID: string; parentMessageID: string; parentAgent: string }) {
  return {
    sessionID: args.parentSessionID,
    messageID: args.parentMessageID,
    agent: args.parentAgent,
    directory: process.cwd(),
    worktree: process.cwd(),
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => undefined,
  }
}

export async function runEnrich(
  client: NativeSubagentClient,
  contractPath: string,
  args: {
    parentSessionID: string
    abort?: AbortSignal
    skillResolver?: SkillResolver
  },
): Promise<EnrichContractResult> {
  if (args.abort?.aborted) return { success: false, error: "aborted" }
  const resolve = args.skillResolver ?? resolveSkillContent
  const { content: skillContent } = resolve(ENRICH_SKILLS, {})
  const basePrompt =
    `Enrich the contract at ${contractPath}.\n` +
    `Read it, infer the api/ui/state/assumptions annotations from the feature content, ` +
    `and write the enriched contract back to the same path.`
  // Phase 5: relocate skill-prepend to shared. Runtime spawns bypass the
  // Task 1.2 transformer, so load_skills content is resolved and prepended here.
  const prompt =
    skillContent && skillContent.length > 0 ? `${skillContent}\n\n${basePrompt}` : basePrompt
  const spawned = await spawnNativeSubagent(client, {
    agent: ENRICH_AGENT,
    prompt,
    parentSessionID: args.parentSessionID,
    title: "[bdd-pipeline] contract enrich",
  })
  if (!spawned.ok) {
    return { success: false, error: spawned.error }
  }
  const waited = await waitNativeSubagent(client, {
    sessionID: spawned.sessionID,
    timeoutMs: ENRICH_POLL_TIMEOUT_MS,
    pollIntervalMs: ENRICH_POLL_INTERVAL_MS,
    signal: args.abort,
  })
  if (args.abort?.aborted) {
    await client.session.interrupt({ sessionID: spawned.sessionID }).catch(() => undefined)
    return { success: false, error: "aborted" }
  }
  if (waited.status === "timeout") {
    return { success: false, error: "enrich poll timeout" }
  }
  if (waited.status !== "completed") {
    return { success: false, error: waited.error ?? "enrich failed" }
  }
  if (!fs.existsSync(contractPath)) {
    return { success: false, error: "contract path missing after enrichment" }
  }
  const parsed = ContractSchema.safeParse(JSON.parse(fs.readFileSync(contractPath, "utf-8")))
  if (!parsed.success) {
    return { success: false, error: `enriched contract failed validation: ${parsed.error.message}` }
  }
  return { success: true, contract: parsed.data }
}
