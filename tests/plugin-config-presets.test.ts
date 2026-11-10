/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test"
import type { MatrixxConfig } from "../src/config/schema/matrixx-config"
import { mergeFileAndInlinePresets } from "../src/config/preset-file-loader"
import { mergeConfigs } from "../src/plugin-config"

describe("mergeConfigs model_presets", () => {
  test("shallow-merges per preset name with override winning", () => {
    //#given base and override configs with overlapping preset names
    const base = {
      model_presets: {
        eco: { default_model: "p/base" },
        keep: { default_model: "p/keep" },
      },
    } as MatrixxConfig
    const override = {
      model_presets: { eco: { default_model: "p/override" } },
    } as MatrixxConfig

    //#when merged
    const result = mergeConfigs(base, override)

    //#then override wins per preset name, base-only names preserved
    expect(result.model_presets?.eco?.default_model).toBe("p/override")
    expect(result.model_presets?.keep?.default_model).toBe("p/keep")
  })

  test("leaves model_presets undefined when neither side defines it", () => {
    //#given configs without presets
    //#when merged
    const result = mergeConfigs({} as MatrixxConfig, {} as MatrixxConfig)
    //#then still undefined (not an empty object)
    expect(result.model_presets).toBeUndefined()
  })

  test("carries model_presets_file via spread with override winning", () => {
    //#given both sides set a pointer
    const base = { model_presets_file: "base.jsonc" } as MatrixxConfig
    const override = { model_presets_file: "override.jsonc" } as MatrixxConfig
    //#when merged
    expect(mergeConfigs(base, override).model_presets_file).toBe("override.jsonc")
    //#then base pointer survives when override is silent
    expect(mergeConfigs(base, {} as MatrixxConfig).model_presets_file).toBe("base.jsonc")
  })
})

describe("mergeFileAndInlinePresets", () => {
  test("inline entries override file entries per preset name", () => {
    //#given file presets plus inline overrides
    const file = { eco: { default_model: "p/file" }, shared: { default_model: "p/file-shared" } }
    const inline = { eco: { default_model: "p/inline" } }

    //#when merged
    const result = mergeFileAndInlinePresets(file, inline)

    //#then inline wins for eco, file-only names preserved
    expect(result?.eco?.default_model).toBe("p/inline")
    expect(result?.shared?.default_model).toBe("p/file-shared")
  })

  test("returns undefined when both sides are absent", () => {
    //#given nothing on either side
    //#when merged
    //#then undefined
    expect(mergeFileAndInlinePresets(null, undefined)).toBeUndefined()
  })
})
