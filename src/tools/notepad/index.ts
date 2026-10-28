/**
 * Notepad tools barrel (Task 1).
 *
 * Path/template LOGIC is owned by `src/hooks/task-notepad-writer/` — this
 * barrel only re-exports it (thin wrappers allowed, no copies), so `grep
 * resolveNotepadPath src/` keeps a single definition. Tasks 2-3 build the
 * `notepad_create` / `notepad_read` / `notepad_append` / `notepad_list`
 * factories on top of these imports.
 */

export {
  renderCompletionStamp,
  renderNotepad,
  taskIdMarkerLine,
  taskIdMarkerPresent,
} from "../../hooks/task-notepad-writer/constants"
export type {
  BucketReason,
  NotepadResolution,
  NotepadTask,
  TaskNotepadWriterContext,
} from "../../hooks/task-notepad-writer/notepad-path"
export {
  countNotepadFiles,
  extractPlanName,
  findExistingNotepadForTask,
  findNotepadForTask,
  notepadsRootFor,
  resolveNotepadPath,
  slugifySubject,
} from "../../hooks/task-notepad-writer/notepad-path"
export type { NotepadErrorCode } from "./constants"
export {
  ADHOC_BUCKET,
  COMPLETED_STATUS,
  COMPLETION_SECTION_TITLE,
  MATRIXX_DIR_NAME,
  NOTEPAD_BUCKET_KEBAB_REGEX,
  NOTEPAD_ERROR_CODES,
  NOTEPAD_EXTENSION,
  NOTEPAD_FILENAME_KEBAB_REGEX,
  NOTEPADS_SUBDIR,
  PLAN_NAME_METADATA_KEY,
  SLUG_MAX_LENGTH,
} from "./constants"
export { createNotepadCreateTool } from "./notepad-create"
export { createNotepadReadTool } from "./notepad-read"
export type {
  NotepadBucketReason,
  NotepadBucketResolution,
  NotepadPathResolution,
  NotepadValidationError,
} from "./validation"
export { validateBucketName, validateNotepadFilePath } from "./validation"
