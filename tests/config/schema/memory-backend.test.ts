/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  MemoryConfigSchema,
  resolveMemoryBackend,
} from "../../../src/config/schema/memory"
import {
  detectMemoryBackendTools,
  getMemoryBackendMissingWarning,
  getMemoryBackendRoutingHint,
  isMemoryBackendSatisfied,
} from "../../../src/shared/memory-backend-detect"

describe("memory.backend selector", () => {
  test("defaults to off with empty input", () => {
    //#given empty input
    const input = {}
    //#when resolving
    const parsed = MemoryConfigSchema.parse(input)
    //#then backend is off
    expect(parsed.backend).toBe("off")
    expect(resolveMemoryBackend(parsed)).toBe("off")
  })

  test("legacy {enabled:false} parses and means off", () => {
    //#given legacy flat disabled config
    const input = { enabled: false }
    //#when parsing and resolving
    const parsed = MemoryConfigSchema.parse(input)
    //#then still loads and resolves off
    expect(parsed.backend).toBe("off")
    expect(resolveMemoryBackend(parsed)).toBe("off")
  })

  test("flat {enabled:true} resolves to native (deprecated alias)", () => {
    //#given legacy flat enabled config
    const input = { enabled: true }
    //#when parsing and resolving
    const parsed = MemoryConfigSchema.parse(input)
    //#then resolves to native
    expect(resolveMemoryBackend(parsed)).toBe("native")
  })

  test("{backend:native,native:{enabled:true}} resolves to native", () => {
    //#given explicit native backend with native opt-in
    const input = { backend: "native", native: { enabled: true } }
    //#when parsing and resolving
    const parsed = MemoryConfigSchema.parse(input)
    //#then resolves to native
    expect(resolveMemoryBackend(parsed)).toBe("native")
  })

  test("{backend:lcm,native:{enabled:true}} resolves to lcm (native ignored)", () => {
    //#given explicit lcm backend with native enabled
    const input = { backend: "lcm", native: { enabled: true } }
    //#when parsing and resolving
    const parsed = MemoryConfigSchema.parse(input)
    //#then explicit backend wins
    expect(resolveMemoryBackend(parsed)).toBe("lcm")
  })

  test("{backend:supermemory} resolves to supermemory", () => {
    //#given explicit supermemory backend
    const input = { backend: "supermemory" }
    //#when parsing and resolving
    const parsed = MemoryConfigSchema.parse(input)
    //#then resolves to supermemory
    expect(resolveMemoryBackend(parsed)).toBe("supermemory")
  })

  test("{backend:redis} throws", () => {
    //#given an unknown backend
    const input = { backend: "redis" }
    //#when parsing
    const result = MemoryConfigSchema.safeParse(input)
    //#then validation fails
    expect(result.success).toBe(false)
  })

  test("native defaults preserved under nesting", () => {
    //#given empty input
    const input = {}
    //#when parsing
    const parsed = MemoryConfigSchema.parse(input)
    //#then per-message/compact/retention defaults intact
    expect(parsed.native.perMessageBudget).toBe(110)
    expect(parsed.native.compactContextLimit).toBe(1200)
    expect(parsed.native.retention.deletedSessionDays).toBe(30)
  })

  test("nullish config resolves to off and never throws", () => {
    //#given missing config
    //#when resolving undefined and null
    //#then off without throwing
    expect(resolveMemoryBackend(undefined)).toBe("off")
    expect(resolveMemoryBackend(null)).toBe("off")
  })
})

describe("detectMemoryBackendTools", () => {
  test("detects lcm_* tools", () => {
    //#given a catalog with lcm tools
    const names = ["read", "lcm_grep", "lcm_describe"]
    //#when detecting
    const detection = detectMemoryBackendTools(names)
    //#then lcm present, supermemory absent
    expect(detection.hasLcmTools).toBe(true)
    expect(detection.hasSupermemoryTools).toBe(false)
    expect(isMemoryBackendSatisfied("lcm", detection)).toBe(true)
    expect(isMemoryBackendSatisfied("supermemory", detection)).toBe(false)
  })

  test("detects supermemory tools", () => {
    //#given a catalog with supermemory tools
    const names = ["read", "supermemory", "supermemory_recall"]
    //#when detecting
    const detection = detectMemoryBackendTools(names)
    //#then supermemory present, lcm absent
    expect(detection.hasLcmTools).toBe(false)
    expect(detection.hasSupermemoryTools).toBe(true)
    expect(isMemoryBackendSatisfied("supermemory", detection)).toBe(true)
    expect(isMemoryBackendSatisfied("lcm", detection)).toBe(false)
  })

  test("empty catalog fails open (no detection, native/off unaffected)", () => {
    //#given an empty catalog (startup ordering)
    const names: string[] = []
    //#when detecting
    const detection = detectMemoryBackendTools(names)
    //#then nothing detected, native and off always satisfied
    expect(detection.hasLcmTools).toBe(false)
    expect(detection.hasSupermemoryTools).toBe(false)
    expect(isMemoryBackendSatisfied("native", detection)).toBe(true)
    expect(isMemoryBackendSatisfied("off", detection)).toBe(true)
  })

  test("missing warnings name the install path", () => {
    //#given each external backend
    //#when building warnings
    const lcmWarning = getMemoryBackendMissingWarning("lcm")
    const supermemoryWarning = getMemoryBackendMissingWarning("supermemory")
    //#then each names its plugin and env/config
    expect(lcmWarning).toContain("opencode-lcm")
    expect(supermemoryWarning).toContain("opencode-supermemory")
    expect(supermemoryWarning).toContain("SUPERMEMORY_API_KEY")
    expect(getMemoryBackendMissingWarning("native")).toBe("")
    expect(getMemoryBackendRoutingHint("lcm")).toContain("lcm_*")
    expect(getMemoryBackendRoutingHint("supermemory")).toContain("supermemory_recall")
  })
})
