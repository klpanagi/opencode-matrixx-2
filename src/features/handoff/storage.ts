import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs"
import { join } from "node:path"
import { log } from "../../shared/runtime/logger"
import { atomicWriteDetailed } from "../mission-state/atomic-write"
import { HANDOFF_CONSUMED_FILE_PATH, HANDOFF_FILE_PATH } from "./constants"

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function getHandoffFilePath(directory: string): string {
  return join(directory, HANDOFF_FILE_PATH)
}

export function getHandoffConsumedFilePath(directory: string): string {
  return join(directory, HANDOFF_CONSUMED_FILE_PATH)
}

export function handoffFileExists(directory: string): boolean {
  try {
    return existsSync(getHandoffFilePath(directory))
  } catch (error) {
    log("[handoff] existence check failed", {
      path: getHandoffFilePath(directory),
      reason: reasonOf(error),
      level: "warn",
    })
    return false
  }
}

export function readHandoffFile(directory: string): string | null {
  const filePath = getHandoffFilePath(directory)
  try {
    if (!existsSync(filePath)) return null
    return readFileSync(filePath, "utf-8")
  } catch (error) {
    log("[handoff] read failed", { path: filePath, reason: reasonOf(error), level: "warn" })
    return null
  }
}

export function archiveHandoffFile(directory: string): boolean {
  try {
    renameSync(
      getHandoffFilePath(directory),
      getHandoffConsumedFilePath(directory),
    )
    return true
  } catch (error) {
    log("[handoff] archive failed", {
      path: getHandoffFilePath(directory),
      target: getHandoffConsumedFilePath(directory),
      reason: reasonOf(error),
      level: "warn",
    })
    return false
  }
}

export function writeHandoffFile(directory: string, content: string): boolean {
  if (!ensureHandoffDir(directory)) return false

  const filePath = getHandoffFilePath(directory)
  const result = atomicWriteDetailed(filePath, content)
  if (!result.ok) {
    log("[handoff] write failed", { path: filePath, reason: result.reason, level: "error" })
    return false
  }
  return true
}

export function ensureHandoffDir(directory: string): boolean {
  try {
    mkdirSync(join(directory, ".matrixx"), { recursive: true })
    return true
  } catch (error) {
    log("[handoff] directory creation failed", {
      path: join(directory, ".matrixx"),
      reason: reasonOf(error),
      level: "error",
    })
    return false
  }
}
