// Shared logging utility for the plugin

import { createRequire } from "node:module"
import * as os from "node:os"
import * as path from "node:path"

const logFile = path.join(os.tmpdir(), "matrixx.log")

// Resolve the real node:fs, bypassing any in-process mock.module("node:fs")
// registry that only stubs a subset of exports. Without this, appendFileSync
// can resolve to undefined and every log call silently drops its line.
const realFs = createRequire(import.meta.url)("node:fs") as typeof import("node:fs")

export function warn(message: string, data?: unknown): void {
  log(`[WARN] ${message}`, data);
}

export function log(message: string, data?: unknown): void {
  try {
    const timestamp = new Date().toISOString()
    const logEntry = `[${timestamp}] ${message} ${data ? JSON.stringify(data) : ""}\n`
    realFs.appendFileSync(logFile, logEntry)
  } catch {
  }
}

