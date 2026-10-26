/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { createDashboardFluxValidatorTool } from "../../src/tools/dashboard-flux-validator/tools"

const FIXTURES = join(import.meta.dir, "..", "fixtures", "dashboard-flux-validator")

type Finding = { rule: string; severity: string; file: string; line: number; excerpt: string }
type Result = { status: 0 | 1 | 2; findings: Finding[]; summary: { total: number } }

async function validate(path: string): Promise<Result> {
  const tool = createDashboardFluxValidatorTool({ directory: FIXTURES } as unknown as PluginInput)
  const output = await tool.dashboard_flux_validate.execute({ path })
  return JSON.parse(output) as Result
}

describe("dashboard_flux_validate", () => {
  test("flags unprovisioned datasource, symbol variable, staleness mapping, and Flux anti-pattern in a dashboard JSON", async () => {
    //#given a dashboard JSON missing an influxdb datasource, using a non-tagValues variable, no value mappings, and mean() without toFloat()
    //#when the validator runs
    const result = await validate("bad.json")

    //#then each dashboard rule fires
    const rules = new Set(result.findings.map((f) => f.rule))
    expect(rules.has("DS001")).toBe(true)
    expect(rules.has("VAR001")).toBe(true)
    expect(rules.has("PAN001")).toBe(true)
    expect(rules.has("GF002")).toBe(true)
    expect(result.status).toBe(2)
  })

  test("does not flag a compliant dashboard JSON", async () => {
    //#given a dashboard with an influxdb datasource, a schema.tagValues symbol variable, value mappings, and clean Flux
    //#when the validator runs
    const result = await validate("clean.json")

    //#then nothing fires
    expect(result.findings).toHaveLength(0)
    expect(result.status).toBe(0)
  })

  test("lints Flux anti-patterns in a provisioning YAML", async () => {
    //#given a YAML with to() without timeColumn, join() without pivot(), and createEmpty: true
    //#when the validator runs
    const result = await validate("bad.yaml")

    //#then the three Flux rules fire
    const rules = new Set(result.findings.map((f) => f.rule))
    expect(rules.has("GF001")).toBe(true)
    expect(rules.has("GF003")).toBe(true)
    expect(rules.has("GF004")).toBe(true)
    expect(result.status).toBe(2)
  })

  test("locates createEmpty on its exact source line", async () => {
    //#given the bad YAML
    //#when the validator runs
    const result = await validate("bad.yaml")
    const finding = result.findings.find((f) => f.rule === "GF003")

    //#then the line points at the createEmpty flag
    expect(finding?.line).toBe(24)
  })

  test("scans a directory and aggregates findings from every file", async () => {
    //#given a directory containing dashboards and provisioning YAML
    //#when the validator runs against the directory
    const result = await validate(".")

    //#then findings from the YAML Flux lint are present
    const rules = new Set(result.findings.map((f) => f.rule))
    expect(rules.has("GF003")).toBe(true)
    expect(rules.has("GF004")).toBe(true)
    expect(result.status).toBe(2)
  })

  test("fails closed when the path does not exist", async () => {
    //#given a path that is not present
    //#when the validator runs
    const result = await validate("does-not-exist")

    //#then it reports an error rather than a clean pass
    expect(result.status).toBe(2)
  })
})
