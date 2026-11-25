/// <reference types="bun-types" />
import { chmodSync, closeSync, mkdtempSync, openSync, readSync, rmSync, statSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "bun:test"
import { detectCompletionInTranscript } from "../../../src/hooks/matrix-loop/completion-promise-detector"

const LOG_FILE = join(tmpdir(), "matrixx.log")
const TEST_DIR = mkdtempSync(join(tmpdir(), "t15-detector-"))

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
})

function uniqueTranscript(name: string): string {
  return join(TEST_DIR, `${name}-${randomUUID()}.jsonl`)
}

function logSize(): number {
  try {
    return statSync(LOG_FILE).size
  } catch {
    return 0
  }
}

function readLogSince(offset: number): string {
  const size = logSize()
  if (size <= offset) return ""
  const fd = openSync(LOG_FILE, "r")
  try {
    const buffer = Buffer.alloc(size - offset)
    readSync(fd, buffer, 0, buffer.length, offset)
    return buffer.toString("utf-8")
  } finally {
    closeSync(fd)
  }
}

function logLinesFor(offset: number, path: string): string[] {
  return readLogSince(offset)
    .split("\n")
    .filter((line) => line.includes(path))
}

describe("detectCompletionInTranscript", () => {
  it("detects the completion promise in a transcript entry", () => {
    //#given a transcript entry carrying the completion promise
    const transcriptPath = uniqueTranscript("promise")
    writeFileSync(
      transcriptPath,
      `${JSON.stringify({ type: "tool_result", output: "Task done <promise>DONE</promise>" })}\n`,
      "utf-8",
    )

    //#when the detector scans the transcript
    const detected = detectCompletionInTranscript(transcriptPath, "DONE")

    //#then the promise is found
    expect(detected).toBe(true)
  })

  it("ignores user transcript entries", () => {
    //#given a user entry quoting the promise template
    const transcriptPath = uniqueTranscript("user")
    writeFileSync(
      transcriptPath,
      `${JSON.stringify({ type: "user", content: "<promise>DONE</promise>" })}\n`,
      "utf-8",
    )

    //#when the detector scans the transcript
    const detected = detectCompletionInTranscript(transcriptPath, "DONE")

    //#then user text never counts as completion
    expect(detected).toBe(false)
  })

  it("logs a missing transcript below warning level and returns false", () => {
    //#given a transcript path that does not exist yet
    const transcriptPath = uniqueTranscript("missing")
    const offset = logSize()

    //#when the detector scans it
    const detected = detectCompletionInTranscript(transcriptPath, "DONE")

    //#then it degrades quietly, with a non-warning record naming the path
    expect(detected).toBe(false)
    const lines = logLinesFor(offset, transcriptPath)
    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain("[WARN]")
    expect(lines[0]).toContain("not found")
  })

  it("warns at warning level when the transcript is unreadable", () => {
    //#given a transcript file the process is not allowed to read
    const transcriptPath = uniqueTranscript("denied")
    writeFileSync(transcriptPath, "{}\n", "utf-8")
    chmodSync(transcriptPath, 0o000)
    const offset = logSize()
    try {
      //#when the detector scans it
      const detected = detectCompletionInTranscript(transcriptPath, "DONE")

      //#then it returns false and the unreadable file is surfaced as a warning
      expect(detected).toBe(false)
      const lines = logLinesFor(offset, transcriptPath)
      expect(lines.length).toBeGreaterThanOrEqual(1)
      const warning = lines.find((line) => line.includes("[WARN]"))
      expect(warning).toBeDefined()
      expect(warning).toContain("EACCES")
    } finally {
      chmodSync(transcriptPath, 0o600)
    }
  })

  it("counts unparseable transcript lines and warns once per file", () => {
    //#given a transcript with three valid lines and one corrupt line
    const transcriptPath = uniqueTranscript("corrupt")
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({ type: "assistant", content: "one" }),
        JSON.stringify({ type: "assistant", content: "two" }),
        "{this is not json",
        JSON.stringify({ type: "assistant", content: "three" }),
      ].join("\n") + "\n",
      "utf-8",
    )
    const offset = logSize()

    //#when the detector scans it
    const detected = detectCompletionInTranscript(transcriptPath, "DONE")

    //#then it returns false and reports exactly one skipped line in a single summary
    expect(detected).toBe(false)
    const summaries = logLinesFor(offset, transcriptPath).filter((line) => line.includes("unparseable"))
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toContain('"unparseableLines":1')
  })

  it("stays quiet for a clean transcript without the promise", () => {
    //#given a transcript whose lines all parse and none carry the promise
    const transcriptPath = uniqueTranscript("clean")
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({ type: "assistant", content: "still working" }),
        JSON.stringify({ type: "tool_result", output: "plain output" }),
      ].join("\n") + "\n",
      "utf-8",
    )
    const offset = logSize()

    //#when the detector scans it
    const detected = detectCompletionInTranscript(transcriptPath, "DONE")

    //#then nothing is logged as a warning or a parse drop
    expect(detected).toBe(false)
    const lines = logLinesFor(offset, transcriptPath)
    expect(lines.filter((line) => line.includes("[WARN]"))).toHaveLength(0)
    expect(lines.filter((line) => line.includes("unparseable"))).toHaveLength(0)
  })
})
