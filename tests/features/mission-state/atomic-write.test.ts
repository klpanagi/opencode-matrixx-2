import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

// Real fs handle: mock.module("node:fs") below replaces the module registry, so
// delegating through a plain `import ... from "node:fs"` binding would recurse.
const realFs = createRequire(import.meta.url)("node:fs") as typeof import("node:fs")
const realOpenSync = realFs.openSync as (path: string, flags: string, mode?: number) => number
const realWriteFileSync = realFs.writeFileSync as (path: string, data: string) => void
const realReadFileSync = realFs.readFileSync as (path: string, encoding: "utf-8") => string
const realRenameSync = realFs.renameSync as (from: string, to: string) => void
const realFsyncSync = realFs.fsyncSync as (fd: number) => void
const realExistsSync = realFs.existsSync as (path: string) => boolean
const realMkdtempSync = realFs.mkdtempSync as (prefix: string) => string
const realRmSync = realFs.rmSync as (path: string, options: { recursive: boolean; force: boolean }) => void

// ---------------------------------------------------------------------------
// Spies over node:fs — record what the primitive touched, then delegate.
// ---------------------------------------------------------------------------

const openCalls: Array<{ fd: number; path: string }> = []
const fsyncFds: number[] = []
const renameCalls: Array<{ from: string; to: string }> = []
let renameFailure: Error | null = null

const mockOpenSync = mock((path: string, flags: string, mode?: number) => {
  const fd = realOpenSync(path, flags, mode)
  openCalls.push({ fd, path })
  return fd
})
const mockFsyncSync = mock((fd: number) => {
  fsyncFds.push(fd)
  realFsyncSync(fd)
})
const mockRenameSync = mock((from: string, to: string) => {
  // Record before delegating (or throwing) so the tmp path is observable either way.
  renameCalls.push({ from, to })
  if (renameFailure) throw renameFailure
  realRenameSync(from, to)
})

mock.module("node:fs", () => ({
  ...realFs,
  openSync: mockOpenSync,
  fsyncSync: mockFsyncSync,
  renameSync: mockRenameSync,
}))

import { atomicWrite, atomicWriteDetailed } from "../../../src/features/mission-state/atomic-write"

let testDir = ""

beforeEach(() => {
  testDir = realMkdtempSync(join(tmpdir(), "atomic-write-"))
  openCalls.length = 0
  fsyncFds.length = 0
  renameCalls.length = 0
  renameFailure = null
})

afterEach(() => {
  realRmSync(testDir, { recursive: true, force: true })
})

describe("atomicWrite", () => {
  test("unique tmp path per write to the same target", () => {
    //#given one target file that is written twice
    const filePath = join(testDir, "plan.md")

    //#when both writes go through the primitive
    expect(atomicWrite(filePath, "first")).toBe(true)
    expect(atomicWrite(filePath, "second")).toBe(true)

    //#then each rename consumed a distinct uuid-suffixed tmp path
    const sources = renameCalls.map((call) => call.from)
    expect(sources).toHaveLength(2)
    expect(new Set(sources).size).toBe(2)
    const tmpPrefix = `${filePath}.tmp.${process.pid}.`
    for (const source of sources) {
      expect(source.startsWith(tmpPrefix)).toBe(true)
    }
  })

  test("fsyncs the tmp file descriptor and the parent directory descriptor", () => {
    //#given a target inside a fresh temporary directory
    const filePath = join(testDir, "durable.md")

    //#when
    expect(atomicWrite(filePath, "content")).toBe(true)

    //#then the descriptor opened on the tmp file was fsynced
    const fileOpen = openCalls.find((call) => call.path.startsWith(`${filePath}.tmp.`))
    expect(fileOpen).toBeDefined()
    expect(fsyncFds).toContain(fileOpen?.fd)

    //#and the descriptor opened on the parent directory was fsynced too
    const dirOpen = openCalls.find((call) => call.path === dirname(filePath))
    expect(dirOpen).toBeDefined()
    expect(fsyncFds).toContain(dirOpen?.fd)
  })

  test("reports a rename failure with a reason and removes the tmp file", () => {
    //#given renameSync will fail with ENOENT for these writes
    const filePath = join(testDir, "plan.md")
    renameFailure = Object.assign(new Error("ENOENT: no such file or directory, rename"), { code: "ENOENT" })

    //#when the detailed primitive reports the failure
    const detailed = atomicWriteDetailed(filePath, "payload")

    //#then the reason is carried instead of swallowed
    expect(detailed.ok).toBe(false)
    if (!detailed.ok) {
      expect(detailed.reason).toMatch(/ENOENT/)
    }

    //#and the boolean wrapper still collapses to false
    expect(atomicWrite(filePath, "payload")).toBe(false)

    //#and neither attempt left a tmp file behind
    const tmpPaths = renameCalls.map((call) => call.from)
    expect(tmpPaths).toHaveLength(2)
    for (const tmpPath of tmpPaths) {
      expect(realExistsSync(tmpPath)).toBe(false)
    }
    expect(realExistsSync(filePath)).toBe(false)
  })

  test("keeps the boolean contract and replaces the target content", () => {
    //#given an existing target with stale content
    const filePath = join(testDir, "contract.md")
    realWriteFileSync(filePath, "old")

    //#when
    expect(atomicWrite(filePath, "new")).toBe(true)

    //#then
    expect(realReadFileSync(filePath, "utf-8")).toBe("new")
  })
})
