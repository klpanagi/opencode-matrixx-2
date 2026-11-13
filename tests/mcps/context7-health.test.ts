/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import {
  CONTEXT7_API_KEY_ENV,
  buildContext7HealthNotice,
} from "../../src/mcps/context7-health"
import {
  _resetMcpStartupFailuresForTesting,
  _resetMcpStartupWarningsForTesting,
  setMcpStartupWarnings,
} from "../../src/mcps/mcp-startup-state"
import { buildMcpStartupNotice, getMcpStartupNotice } from "../../src/mcps/mcp-startup-notice"

afterEach(() => {
  _resetMcpStartupFailuresForTesting()
  _resetMcpStartupWarningsForTesting()
})

describe("buildContext7HealthNotice", () => {
  test("warns when context7 is enabled without an API key", () => {
    //#given context7 is enabled and no key is configured
    //#when building the health notice
    const notice = buildContext7HealthNotice({ disabledMcps: [] })

    //#then the notice names the optional key and the silent-failure risk
    expect(notice).toBeDefined()
    expect(notice).toContain(CONTEXT7_API_KEY_ENV)
    expect(notice).toContain("context7")
    expect(notice).toContain("rate-limited")
    expect(notice).toContain("→ fix:")
  })

  test("stays silent when an API key is present", () => {
    //#given context7 is enabled with a key
    //#when building the health notice
    const notice = buildContext7HealthNotice({
      disabledMcps: [],
      context7ApiKey: "ctx7sk-test",
    })

    //#then nothing is emitted
    expect(notice).toBeUndefined()
  })

  test("stays silent when context7 is disabled", () => {
    //#given context7 is disabled in config
    //#when building the health notice
    const notice = buildContext7HealthNotice({ disabledMcps: ["context7"] })

    //#then nothing is emitted
    expect(notice).toBeUndefined()
  })
})

describe("context7 health notice integration with startup notice", () => {
  test("startup notice includes context7 warnings when there are no failures", () => {
    //#given a context7 health warning and no MCP creation failures
    const warning = buildContext7HealthNotice({ disabledMcps: [] }) ?? ""
    setMcpStartupWarnings([warning])

    //#when reading the startup notice
    const notice = getMcpStartupNotice()

    //#then the warning is surfaced
    expect(notice).toBeDefined()
    expect(notice).toContain(CONTEXT7_API_KEY_ENV)
  })

  test("combines failures and warnings without dropping either", () => {
    //#given both a creation failure and a health warning
    const failure = { name: "document_reader", error: "uvx not found" }
    const warning = buildContext7HealthNotice({ disabledMcps: [] }) ?? ""

    //#when building the notice
    const notice = buildMcpStartupNotice([failure], [warning])

    //#then both lines are present
    expect(notice).toContain("document_reader")
    expect(notice).toContain(CONTEXT7_API_KEY_ENV)
  })

  test("remains undefined when there are neither failures nor warnings", () => {
    //#given no failure and no warning
    //#when building the notice
    const notice = buildMcpStartupNotice([], [])

    //#then nothing is emitted
    expect(notice).toBeUndefined()
  })
})
