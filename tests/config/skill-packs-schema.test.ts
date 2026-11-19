/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  DEFAULT_SKILL_PACK_MAX_STDOUT_BYTES,
  DEFAULT_SKILL_PACK_TIMEOUT_MS,
  MatrixxConfigSchema,
  SkillPacksConfigSchema,
} from "../../src/config/schema"

describe("skill_packs config schema", () => {
  test("accepts an empty object and applies documented defaults", () => {
    //#given
    const raw = {}

    //#when
    const result = SkillPacksConfigSchema.parse(raw)

    //#then
    expect(result.enabled).toBe(true)
    expect(result.auto_install).toBe(false)
    expect(result.timeout_ms).toBe(DEFAULT_SKILL_PACK_TIMEOUT_MS)
    expect(result.max_stdout_bytes).toBe(DEFAULT_SKILL_PACK_MAX_STDOUT_BYTES)
    expect(DEFAULT_SKILL_PACK_TIMEOUT_MS).toBe(12_000)
    expect(DEFAULT_SKILL_PACK_MAX_STDOUT_BYTES).toBe(12_288)
  })

  test("accepts enabled:false", () => {
    //#given
    const raw = { enabled: false }

    //#when
    const result = SkillPacksConfigSchema.parse(raw)

    //#then
    expect(result.enabled).toBe(false)
  })

  test("accepts a pinned_versions map", () => {
    //#given
    const raw = { pinned_versions: { "ui-ux-pro-max": "2.15.0" } }

    //#when
    const result = SkillPacksConfigSchema.parse(raw)

    //#then
    expect(result.pinned_versions).toEqual({ "ui-ux-pro-max": "2.15.0" })
  })

  test("accepts a fully specified block through MatrixxConfigSchema", () => {
    //#given
    const raw = {
      skill_packs: {
        enabled: true,
        root: "./skill-packs",
        auto_install: true,
        pinned_versions: { "ui-ux-pro-max": "2.15.0" },
        allow_network_packs: true,
        allow_api_key_packs: true,
        python_bin: "python3",
        disabled_packs: ["legacy-pack"],
        disabled_skills: ["legacy-pack/example"],
        timeout_ms: 30_000,
        max_stdout_bytes: 65_536,
      },
    }

    //#when
    const result = MatrixxConfigSchema.safeParse(raw)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.skill_packs?.python_bin).toBe("python3")
      expect(result.data.skill_packs?.timeout_ms).toBe(30_000)
    }
  })

  test("rejects wrong types", () => {
    //#given
    const invalidBlocks = [
      { enabled: "yes" },
      { auto_install: "no" },
      { pinned_versions: { "ui-ux-pro-max": 2 } },
      { timeout_ms: "12000" },
      { max_stdout_bytes: "12288" },
      { disabled_packs: "legacy-pack" },
      { disabled_skills: [1] },
      { allow_network_packs: "true" },
      { allow_api_key_packs: "true" },
      { root: 123 },
      { python_bin: 123 },
    ]

    //#when
    const results = invalidBlocks.map((block) => SkillPacksConfigSchema.safeParse(block))

    //#then
    for (const result of results) {
      expect(result.success).toBe(false)
    }
  })

  test("rejects a non-object skill_packs value through MatrixxConfigSchema", () => {
    //#given
    const raw = { skill_packs: "enabled" }

    //#when
    const result = MatrixxConfigSchema.safeParse(raw)

    //#then
    expect(result.success).toBe(false)
  })
})
