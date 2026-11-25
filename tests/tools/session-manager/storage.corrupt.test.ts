/// <reference types="bun-types" />
import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const TEST_DIR = join(tmpdir(), `matrixx-t14-corrupt-${randomUUID()}`)
const TEST_SESSION_STORAGE = join(TEST_DIR, "session")
const TEST_MESSAGE_STORAGE = join(TEST_DIR, "message")
const TEST_PART_STORAGE = join(TEST_DIR, "part")
const TEST_RECOVERY_PART_STORAGE = join(TEST_DIR, "recovery-part")
const TEST_RECOVERY_MESSAGE_DIR = join(TEST_DIR, "recovery-message")

mock.module("../../../src/tools/session-manager/constants", () => ({
  OPENCODE_STORAGE: TEST_DIR,
  MESSAGE_STORAGE: TEST_MESSAGE_STORAGE,
  PART_STORAGE: TEST_PART_STORAGE,
  SESSION_STORAGE: TEST_SESSION_STORAGE,
  TODO_DIR: join(TEST_DIR, "todos"),
  TRANSCRIPT_DIR: join(TEST_DIR, "transcripts"),
  SESSION_LIST_DESCRIPTION: "test",
  SESSION_READ_DESCRIPTION: "test",
  SESSION_SEARCH_DESCRIPTION: "test",
  SESSION_INFO_DESCRIPTION: "test",
  SESSION_DELETE_DESCRIPTION: "test",
  TOOL_NAME_PREFIX: "session_",
}))

mock.module("../../../src/hooks/session-recovery/constants", () => ({
  MESSAGE_STORAGE: TEST_MESSAGE_STORAGE,
  OPENCODE_STORAGE: TEST_DIR,
  PART_STORAGE: TEST_RECOVERY_PART_STORAGE,
  THINKING_TYPES: new Set(["thinking", "redacted_thinking", "reasoning"]),
  META_TYPES: new Set(["step-start", "step-finish"]),
}))

mock.module("../../../src/shared/config/opencode-storage-detection", () => ({
  isSqliteBackend: () => false,
  resetSqliteBackendCache: () => {},
}))

mock.module("../../../src/shared/opencode/opencode-message-dir", () => ({
  getMessageDir: (sessionID: string) =>
    sessionID === "ses_t14_messages" ? TEST_RECOVERY_MESSAGE_DIR : null,
}))

type LogCall = { message: string; data?: unknown }

function flatten(calls: LogCall[]): string {
  return calls.map((c) => `${c.message} ${JSON.stringify(c.data ?? null)}`).join("\n")
}

async function captureLogs<T>(run: () => T | Promise<T>): Promise<{ result: T; calls: LogCall[]; logged: string }> {
  const logger = await import("../../../src/shared/runtime/logger")
  const calls: LogCall[] = []
  const spy = spyOn(logger, "log").mockImplementation((message: string, data?: unknown) => {
    calls.push({ message, data })
  })
  try {
    const result = await run()
    return { result, calls, logged: flatten(calls) }
  } finally {
    spy.mockRestore()
  }
}

describe("T14 loud read failures", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_SESSION_STORAGE, { recursive: true })
    mkdirSync(TEST_PART_STORAGE, { recursive: true })
    mkdirSync(TEST_RECOVERY_PART_STORAGE, { recursive: true })
    mkdirSync(TEST_RECOVERY_MESSAGE_DIR, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  })

  afterAll(() => {
    mock.restore()
  })

  test("a corrupt session file is skipped with a warning naming the file, valid siblings still returned", async () => {
    //#given a session directory with one valid file and one crash-truncated file
    const projectDir = join(TEST_SESSION_STORAGE, "project-a")
    mkdirSync(projectDir, { recursive: true })
    const validPath = join(projectDir, "ses_valid.json")
    writeFileSync(
      validPath,
      JSON.stringify({
        id: "ses_valid",
        projectID: "project-a",
        directory: "/work/valid",
        time: { created: 1, updated: 2 },
      }),
      "utf-8",
    )
    const corruptPath = join(projectDir, "ses_broken.json")
    writeFileSync(corruptPath, '{"id":"ses_broken","time":{"created":1', "utf-8")

    const { getMainSessions } = await import("../../../src/tools/session-manager/storage")

    //#when
    const { result, logged } = await captureLogs(() => getMainSessions({}))

    //#then the valid session survives and the unreadable one is named in a warning
    expect(result.map((s) => s.id)).toEqual(["ses_valid"])
    expect(logged).toContain(corruptPath)
    expect(logged).toMatch(/warn/i)
    expect(logged).toMatch(/JSON|parse|Unexpected/i)
  })

  test("an unreadable session directory is logged as an error with the reason instead of an indistinguishable empty list", async () => {
    //#given the session storage path is a file, so the directory read must fail
    if (existsSync(TEST_SESSION_STORAGE)) rmSync(TEST_SESSION_STORAGE, { recursive: true, force: true })
    writeFileSync(TEST_SESSION_STORAGE, "not a directory", "utf-8")

    const { getMainSessions } = await import("../../../src/tools/session-manager/storage")

    //#when
    const { result, logged } = await captureLogs(() => getMainSessions({}))

    //#then the empty result is recorded with the path and the OS reason at error level
    expect(result).toEqual([])
    expect(logged).toContain(TEST_SESSION_STORAGE)
    expect(logged).toMatch(/error/i)
    expect(logged).toMatch(/ENOTDIR|not a directory/i)
  })

  test("readMessages logs a crash-truncated message file instead of dropping it silently", async () => {
    //#given a truncated message file in the recovery message directory
    const corruptPath = join(TEST_RECOVERY_MESSAGE_DIR, "msg_broken.json")
    writeFileSync(corruptPath, '{"id":"msg_broken","role":"user"', "utf-8")

    const { readMessages } = await import("../../../src/hooks/session-recovery/storage/messages-reader")

    //#when
    const { result, logged } = await captureLogs(() => readMessages("ses_t14_messages"))

    //#then the read still degrades to an empty list, but the path and reason are logged
    expect(result).toEqual([])
    expect(logged).toContain(corruptPath)
    expect(logged).toMatch(/warn/i)
    expect(logged).toMatch(/JSON|parse|Unexpected/i)
  })

  test("readParts logs a crash-truncated part file instead of dropping it silently", async () => {
    //#given a truncated part file for one message
    const partDir = join(TEST_RECOVERY_PART_STORAGE, "msg_parts")
    mkdirSync(partDir, { recursive: true })
    const corruptPath = join(partDir, "prt_broken.json")
    writeFileSync(corruptPath, '{"id":"prt_broken","type":"text"', "utf-8")

    const { readParts } = await import("../../../src/hooks/session-recovery/storage/parts-reader")

    //#when
    const { result, logged } = await captureLogs(() => readParts("msg_parts"))

    //#then
    expect(result).toEqual([])
    expect(logged).toContain(corruptPath)
    expect(logged).toMatch(/warn/i)
    expect(logged).toMatch(/JSON|parse|Unexpected/i)
  })

  test("stripThinkingParts logs a crash-truncated part file instead of dropping it silently", async () => {
    //#given a truncated part file for one message
    const partDir = join(TEST_RECOVERY_PART_STORAGE, "msg_thinking")
    mkdirSync(partDir, { recursive: true })
    const corruptPath = join(partDir, "prt_broken.json")
    writeFileSync(corruptPath, '{"id":"prt_broken","type":"thinking"', "utf-8")

    const { stripThinkingParts } = await import("../../../src/hooks/session-recovery/storage/thinking-strip")

    //#when
    const { result, logged } = await captureLogs(() => stripThinkingParts("msg_thinking"))

    //#then nothing is removed, but the unreadable part is named with its reason
    expect(result).toBe(false)
    expect(logged).toContain(corruptPath)
    expect(logged).toMatch(/warn/i)
    expect(logged).toMatch(/JSON|parse|Unexpected/i)
  })
})
