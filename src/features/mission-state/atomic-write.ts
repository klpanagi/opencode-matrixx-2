import { randomUUID } from "node:crypto"
import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeSync } from "node:fs"
import { dirname } from "node:path"

/**
 * The tmp+rename+fsync primitive every plan write goes through.
 *
 * Split out of `plan-storage.ts` to keep that module under the 200-LOC ceiling.
 * The target is never written in place — it is only ever REPLACED by rename — so
 * a crash mid-write leaves the previous bytes intact rather than a truncated
 * file. The tmp file is fsynced before the rename and the parent directory is
 * fsynced after it, so a completed write is durable and does not linger in the
 * page cache only.
 */
export type AtomicWriteResult = { ok: true } | { ok: false; reason: string }

const DIRECTORY_FSYNC_TOLERATED_CODES = ["EINVAL", "ENOTSUP", "EISDIR"]

function fsyncParentDirectory(filePath: string): void {
  if (process.platform === "win32") return
  const fd = openSync(dirname(filePath), "r")
  try {
    fsyncSync(fd)
  } catch (error) {
    const code = (error as { code?: unknown }).code
    if (typeof code !== "string" || !DIRECTORY_FSYNC_TOLERATED_CODES.includes(code)) {
      throw error
    }
  } finally {
    closeSync(fd)
  }
}

export function atomicWriteDetailed(filePath: string, content: string): AtomicWriteResult {
  const pid = process.pid
  const tmpPath = `${filePath}.tmp.${pid}.${randomUUID()}`
  let fd: number | undefined
  try {
    fd = openSync(tmpPath, "w")
    writeSync(fd, content)
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(tmpPath, filePath)
    fsyncParentDirectory(filePath)
    return { ok: true }
  } catch (error) {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        // descriptor teardown must not hide the write failure being reported
      }
    }
    try {
      unlinkSync(tmpPath)
    } catch {
      // tmp may already be gone (rename moved it) — cleanup is best-effort
    }
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

export function atomicWrite(filePath: string, content: string): boolean {
  return atomicWriteDetailed(filePath, content).ok
}
