import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { configureLogger, log } from "../../../src/shared/runtime/logger"

describe("logger", () => {
  let dir: string
  let logFile: string

  beforeEach(() => {
    //#given an isolated MATRIXX_LOG_FILE inside a fresh tmpdir
    dir = mkdtempSync(join(tmpdir(), "matrixx-logger-test-"))
    logFile = join(dir, "matrixx.log")
    process.env.MATRIXX_LOG_FILE = logFile
  })

  afterEach(() => {
    delete process.env.MATRIXX_LOG_FILE
    rmSync(dir, { recursive: true, force: true })
    configureLogger()
  })

  it("creates the log file with mode 0o600", () => {
    //#given default logger configuration
    configureLogger({ maxBytes: 1024 * 1024, maxFiles: 3 })

    //#when a line is logged into a not-yet-existing file
    log("x")

    //#then the file exists and is owner-read/write only
    expect(existsSync(logFile)).toBe(true)
    expect(statSync(logFile).mode & 0o777).toBe(0o600)
  })

  it("re-chmods a pre-existing 0644 file to 0600 on first use", () => {
    //#given a log file pre-created with world-readable permissions
    configureLogger({ maxBytes: 1024 * 1024, maxFiles: 3 })
    writeFileSync(logFile, "stale\n", { mode: 0o644 })
    chmodSync(logFile, 0o644)
    expect(statSync(logFile).mode & 0o777).toBe(0o644)

    //#when the logger writes to it
    log("x")

    //#then the permissions are tightened to 0o600
    expect(statSync(logFile).mode & 0o777).toBe(0o600)
  })

  it("rotates an oversized entry to .1 and keeps at most max_files files", () => {
    //#given a tiny maxBytes and max_files of 2
    configureLogger({ maxBytes: 100, maxFiles: 2 })

    //#when entries larger than maxBytes are logged repeatedly
    log("a".repeat(120))
    log("b")
    log("c".repeat(120))

    //#then rotation shifted files up to .1 and never exceeded max_files
    const files = readdirSync(dir).filter((name) => name.startsWith("matrixx.log"))
    expect(files).toContain("matrixx.log")
    expect(files).toContain("matrixx.log.1")
    expect(files.length).toBe(2)

    //#and the oldest oversized entry was dropped during the second rotation
    const rotated = readFileSync(join(dir, "matrixx.log.1"), "utf8")
    expect(rotated).toContain("b")
    expect(rotated).not.toContain("aaa")

    //#and the newest entry landed in the fresh base file
    const current = readFileSync(logFile, "utf8")
    expect(current).toContain("ccc")
  })

  it("redacts secrets in the composed message by default", () => {
    //#given default redaction (redact !== false)
    configureLogger({ maxBytes: 1024 * 1024, maxFiles: 3 })

    //#when a log call carries an Authorization header in its data
    log("cmd", { command: "curl -H 'Authorization: Bearer abc'" })

    //#then the written line contains the redaction marker and not the secret
    const contents = readFileSync(logFile, "utf8")
    expect(contents).toContain("[REDACTED]")
    expect(contents).not.toContain("abc")
  })

  it("keeps the raw value when redaction is explicitly disabled", () => {
    //#given redact: false
    configureLogger({ redact: false, maxBytes: 1024 * 1024, maxFiles: 3 })

    //#when the same Authorization data is logged
    log("cmd", { command: "curl -H 'Authorization: Bearer abc'" })

    //#then the raw secret stays in the file
    expect(readFileSync(logFile, "utf8")).toContain("abc")
  })
})
