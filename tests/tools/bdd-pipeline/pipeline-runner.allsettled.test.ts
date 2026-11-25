import { describe, expect, test } from "bun:test"
import type { Contract } from "../../../src/features/bdd/schema"
import { runBddPipeline } from "../../../src/tools/bdd-pipeline/pipeline-runner"
  import type {
  BddPipelineDeps,
  BddPipelineStageName,
  BddPipelineStageResult,
} from "../../../src/tools/bdd-pipeline/types"

const CONTRACT = {
  schemaVersion: 1 as const,
  generatedAt: "2026-01-01T00:00:00.000Z",
  sourceFile: "/test/login.feature",
  feature: { name: "User Login", tags: [] },
  scenarios: [],
  annotations: {},
} satisfies Contract

function makeStage(
  stage: BddPipelineStageName,
  overrides: Partial<BddPipelineStageResult> = {},
): BddPipelineStageResult {
  return {
    stage,
    status: "completed",
    filesCreated: [`/out/login/${stage}/generated.ts`],
    testsRun: 5,
    testsPassed: 5,
    testsFailed: 0,
    testOutput: `${stage} ok`,
    ...overrides,
  }
}

describe("runBddPipeline — settled stage fan-out", () => {
  test("records a rejected stage as failed and keeps the two completed stage outputs", async () => {
    //#given — tests and frontend complete, backend rejects
    const written: unknown[] = []
    const deps: BddPipelineDeps = {
      parseFeature: async () => ({
        success: true,
        data: { feature: { name: "User Login", children: [] } },
      }),
      createContract: async () => ({
        success: true,
        outputPath: "/test/login.feature.contract.json",
      }),
      enrichContract: async () => ({ success: true, contract: CONTRACT }),
      spawnSubagent: async (stage) => {
        if (stage === "backend") throw new Error("backend agent exploded")
        if (stage === "tests") {
          return makeStage("tests", { testsRun: 3, testsPassed: 3, testOutput: "tests ok" })
        }
        return makeStage("frontend", { testOutput: "frontend ok" })
      },
      gateRequiredOutputs: async () => ({ ok: true, missing: [] }),
      writeAnalysis: async (_featureDir, report) => {
        written.push(report)
      },
      readFeatureSource: async () => "Feature: User Login\n",
    }

    //#when
    const result = await runBddPipeline(
      { featurePaths: ["/test/login.feature"], outDir: "/out" },
      { parentSessionID: "parent-1", parentMessageID: "msg-1" },
      deps,
    )

    //#then — every stage is populated; the completed outputs survive
    expect(result.stages.tests.status).toBe("completed")
    expect(result.stages.tests.testsPassed).toBe(3)
    expect(result.stages.tests.testOutput).toBe("tests ok")
    expect(result.stages.frontend.status).toBe("completed")
    expect(result.stages.frontend.testOutput).toBe("frontend ok")
    //#then — the rejected stage is recorded instead of discarding the whole result
    expect(result.stages.backend.status).toBe("failed")
    expect(result.stages.backend.error).toContain("backend agent exploded")
    expect(result.status).toBe("FAIL")
    expect(written).toHaveLength(1)
  })
})
