/**
 * Notepad Tool Constants
 *
 * Barrel only. The `task-notepad-writer` hook owns every notepad-storage
 * constant: `MATRIXX_DIR_NAME`, `NOTEPADS_SUBDIR`, `NOTEPAD_EXTENSION`,
 * `ADHOC_BUCKET`, `PLAN_NAME_METADATA_KEY`, `SLUG_MAX_LENGTH`, plus the
 * template helpers (`renderNotepad`, `renderCompletionStamp`,
 * `taskIdMarkerLine`/`taskIdMarkerPresent`).
 * This file MUST NEVER re-declare them — import the owner instead, so a
 * duplicated bucket/template definition cannot come back.
 * Only notepad-tool-only constants live here.
 */
export {
  ADHOC_BUCKET,
  COMPLETED_STATUS,
  COMPLETION_SECTION_TITLE,
  MATRIXX_DIR_NAME,
  NOTEPAD_EXTENSION,
  NOTEPADS_SUBDIR,
  PLAN_EXTENSION,
  PLAN_NAME_METADATA_KEY,
  PLANS_SUBDIR,
  SLUG_MAX_LENGTH,
} from "../../hooks/task-notepad-writer/constants"

/** Bucket/planName vocabulary: kebab-case `[a-z0-9-]+` (mirrors `PLAN_BASENAME_KEBAB_REGEX`). */
export const NOTEPAD_BUCKET_KEBAB_REGEX = /^[a-z0-9-]+$/

/** File vocabulary: kebab-case basename ending in `.md` (mirrors `PLAN_FILENAME_KEBAB_REGEX`). */
export const NOTEPAD_FILENAME_KEBAB_REGEX = /^[a-z0-9-]+\.md$/

/** Error vocabulary shared by the notepad tool family (Tasks 2-3). */
export const NOTEPAD_ERROR_CODES = {
  invalidPlanName: "invalid_plan_name",
  invalidFilePath: "invalid_file_path",
  notFound: "not_found",
} as const

export type NotepadErrorCode = (typeof NOTEPAD_ERROR_CODES)[keyof typeof NOTEPAD_ERROR_CODES]
