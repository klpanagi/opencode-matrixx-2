/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"

import {
  evaluateContextModeCwd,
  evaluateContextModeToolCompat,
} from "../../../../src/cli/doctor/checks/context-mode"

describe("evaluateContextModeToolCompat — V2 happy path", () => {
  test("V2 keys pass clean with no migration hint", () => {
    //#given
    const tools = ["ctx_execute", "ctx_batch", "ctx_index", "ctx_search", "ctx_resume", "ctx_stats", "ctx_doctor", "ctx_upgrade", "ctx_purge"]

    //#when
    const result = evaluateContextModeToolCompat(tools)

    //#then
    expect(result.name).toBe("context-mode-tools")
    expect(result.status).toBe("pass")
    expect(result.message).not.toContain("ctx_batch_execute")
    expect(result.detail ?? "").not.toContain("ctx_batch_execute")
  })
})

describe("evaluateContextModeToolCompat — V1 compat with hint", () => {
  test("V1 keys pass with migration hint naming V2 replacements", () => {
    //#given
    const tools = ["ctx_batch_execute", "ctx_execute_file", "ctx_fetch_and_index"]

    //#when
    const result = evaluateContextModeToolCompat(tools)

    //#then
    expect(result.status).toBe("pass")
    const hint = `${result.message} ${result.detail ?? ""}`
    expect(hint).toContain("ctx_batch")
    expect(hint).toContain("ctx_execute")
    expect(hint).toContain("file")
    expect(hint).toContain("ctx_index")
    expect(hint).toContain("ctx_search")
  })

  test("mixed V1+V2 keys pass with migration hint", () => {
    //#given
    const tools = ["ctx_execute", "ctx_batch_execute", "ctx_search"]

    //#when
    const result = evaluateContextModeToolCompat(tools)

    //#then
    expect(result.status).toBe("pass")
    expect(`${result.message} ${result.detail ?? ""}`).toContain("ctx_batch")
  })
})

describe("evaluateContextModeToolCompat — negative", () => {
  test("no tools fail with actionable message", () => {
    //#given
    const tools: string[] = []

    //#when
    const result = evaluateContextModeToolCompat(tools)

    //#then
    expect(result.status).toBe("fail")
    expect(result.message).toContain("context-mode")
    expect(`${result.message} ${result.detail ?? ""}`).toMatch(/install|regist/i)
  })
})

describe("evaluateContextModeCwd — MCP-only scoping", () => {
  test("local install source skips cwd check with pass", () => {
    //#given
    const server = { type: "local", command: ["context-mode"] }

    //#when
    const result = evaluateContextModeCwd(server, "local")

    //#then
    expect(result.status).toBe("pass")
    expect(`${result.message} ${result.detail ?? ""}`).toMatch(/MCP-only|MCP only|local/i)
  })

  test("registry install source skips cwd check with pass", () => {
    //#given
    const server = { package: "context-mode" }

    //#when
    const result = evaluateContextModeCwd(server, "registry")

    //#then
    expect(result.status).toBe("pass")
  })

  test("MCP source without cwd still warns", () => {
    //#given
    const server = { type: "local", command: ["context-mode"] }

    //#when
    const result = evaluateContextModeCwd(server, "mcp")

    //#then
    expect(result.status).toBe("warn")
  })
})
