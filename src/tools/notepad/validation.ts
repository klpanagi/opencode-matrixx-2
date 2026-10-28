/**
 * Notepad path validation (Task 1).
 *
 * Path/template LOGIC lives in `src/hooks/task-notepad-writer/` (single
 * definition of `resolveNotepadPath`, `notepadsRootFor`, `findNotepadForTask`,
 * `renderNotepad`, `renderCompletionStamp` — imported, never copied).
 * This module only adds the tool-family argument validation, mirroring the
 * `validatePlanFilePath` resolve/relative confinement pattern from
 * `src/tools/plan/types.ts` plus the `isAllowedFile` workspace guard.
 */
import { basename, isAbsolute, join, relative, resolve } from "node:path"
import { isAllowedFile } from "../../hooks/oracle-md-only/path-policy"
import {
  ADHOC_BUCKET,
  MATRIXX_DIR_NAME,
  NOTEPAD_BUCKET_KEBAB_REGEX,
  NOTEPAD_ERROR_CODES,
  NOTEPAD_EXTENSION,
  NOTEPAD_FILENAME_KEBAB_REGEX,
  NOTEPADS_SUBDIR,
} from "./constants"

export type NotepadBucketReason = "plan-name" | "no-plan-name"

export interface NotepadBucketResolution {
  bucket: string
  reason: NotepadBucketReason
}

export interface NotepadPathResolution {
  resolved: string
  bucketDir: string
  bucket: string
}

export type NotepadValidationError = {
  error: typeof NOTEPAD_ERROR_CODES.invalidPlanName | typeof NOTEPAD_ERROR_CODES.invalidFilePath
  message: string
}

/**
 * Validate a planName/bucket argument.
 *
 * Empty (undefined/null/"") falls back to the adhoc bucket with reason
 * `no-plan-name` (mirrors the hook `resolveNotepadPath` no-plan-name arm).
 * Anything outside kebab `[a-z0-9-]+` — including `..`, `/`, `\\`, and
 * absolute paths — is rejected as `invalid_plan_name`.
 */
export function validateBucketName(planName: unknown): NotepadBucketResolution | NotepadValidationError {
  if (planName === undefined || planName === null || planName === "") {
    return { bucket: ADHOC_BUCKET, reason: "no-plan-name" }
  }
  if (typeof planName !== "string") {
    return {
      error: NOTEPAD_ERROR_CODES.invalidPlanName,
      message: `planName must be a string: ${String(planName)}`,
    }
  }
  if (!NOTEPAD_BUCKET_KEBAB_REGEX.test(planName)) {
    const detail = planName.includes("..")
      ? `planName must not contain '..': ${planName}`
      : `planName must match kebab-case ^[a-z0-9-]+$: ${planName}`
    return { error: NOTEPAD_ERROR_CODES.invalidPlanName, message: detail }
  }
  return { bucket: planName, reason: "plan-name" }
}

/**
 * Validate a notepad fileName inside a planName bucket.
 *
 * Mirrors `validatePlanFilePath`: basename must end `.md`, match kebab-case,
 * resolve inside the bucket dir (no `..` escape, no subdirectories), and pass
 * `isAllowedFile`. A bad bucket surfaces `invalid_plan_name`; every file
 * problem surfaces `invalid_file_path`.
 */
export function validateNotepadFilePath(
  fileName: string,
  planName: string | null | undefined,
  directory: string,
): NotepadPathResolution | NotepadValidationError {
  if (typeof fileName !== "string" || fileName.trim() === "") {
    return {
      error: NOTEPAD_ERROR_CODES.invalidFilePath,
      message: "fileName is required and must be a non-empty string",
    }
  }
  if (isAbsolute(fileName)) {
    return {
      error: NOTEPAD_ERROR_CODES.invalidFilePath,
      message: `fileName must not be absolute: ${fileName}`,
    }
  }
  const bucket = validateBucketName(planName)
  if ("error" in bucket) return bucket
  const base = basename(fileName)
  if (base !== fileName) {
    return {
      error: NOTEPAD_ERROR_CODES.invalidFilePath,
      message: `fileName must be directly inside the bucket dir (no subdirectories): ${fileName}`,
    }
  }
  if (!base.endsWith(NOTEPAD_EXTENSION)) {
    return {
      error: NOTEPAD_ERROR_CODES.invalidFilePath,
      message: `fileName must end with .md: ${fileName}`,
    }
  }
  if (!NOTEPAD_FILENAME_KEBAB_REGEX.test(base)) {
    return {
      error: NOTEPAD_ERROR_CODES.invalidFilePath,
      message: `fileName must match kebab-case ^[a-z0-9-]+\\.md$: ${base}`,
    }
  }
  const bucketDir = resolve(join(directory, MATRIXX_DIR_NAME, NOTEPADS_SUBDIR, bucket.bucket))
  const resolved = resolve(join(bucketDir, fileName))
  const relToBucket = relative(bucketDir, resolved)
  if (relToBucket.startsWith("..") || isAbsolute(relToBucket)) {
    return {
      error: NOTEPAD_ERROR_CODES.invalidFilePath,
      message: `fileName must stay inside bucket ${bucket.bucket}: ${fileName}`,
    }
  }
  if (relToBucket.includes("/") || relToBucket.includes("\\")) {
    return {
      error: NOTEPAD_ERROR_CODES.invalidFilePath,
      message: `fileName must be directly inside bucket ${bucket.bucket} (no subdirectories): ${fileName}`,
    }
  }
  if (!isAllowedFile(resolved, directory)) {
    return {
      error: NOTEPAD_ERROR_CODES.invalidFilePath,
      message: `fileName not allowed (must be inside .matrixx/*.md): ${fileName}`,
    }
  }
  return { resolved, bucketDir, bucket: bucket.bucket }
}
