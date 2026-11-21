import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join, resolve, sep } from "node:path"
import z from "zod"
import type { CommentCheckerConfig } from "../../config/schema"
import {
  type CommentFinding,
  formatReport,
  type ScanResult,
  type ScanSource,
  type ScanTier,
  scanSources,
} from "../../shared/comment-scan"
import { MAX_FILE_BYTES } from "../../shared/comment-scan/constants"
import { startBackgroundInit } from "../../tools/ast-grep/cli"
import { registerPendingCall, startPendingCallCleanup, takePendingCall } from "./pending-calls"
import type { PendingCall, PendingEdit } from "./types"

const DEBUG = process.env.COMMENT_CHECKER_DEBUG === "1"
const DEBUG_FILE = join(tmpdir(), "comment-checker-debug.log")

const BODY_PREFIX_LIMIT = 40
const FULL_BODY_KEYS = new Set(["content"])
const DIFF_BODY_KEYS = new Set(["patch", "diff"])
const EDIT_BODY_KEYS = new Set(["oldString", "newString", "old_string", "new_string"])

function redactForLog(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactForLog)
  if (value === null || typeof value !== "object") return value

  const redacted: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" && FULL_BODY_KEYS.has(key)) {
      redacted[key] = { contentLength: entry.length, prefix: entry.slice(0, BODY_PREFIX_LIMIT) }
    } else if (typeof entry === "string" && DIFF_BODY_KEYS.has(key)) {
      redacted[key] = `[redacted ${entry.length} chars]`
    } else if (typeof entry === "string" && EDIT_BODY_KEYS.has(key)) {
      redacted[`${key}Length`] = entry.length
    } else {
      redacted[key] = redactForLog(entry)
    }
  }
  return redacted
}

function debugLog(...args: unknown[]) {
  if (DEBUG) {
    const msg = `[${new Date().toISOString()}] [comment-checker:hook] ${args
      .map((a) => (typeof a === "object" ? JSON.stringify(redactForLog(a), null, 2) : String(a)))
      .join(" ")}\n`
    fs.appendFileSync(DEBUG_FILE, msg, { mode: 0o600 })
  }
}

const PatchV2FileSchema = z.object({
  file: z.string(),
  patch: z.string().optional(),
  status: z.string().optional(),
  additions: z.number().optional(),
  deletions: z.number().optional(),
})

const PatchLegacyFileSchema = z.object({
  filePath: z.string(),
  movePath: z.string().optional(),
  before: z.string(),
  after: z.string(),
  type: z.string().optional(),
})

const PatchMetadataSchema = z.object({
  files: z.array(z.union([PatchV2FileSchema, PatchLegacyFileSchema])),
})

type PatchV2File = z.infer<typeof PatchV2FileSchema>
type PatchFile = z.infer<typeof PatchMetadataSchema>["files"][number]

interface AddedRange {
  readonly start: number
  readonly end: number
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/
const DELETED_PATCH_STATUSES = new Set(["deleted", "removed"])

function isDeletedPatchFile(file: PatchFile): boolean {
  if ("filePath" in file) return file.type === "delete"
  return file.status !== undefined && DELETED_PATCH_STATUSES.has(file.status)
}

function parseAddedLineRanges(patch: string): AddedRange[] | null {
  const lines = patch.split(/\r?\n/)
  const ranges: AddedRange[] = []
  let newLine = 0
  let sawHunk = false
  let inHunk = false
  let expectedNewLines = 0
  let seenNewLines = 0
  let rangeStart: number | null = null
  let rangeEnd = 0

  const flushRange = () => {
    if (rangeStart !== null) ranges.push({ start: rangeStart, end: rangeEnd })
    rangeStart = null
  }

  const finishHunk = (): boolean => {
    if (!inHunk) return true
    flushRange()
    inHunk = false
    return seenNewLines === expectedNewLines
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ""
    if (line.startsWith("@@")) {
      if (!finishHunk()) return null
      const header = HUNK_HEADER.exec(line)
      if (!header) return null
      sawHunk = true
      inHunk = true
      newLine = Number(header[1])
      expectedNewLines = header[2] === undefined ? 1 : Number(header[2])
      seenNewLines = 0
      continue
    }
    if (!inHunk) continue
    if (line.startsWith("\\")) continue
    if (index === lines.length - 1 && line.length === 0) continue
    if (line.startsWith("+")) {
      if (rangeStart === null) rangeStart = newLine
      rangeEnd = newLine
      newLine += 1
      seenNewLines += 1
      continue
    }
    if (line.startsWith("-")) continue
    // Context lines carry a leading space; tolerate a truly empty line as context.
    if (line.length !== 0 && !line.startsWith(" ")) return null
    flushRange()
    newLine += 1
    seenNewLines += 1
  }

  if (!finishHunk()) return null
  return sawHunk ? ranges : null
}

function lineInRanges(line: number, ranges: readonly AddedRange[]): boolean {
  return ranges.some((range) => line >= range.start && line <= range.end)
}

function readPatchSource(file: PatchV2File): { source: ScanSource; ranges: AddedRange[] | null } | null {
  // The hook has no ctx.directory, so process.cwd() is the confinement root.
  const root = process.cwd()
  const absolutePath = isAbsolute(file.file) ? resolve(file.file) : resolve(root, file.file)
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${sep}`)) {
    debugLog("patch: path escapes the working root, skipping", { file: file.file })
    return null
  }

  let realPath: string
  let realRoot: string
  try {
    realRoot = fs.realpathSync(root)
    realPath = fs.realpathSync(absolutePath)
  } catch (err) {
    debugLog("patch: failed to canonicalise path, skipping", { file: file.file }, err)
    return null
  }
  if (realPath !== realRoot && !realPath.startsWith(`${realRoot}${sep}`)) {
    debugLog("patch: canonical path escapes the working root, skipping", { file: file.file })
    return null
  }

  let fd: number
  try {
    // O_NONBLOCK keeps a FIFO from blocking the after hook before fstat can reject it.
    fd = fs.openSync(
      realPath,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | (fs.constants.O_NONBLOCK ?? 0),
    )
  } catch (err) {
    debugLog("patch: failed to open canonical file, skipping", { file: file.file }, err)
    return null
  }

  try {
    // Type and size come from the open descriptor, closing the stat -> read race.
    const stats = fs.fstatSync(fd)
    if (!stats.isFile()) {
      debugLog("patch: not a regular file, skipping", { file: file.file })
      return null
    }
    if (stats.size > MAX_FILE_BYTES) {
      debugLog("patch: file exceeds the size cap, skipping", { file: file.file, size: stats.size })
      return null
    }
    const text = fs.readFileSync(fd, "utf8")
    const ranges = file.patch === undefined ? null : parseAddedLineRanges(file.patch)
    if (ranges === null) {
      debugLog("patch: no parsable diff, scanning the whole file", { file: file.file })
    }
    return { source: { filePath: file.file, text }, ranges }
  } catch (err) {
    debugLog("patch: failed to read file, skipping", { file: file.file }, err)
    return null
  } finally {
    fs.closeSync(fd)
  }
}

function withCompare(filePath: string, text: string, compareText: string | undefined): ScanSource {
  return compareText === undefined ? { filePath, text } : { filePath, text, compareText }
}

function resolveEditPath(sharedFilePath: string, edit: PendingEdit): string {
  return edit.filePath ?? edit.file_path ?? edit.path ?? sharedFilePath
}

function sourcesForPendingCall(pendingCall: PendingCall): ScanSource[] {
  switch (pendingCall.tool) {
    case "write":
      if (pendingCall.content === undefined) return []
      return [{ filePath: pendingCall.filePath, text: pendingCall.content }]
    case "edit":
      if (pendingCall.newString === undefined) return []
      return [withCompare(pendingCall.filePath, pendingCall.newString, pendingCall.oldString)]
    case "multiedit":
      return (pendingCall.edits ?? []).flatMap((edit) => {
        if (typeof edit.new_string !== "string") return []
        const oldString = typeof edit.old_string === "string" ? edit.old_string : undefined
        return [
          withCompare(resolveEditPath(pendingCall.filePath, edit), edit.new_string, oldString),
        ]
      })
  }
}

function tierOf(findings: readonly CommentFinding[]): ScanTier {
  return findings.some((finding) => finding.tier === "ast") ? "ast" : "regex"
}

type ScanSourcesFn = (sources: readonly ScanSource[]) => Promise<ScanResult>

let scanSourcesFn: ScanSourcesFn = (sources) => scanSources(sources)

/** Test seam: inject the scan function; pass null to restore the real one. */
export function _setCommentScanSourcesForTesting(scan: ScanSourcesFn | null): void {
  scanSourcesFn = scan ?? ((sources) => scanSources(sources))
}

interface ScanReportOptions {
  readonly addedRangesByFile?: ReadonlyMap<string, readonly AddedRange[]>
}

function countOutsideAddedRanges(
  findings: readonly CommentFinding[],
  addedRangesByFile: ReadonlyMap<string, readonly AddedRange[]> | undefined,
): number {
  if (!addedRangesByFile) return 0
  let outside = 0
  for (const finding of findings) {
    const ranges = addedRangesByFile.get(finding.file)
    if (ranges === undefined) continue
    if (!lineInRanges(finding.line, ranges)) outside += 1
  }
  return outside
}

async function appendScanReport(
  sources: readonly ScanSource[],
  output: { output?: string },
  config: CommentCheckerConfig | undefined,
  options: ScanReportOptions = {},
): Promise<void> {
  if (sources.length === 0) return

  const result = await scanSourcesFn(sources)
  if (result.skipped === "binary-missing" && result.findings.length === 0) {
    debugLog("ast-grep not available, skipping comment check")
    return
  }

  const findings = result.findings
  if (findings.length === 0) return

  const predating = countOutsideAddedRanges(findings, options.addedRangesByFile)

  const message = formatReport({
    findings,
    filePath: sources[0]?.filePath ?? "",
    tier: tierOf(findings),
    includeRubric: true,
    customPrompt: config?.custom_prompt,
  })

  const annotation =
    predating === 0 ? "" : `\n${predating} finding(s) in this file may predate the patch.`
  debugLog(
    "detected comments, appending message:",
    sources.map((source) => source.filePath),
    { predating },
  )
  output.output = `${output.output ?? ""}\n\n${message}${annotation}`
}

export function createCommentCheckerHooks(config?: CommentCheckerConfig) {
  debugLog("createCommentCheckerHooks called", { config })

  startPendingCallCleanup()
  startBackgroundInit()

  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> },
    ): Promise<void> => {
      const toolLower = input.tool.toLowerCase()
      if (toolLower !== "patch" && toolLower !== "apply_patch") {
        debugLog("tool.execute.before:", {
          tool: input.tool,
          callID: input.callID,
          args: output.args,
        })
      }
      if (toolLower !== "write" && toolLower !== "edit" && toolLower !== "multiedit") {
        debugLog("skipping non-write/edit tool:", toolLower)
        return
      }

      const filePath = (output.args.filePath ??
        output.args.file_path ??
        output.args.path) as string | undefined
      const content = output.args.content as string | undefined
      const oldString = (output.args.oldString ?? output.args.old_string) as string | undefined
      const newString = (output.args.newString ?? output.args.new_string) as string | undefined
      const edits = output.args.edits as PendingEdit[] | undefined

      debugLog("extracted filePath:", filePath)

      if (!filePath) {
        debugLog("no filePath found")
        return
      }

      debugLog("registering pendingCall:", {
        callID: input.callID,
        filePath,
        tool: toolLower,
      })
      registerPendingCall(input.callID, {
        filePath,
        content,
        oldString,
        newString,
        edits,
        tool: toolLower as PendingCall["tool"],
        sessionID: input.sessionID,
        timestamp: Date.now(),
      })
    },

    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title?: string; output?: string; metadata: unknown },
    ): Promise<void> => {
      debugLog("tool.execute.after:", { tool: input.tool, callID: input.callID })

      const toolLower = input.tool.toLowerCase()

      // The V2 bridge only forwards completed results, so the title is the remaining failure signal.
      if (/^(error|failed|could not)\b/i.test(output.title ?? "")) {
        debugLog("skipping due to tool failure in output title")
        return
      }

      if (toolLower === "patch" || toolLower === "apply_patch") {
        const parsed = PatchMetadataSchema.safeParse(output.metadata)
        if (!parsed.success) {
          debugLog("patch metadata schema mismatch, skipping")
          return
        }

        const sources: ScanSource[] = []
        const rangesByFile = new Map<string, AddedRange[]>()

        for (const file of parsed.data.files) {
          if (isDeletedPatchFile(file)) continue
          if ("filePath" in file) {
            sources.push({
              filePath: file.movePath ?? file.filePath,
              text: file.after,
              compareText: file.before,
            })
            continue
          }
          const scanned = readPatchSource(file)
          if (!scanned) continue
          sources.push(scanned.source)
          if (scanned.ranges) rangesByFile.set(scanned.source.filePath, scanned.ranges)
        }

        if (sources.length === 0) {
          debugLog("patch had no editable files, skipping")
          return
        }

        try {
          await appendScanReport(sources, output, config, { addedRangesByFile: rangesByFile })
        } catch (err) {
          debugLog("patch comment check failed:", err)
        }
        return
      }

      const pendingCall = takePendingCall(input.callID)
      if (!pendingCall) {
        debugLog("no pendingCall found for:", input.callID)
        return
      }

      debugLog("processing pendingCall:", pendingCall)

      try {
        await appendScanReport(sourcesForPendingCall(pendingCall), output, config)
      } catch (err) {
        debugLog("tool.execute.after failed:", err)
      }
    },
  }
}
