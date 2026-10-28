/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  _setDisciplinePathForTesting,
  CONTEXT_MODE_DEFAULT_BLOCKED_TOOLS,
  deriveContextModeRootFromFile,
  hasGrepGlobToolNames,
  resolveContextModeDisciplineInfo,
  resolveContextModeEnforcement,
  resolveGrepGlobUsable,
  willBlockGrepGlob,
} from "../../src/shared/context-mode-enforcement"

const FAKE_PATH = "/nonexistent-fake/AGENTS.md"

describe("context-mode-enforcement", () => {
  test("canonical default blocks grep, glob and webfetch", () => {
    //#given: the shared default
    //#when: inspected
    //#then: hook, constants and schema agree on it
    expect([...CONTEXT_MODE_DEFAULT_BLOCKED_TOOLS]).toEqual(["grep", "glob", "webfetch"])
  })

  test("resolveContextModeEnforcement applies defaults", () => {
    //#given: no config
    //#when: resolved
    const got = resolveContextModeEnforcement(undefined)
    //#then: enabled, warn-only, grep+glob+webfetch
    expect(got).toEqual({ enabled: true, enforce: false, blockedTools: ["grep", "glob", "webfetch"] })
  })

  test("resolveContextModeEnforcement lowercases blocked tools", () => {
    //#given: mixed-case config
    //#when: resolved
    const got = resolveContextModeEnforcement({ enforce: true, blocked_tools: ["Grep", "READ"] })
    //#then: normalized
    expect(got).toEqual({ enabled: true, enforce: true, blockedTools: ["grep", "read"] })
  })

  test("hasGrepGlobToolNames matches exact tool names", () => {
    //#given: tool name lists
    //#when: checked
    //#then: exact lowercase match only
    expect(hasGrepGlobToolNames(["grep", "glob"])).toBe(true)
    expect(hasGrepGlobToolNames(["grep"])).toBe(true)
    expect(hasGrepGlobToolNames(["ctx_search", "read"])).toBe(false)
    expect(hasGrepGlobToolNames([])).toBe(false)
    expect(hasGrepGlobToolNames(["Grep"])).toBe(false)
  })

  test("grep/glob usable when enforce is off", () => {
    //#given: grep registered, warn-only mode
    _setDisciplinePathForTesting(FAKE_PATH)
    //#when: resolved
    //#then: prompt may advertise the fallback
    expect(resolveGrepGlobUsable(["ctx_search", "grep"], { enforce: false })).toBe(true)
  })

  test("grep/glob not usable when enforced with a working substitute", () => {
    //#given: grep registered, enforce on, substitute present
    _setDisciplinePathForTesting(FAKE_PATH)
    //#when: resolved
    //#then: prompt must not advertise grep/glob
    expect(resolveGrepGlobUsable(["ctx_search", "grep", "glob"], { enforce: true })).toBe(false)
  })

  test("grep/glob usable when enforced but no substitute exists", () => {
    //#given: grep registered, enforce on, nothing indexed
    _setDisciplinePathForTesting(null)
    //#when: resolved
    //#then: block would strand the agent, so the fallback stays advertised
    expect(resolveGrepGlobUsable(["ctx_search", "grep"], { enforce: true })).toBe(true)
  })

  test("unusable when grep/glob not registered regardless of enforce", () => {
    //#given: no raw search tools
    _setDisciplinePathForTesting(FAKE_PATH)
    //#when: resolved
    //#then: nothing to advertise
    expect(resolveGrepGlobUsable(["ctx_search"], { enforce: false })).toBe(false)
    expect(resolveGrepGlobUsable(["ctx_search"], { enforce: true })).toBe(false)
  })

  test("willBlockGrepGlob matrix", () => {
    //#given: substitute present
    _setDisciplinePathForTesting(FAKE_PATH)
    //#when: checked across configs
    //#then: blocks only when enforced AND grep/glob gated AND substitute taught
    expect(willBlockGrepGlob(undefined)).toBe(false)
    expect(willBlockGrepGlob({ enforce: false })).toBe(false)
    expect(willBlockGrepGlob({ enforce: true })).toBe(true)
    expect(willBlockGrepGlob({ enforce: true, blocked_tools: ["read"] })).toBe(false)
    expect(willBlockGrepGlob({ enforce: true, blocked_tools: ["glob"] })).toBe(true)
  })

  test("willBlockGrepGlob false without a substitute", () => {
    //#given: enforce on, nothing indexed
    _setDisciplinePathForTesting(null)
    //#when: checked
    //#then: hook must let grep/glob through
    expect(willBlockGrepGlob({ enforce: true })).toBe(false)
  })

  test("willBlockGrepGlob degrades to warn-only when substitute missing", () => {
    //#given: enforce on with grep in blocked_tools but no working substitute
    _setDisciplinePathForTesting(null)
    //#when: checked with grep explicitly gated
    //#then: warn-only — returns false so enforcement never hard-blocks
    expect(willBlockGrepGlob({ enforce: true, blocked_tools: ["grep", "glob", "webfetch"] })).toBe(false)
  })

  test("deriveContextModeRootFromFile finds package root", () => {
    //#given: a fixture mimicking an installed context-mode package
    const base = join(tmpdir(), "opencode", "ctxmode-fixture")
    const root = join(base, "node_modules", "context-mode")
    const pluginFile = join(root, "build", "adapters", "opencode", "plugin.js")
    rmSync(base, { recursive: true, force: true })
    mkdirSync(join(root, "build", "adapters", "opencode"), { recursive: true })
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "context-mode", version: "1.0.169" }))
    writeFileSync(pluginFile, "export {};\n")
    //#when: deriving the root from the resolved entry file
    const got = deriveContextModeRootFromFile(pluginFile)
    //#then: the package root is returned
    expect(got).toBe(root)
    rmSync(base, { recursive: true, force: true })
  })

  test("deriveContextModeRootFromFile returns null with no matching package.json", () => {
    //#given: a path whose ancestors have no context-mode package.json
    const base = join(tmpdir(), "opencode", "ctxmode-nopkg")
    const deep = join(base, "a", "b")
    rmSync(base, { recursive: true, force: true })
    mkdirSync(deep, { recursive: true })
    writeFileSync(join(deep, "file.js"), "export {};\n")
    //#when: deriving the root
    //#then: null — no matching root found
    expect(deriveContextModeRootFromFile(join(deep, "file.js"))).toBeNull()
    rmSync(base, { recursive: true, force: true })
  })

  test("resolveContextModeDisciplineInfo honors the testing override", () => {
    //#given: an explicit override path
    _setDisciplinePathForTesting(FAKE_PATH)
    //#when: info resolved
    const info = resolveContextModeDisciplineInfo()
    //#then: path is the override
    expect(info.path).toBe(FAKE_PATH)
    _setDisciplinePathForTesting(undefined)
  })

  test("resolveContextModeDisciplineInfo reports nulls when substitute missing", () => {
    //#given: no working substitute
    _setDisciplinePathForTesting(null)
    //#when: info resolved
    const info = resolveContextModeDisciplineInfo()
    //#then: both path and version are null
    expect(info).toEqual({ path: null, version: null })
  })
})
