import { existsSync, readFileSync, statSync } from "node:fs"
import type { z } from "zod"
import { log } from "../../shared/runtime/logger"

export type ReadErrorKind = "NotFound" | "Corrupt" | "Locked" | "TransientIO" | "StaleGeneration"

export class TypedReadError extends Error {
  kind: ReadErrorKind
  path: string
  byteSize: number
  constructor(kind: ReadErrorKind, path: string, byteSize: number, reason: string) {
    super(`[read] ${kind}: path=${path} bytes=${byteSize} reason=${reason}`)
    this.name = "TypedReadError"
    this.kind = kind
    this.path = path
    this.byteSize = byteSize
  }
}

function byteSizeOf(filePath: string, content?: string): number {
  if (content !== undefined) return Buffer.byteLength(content, "utf-8")
  try {
    return statSync(filePath).size
  } catch {
    return 0
  }
}

function classifyErrno(error: unknown): ReadErrorKind | null {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code
    if (code === "ENOENT") return "NotFound"
    if (code === "EACCES" || code === "EPERM" || code === "EBUSY") return "Locked"
  }
  return null
}

export type TypedReadResult<T> = { ok: true; value: T } | { ok: false; error: TypedReadError }

export function readJsonTyped<T>(filePath: string, schema: z.ZodType<T>): TypedReadResult<T> {
  if (!existsSync(filePath)) {
    return { ok: false, error: new TypedReadError("NotFound", filePath, 0, "missing file") }
  }
  let content: string
  try {
    content = readFileSync(filePath, "utf-8")
  } catch (error) {
    const kind = classifyErrno(error) ?? "TransientIO"
    const reason = error instanceof Error ? error.message : String(error)
    log(`[task-storage] readJsonTyped read failure`, { path: filePath, kind, reason })
    return { ok: false, error: new TypedReadError(kind, filePath, byteSizeOf(filePath), reason) }
  }
  const byteSize = byteSizeOf(filePath, content)
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    log(`[task-storage] readJsonTyped parse failure`, { path: filePath, byteSize, reason })
    return { ok: false, error: new TypedReadError("Corrupt", filePath, byteSize, reason) }
  }
  const result = schema.safeParse(parsed)
  if (!result.success) {
    log(`[task-storage] readJsonTyped schema mismatch`, { path: filePath, byteSize })
    return { ok: false, error: new TypedReadError("Corrupt", filePath, byteSize, "schema mismatch") }
  }
  return { ok: true, value: result.data }
}
