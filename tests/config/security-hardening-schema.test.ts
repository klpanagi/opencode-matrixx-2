import { describe, expect, test } from "bun:test"
import {
  SecurityConfigSchema,
  type AutoUpdateConfig,
  type CommandExpansionConfig,
  type DocumentReaderConfig,
  type FileReferenceConfig,
  type LoggingConfig,
} from "../../src/config/schema/security"

describe("SecurityConfigSchema hardening defaults", () => {
  test("fills every new block when security is empty", () => {
    //#given an empty security config
    //#when
    const parsed = SecurityConfigSchema.parse({})

    //#then every new block carries fail-closed defaults
    expect(parsed.command_expansion).toEqual({
      project_scope_execution: false,
      project_scope_file_refs: false,
      allowlist: [],
    })
    expect(parsed.file_reference).toEqual({ max_bytes: 262144, max_total_bytes: 1048576 })
    expect(parsed.logging).toEqual({ max_bytes: 1048576, max_files: 3, redact: true })
    expect(parsed.document_reader).toEqual({ enabled: false })
    expect(parsed.auto_update).toEqual({ auto_install: false, require_integrity: true })
  })

  test("merges a partial block over its defaults", () => {
    //#given only one logging field is supplied
    const input = { logging: { max_files: 7 } }

    //#when
    const parsed = SecurityConfigSchema.parse(input)

    //#then the override wins and the remaining fields keep defaults
    expect(parsed.logging).toEqual({ max_bytes: 1048576, max_files: 7, redact: true })
    expect(parsed.document_reader).toEqual({ enabled: false })
  })

  test("keeps pre-existing security blocks working", () => {
    //#given a config that only touches the older keys
    const input = { secret_scanning: { enabled: false } }

    //#when
    const parsed = SecurityConfigSchema.parse(input)

    //#then the old defaults are unchanged
    expect(parsed.secret_scanning).toEqual({
      enabled: false,
      tool: "gitleaks",
      block_on_detection: true,
    })
    expect(parsed.env_file_guard).toBeUndefined()
  })

  test("exposes inferred types for every new block", () => {
    //#given a fully parsed security config
    const parsed = SecurityConfigSchema.parse({})

    //#when narrowing each block to its exported type
    const commandExpansion: CommandExpansionConfig = parsed.command_expansion
    const fileReference: FileReferenceConfig = parsed.file_reference
    const logging: LoggingConfig = parsed.logging
    const documentReader: DocumentReaderConfig = parsed.document_reader
    const autoUpdate: AutoUpdateConfig = parsed.auto_update

    //#then the values remain intact under their declared types
    expect([commandExpansion, fileReference, logging, documentReader, autoUpdate].map(Boolean)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ])
  })

  test("rejects wrong types in every new block", () => {
    //#given payloads whose values do not match the declared types
    const invalidInputs = [
      { command_expansion: { project_scope_execution: "yes" } },
      { command_expansion: { allowlist: "npm" } },
      { file_reference: { max_bytes: "262144" } },
      { logging: { redact: "no" } },
      { document_reader: { enabled: 1 } },
      { auto_update: { auto_install: "later" } },
    ]

    //#when/then each one fails validation
    for (const input of invalidInputs) {
      expect(SecurityConfigSchema.safeParse(input).success).toBe(false)
    }
  })
})
