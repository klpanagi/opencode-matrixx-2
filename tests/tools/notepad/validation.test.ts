/// <reference types="bun-types" />

/**
 * Task 1 — Shared notepad path/template helpers (reuse, don\'t duplicate).
 *
 * TDD contract for the notepad validation vocabulary consumed by Tasks 2-3:
 * - planName/bucket kebab [a-z0-9-]+, reject `..`, `/`, absolute paths;
 *   empty planName falls back to the adhoc bucket (reason `no-plan-name`).
 * - fileName must end `.md`, match kebab-case, and stay inside its bucket dir.
 * - Error vocabulary: `invalid_plan_name`, `invalid_file_path`, `not_found`.
 * - Path/template helpers are REUSED from the hook dir (single definition
 *   of `resolveNotepadPath`); `src/tools/notepad/` only re-exports them.
 */
import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  ADHOC_BUCKET,
  findNotepadForTask,
  notepadsRootFor,
  renderCompletionStamp,
  renderNotepad,
  resolveNotepadPath,
  taskIdMarkerLine,
  taskIdMarkerPresent,
} from "../../../src/tools/notepad/index"
import {
  NOTEPAD_BUCKET_KEBAB_REGEX,
  NOTEPAD_ERROR_CODES,
  NOTEPAD_FILENAME_KEBAB_REGEX,
} from "../../../src/tools/notepad/constants"
import {
  validateBucketName,
  validateNotepadFilePath,
} from "../../../src/tools/notepad/validation"

describe("notepad bucket validation", () => {
  test("accepts a kebab-case bucket name", () => {
    //#given a valid kebab-case plan name
    const planName = "notepad-tools"
    //#when validated
    const result = validateBucketName(planName)
    //#then the bucket is used verbatim
    expect(result).toEqual({ bucket: "notepad-tools", reason: "plan-name" })
  })

  test("rejects path traversal in the bucket name", () => {
    //#given a traversal payload
    const planName = "../../etc"
    //#when validated
    const result = validateBucketName(planName)
    //#then the invalid_plan_name vocabulary is returned
    expect(result).toEqual({
      error: NOTEPAD_ERROR_CODES.invalidPlanName,
      message: expect.stringContaining(".."),
    })
  })

  test("rejects slashes in the bucket name", () => {
    //#given a bucket name containing a slash
    const planName = "a/b"
    //#when validated
    const result = validateBucketName(planName)
    //#then it is rejected as invalid_plan_name
    expect(result).toEqual({
      error: "invalid_plan_name",
      message: expect.any(String),
    })
  })

  test("rejects absolute bucket paths", () => {
    //#given an absolute path as bucket
    const planName = "/tmp/evil"
    //#when validated
    const result = validateBucketName(planName)
    //#then it is rejected as invalid_plan_name
    expect(result).toEqual({
      error: "invalid_plan_name",
      message: expect.any(String),
    })
  })

  test("rejects uppercase and non-kebab characters", () => {
    //#given bucket names outside [a-z0-9-]
    //#when validated
    //#then each is rejected as invalid_plan_name
    for (const bad of ["Notepad-Tools", "my_plan", "a b", "caf\u00e9"]) {
      expect(validateBucketName(bad)).toEqual({
        error: "invalid_plan_name",
        message: expect.any(String),
      })
    }
  })

  test("empty planName falls back to the adhoc bucket", () => {
    //#given no plan name (empty string, null, undefined)
    //#when validated
    //#then the adhoc bucket is used with reason no-plan-name
    expect(validateBucketName("")).toEqual({ bucket: ADHOC_BUCKET, reason: "no-plan-name" })
    expect(validateBucketName(null)).toEqual({ bucket: ADHOC_BUCKET, reason: "no-plan-name" })
    expect(validateBucketName(undefined)).toEqual({ bucket: ADHOC_BUCKET, reason: "no-plan-name" })
    expect(ADHOC_BUCKET).toBe("adhoc")
  })
})

describe("validateNotepadFilePath", () => {
  const directory = join(tmpdir(), "notepad-validation-test")

  test("accepts a kebab-case .md file inside the bucket dir", () => {
    //#given a valid file + bucket pair
    //#when validated
    const result = validateNotepadFilePath("learnings.md", "notepad-tools", directory)
    //#then the resolved path stays inside the bucket dir
    expect(result).toEqual({
      resolved: join(directory, ".matrixx", "notepads", "notepad-tools", "learnings.md"),
      bucketDir: join(directory, ".matrixx", "notepads", "notepad-tools"),
      bucket: "notepad-tools",
    })
  })

  test("empty planName resolves inside the adhoc bucket", () => {
    //#given no plan name
    //#when validated
    const result = validateNotepadFilePath("learnings.md", undefined, directory)
    //#then the adhoc bucket dir owns the resolved path
    expect(result).toEqual({
      resolved: join(directory, ".matrixx", "notepads", "adhoc", "learnings.md"),
      bucketDir: join(directory, ".matrixx", "notepads", "adhoc"),
      bucket: "adhoc",
    })
  })

  test("rejects traversal in fileName", () => {
    //#given a traversal payload in fileName
    //#when validated
    const result = validateNotepadFilePath("../evil.md", "notepad-tools", directory)
    //#then the invalid_file_path vocabulary is returned
    expect(result).toEqual({
      error: NOTEPAD_ERROR_CODES.invalidFilePath,
      message: expect.any(String),
    })
  })

  test("rejects absolute fileName paths", () => {
    //#given an absolute fileName
    //#when validated
    const result = validateNotepadFilePath("/tmp/evil.md", "notepad-tools", directory)
    //#then it is rejected as invalid_file_path
    expect(result).toEqual({ error: "invalid_file_path", message: expect.any(String) })
  })

  test("rejects fileName values that do not end with .md", () => {
    //#given non-markdown file names
    //#when validated
    //#then each is rejected as invalid_file_path
    for (const bad of ["learnings", "learnings.txt", "learnings.md.bak"]) {
      expect(validateNotepadFilePath(bad, "notepad-tools", directory)).toEqual({
        error: "invalid_file_path",
        message: expect.any(String),
      })
    }
  })

  test("rejects non-kebab fileName values and nested subdirectories", () => {
    //#given file names outside kebab-case or with separators
    //#when validated
    //#then each is rejected as invalid_file_path
    for (const bad of ["My Notes.md", "my_notes.md", "sub/dir.md", "a\\\\b.md"]) {
      expect(validateNotepadFilePath(bad, "notepad-tools", directory)).toEqual({
        error: "invalid_file_path",
        message: expect.any(String),
      })
    }
  })

  test("rejects empty fileName values", () => {
    //#given empty / blank file names
    //#when validated
    //#then each is rejected as invalid_file_path
    for (const bad of ["", "   "]) {
      expect(validateNotepadFilePath(bad, "notepad-tools", directory)).toEqual({
        error: "invalid_file_path",
        message: expect.any(String),
      })
    }
  })

  test("surfaces invalid_plan_name for a bad bucket", () => {
    //#given a valid fileName but a traversal bucket
    //#when validated
    const result = validateNotepadFilePath("learnings.md", "../../etc", directory)
    //#then the plan-name error takes precedence
    expect(result).toEqual({ error: "invalid_plan_name", message: expect.any(String) })
  })

  test("error vocabulary covers the tool family", () => {
    //#given the shared error-code table
    //#when read
    //#then every code Tasks 2-3 need is declared
    expect(NOTEPAD_ERROR_CODES).toEqual({
      invalidPlanName: "invalid_plan_name",
      invalidFilePath: "invalid_file_path",
      notFound: "not_found",
    })
  })
})

describe("hook helper reuse (no duplication)", () => {
  test("re-exports the hook-owned path and template helpers", () => {
    //#given the notepad tool barrel
    //#when inspected
    //#then every hook helper is available by reference (not copied)
    expect(typeof resolveNotepadPath).toBe("function")
    expect(typeof notepadsRootFor).toBe("function")
    expect(typeof findNotepadForTask).toBe("function")
    expect(typeof renderNotepad).toBe("function")
    expect(typeof renderCompletionStamp).toBe("function")
    expect(typeof taskIdMarkerLine).toBe("function")
    expect(typeof taskIdMarkerPresent).toBe("function")
  })

  test("rendered notepads carry the hook task-id marker", () => {
    //#given a rendered notepad
    const rendered = renderNotepad({
      subject: "probe",
      taskId: "T-123",
      startedAt: new Date(0).toISOString(),
    })
    //#when checked for the idempotency marker
    //#then the hook lookup can find tool-created files
    expect(rendered).toContain(taskIdMarkerLine("T-123"))
    expect(taskIdMarkerPresent(rendered, "T-123")).toBe(true)
    expect(rendered).toContain("## Findings")
  })

  test("bucket regexes mirror the plan kebab vocabulary", () => {
    //#given both regex tables
    //#when compared
    //#then buckets match PLAN_BASENAME_KEBAB semantics and files match PLAN_FILENAME_KEBAB semantics
    expect(NOTEPAD_BUCKET_KEBAB_REGEX.source).toBe(/^[a-z0-9-]+$/.source)
    expect(NOTEPAD_FILENAME_KEBAB_REGEX.source).toBe(/^[a-z0-9-]+\.md$/.source)
  })
})
