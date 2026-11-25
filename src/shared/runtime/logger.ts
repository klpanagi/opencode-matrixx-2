// Shared logging utility for the plugin

import { createRequire } from "node:module"
import * as os from "node:os"
import * as path from "node:path"

import { redactSecrets } from "../text/redact-secrets"

// Resolve the real node:fs, bypassing any in-process mock.module("node:fs")
// registry that only stubs a subset of exports. Without this, appendFileSync
// can resolve to undefined and every log call silently drops its line.
const realFs = createRequire(import.meta.url)("node:fs") as typeof import("node:fs")

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const DEFAULT_MAX_FILES = 3

export interface LoggerOptions {
  redact?: boolean
  maxBytes?: number
  maxFiles?: number
}

interface LoggerConfig {
  redact: boolean
  maxBytes: number
  maxFiles: number
}

let loggerConfig: LoggerConfig = {
  redact: true,
  maxBytes: DEFAULT_MAX_BYTES,
  maxFiles: DEFAULT_MAX_FILES,
}

let permissionsEnsured = false

export function configureLogger(options: LoggerOptions = {}): void {
  loggerConfig = {
    redact: options.redact !== false,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
    maxFiles: options.maxFiles ?? DEFAULT_MAX_FILES,
  }
  permissionsEnsured = false
}

function resolveLogFilePath(): string {
  return process.env.MATRIXX_LOG_FILE ?? path.join(os.tmpdir(), "matrixx.log")
}

function ensureFilePermissions(logFile: string): void {
  if (permissionsEnsured) return
  try {
    if (realFs.existsSync(logFile)) {
      realFs.chmodSync(logFile, 0o600)
    }
  } catch {
  }
  permissionsEnsured = true
}

function rotateLogFile(logFile: string): void {
  const { maxFiles } = loggerConfig
  try {
    if (maxFiles <= 1) {
      realFs.rmSync(logFile, { force: true })
      return
    }
    // Drop the oldest rotated file, shift `.1`..`.N-1` upward, then move the
    // current file to `.1`. Keeps at most max_files files (base + .N-1 rotated).
    realFs.rmSync(`${logFile}.${maxFiles - 1}`, { force: true })
    for (let i = maxFiles - 2; i >= 1; i--) {
      const from = `${logFile}.${i}`
      if (realFs.existsSync(from)) {
        realFs.renameSync(from, `${logFile}.${i + 1}`)
      }
    }
    realFs.renameSync(logFile, `${logFile}.1`)
  } catch {
  }
}

export function warn(message: string, data?: unknown): void {
  log(`[WARN] ${message}`, data);
}

export function log(message: string, data?: unknown): void {
  try {
    const timestamp = new Date().toISOString()
    const composed = `[${timestamp}] ${message} ${data ? JSON.stringify(data) : ""}`
    const logEntry = `${loggerConfig.redact ? redactSecrets(composed) : composed}\n`
    const logFile = resolveLogFilePath()
    ensureFilePermissions(logFile)
    const lineBytes = Buffer.byteLength(logEntry, "utf8")
    let fileSize = 0
    try {
      fileSize = realFs.statSync(logFile).size
    } catch {
    }
    if (fileSize + lineBytes > loggerConfig.maxBytes) {
      rotateLogFile(logFile)
    }
    realFs.appendFileSync(logFile, logEntry, { mode: 0o600 })
  } catch {
  }
}

