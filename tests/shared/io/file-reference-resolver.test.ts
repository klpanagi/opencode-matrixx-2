/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  resolveFileReferencesInText,
  type FileReferenceFs,
} from "../../../src/shared/io/file-reference-resolver"

interface FakeEntry {
  content?: string
  dir?: boolean
  symlink?: boolean
  realpathTarget?: string
}

interface FakeFs {
  fs: FileReferenceFs
  reads: { count: number }
}

function createFakeFs(files: Record<string, FakeEntry>): FakeFs {
  const reads = { count: 0 }
  const fs: FileReferenceFs = {
    async lstat(path) {
      const entry = files[path]
      if (!entry) {
        throw new Error("ENOENT")
      }
      return {
        isSymbolicLink: () => entry.symlink === true,
        isDirectory: () => entry.dir === true,
        size: entry.size ?? entry.content?.length ?? 0,
      }
    },
    async realpath(path) {
      const entry = files[path]
      if (!entry) {
        throw new Error("ENOENT")
      }
      return entry.realpathTarget ?? path
    },
    async readFile(path) {
      const entry = files[path]
      if (!entry) {
        throw new Error("ENOENT")
      }
      reads.count++
      const target = entry.symlink ? files[entry.realpathTarget ?? ""] : entry
      if (!target || target.content === undefined) {
        throw new Error("ENOENT")
      }
      return target.content
    },
  }
  return { fs, reads }
}

describe("resolveFileReferencesInText", () => {
  //#given an in-root file referenced via @notes.txt
  //#when resolving file references with a fake fs scoped to /work
  //#then the reference is replaced by the file content
  test("resolves an in-root file reference to its content", async () => {
    const { fs, reads } = createFakeFs({ "/work/notes.txt": { content: "hello world" } })

    const result = await resolveFileReferencesInText("see @notes.txt now", { cwd: "/work", fs })

    expect(result).toBe("see hello world now")
    expect(reads.count).toBe(1)
  })

  //#given an absolute path outside the workspace that exists in the fake fs
  //#when resolving "@/etc/passwd"
  //#then it is blocked and no read is attempted
  test("blocks an absolute path outside the workspace without reading", async () => {
    const { fs, reads } = createFakeFs({ "/etc/passwd": { content: "root:x:0:0" } })

    const result = await resolveFileReferencesInText("leak @/etc/passwd", { cwd: "/work", fs })

    expect(result).toBe("leak [blocked: file reference outside workspace]")
    expect(reads.count).toBe(0)
  })

  //#given a traversal path escaping the workspace
  //#when resolving @../../etc/passwd
  //#then it is blocked and no read is attempted
  test("blocks a traversal path escaping the workspace without reading", async () => {
    const { fs, reads } = createFakeFs({ "/etc/passwd": { content: "root:x:0:0" } })

    const result = await resolveFileReferencesInText("leak @../../etc/passwd", { cwd: "/work", fs })

    expect(result).toBe("leak [blocked: file reference outside workspace]")
    expect(reads.count).toBe(0)
  })

  //#given an in-root symlink whose realpath points outside the workspace
  //#when resolving @link.txt
  //#then it is blocked and no read is attempted
  test("blocks a symlink whose realpath escapes the workspace", async () => {
    const { fs, reads } = createFakeFs({
      "/work/link.txt": { symlink: true, realpathTarget: "/etc/secret" },
      "/etc/secret": { content: "top secret" },
    })

    const result = await resolveFileReferencesInText("peek @link.txt", { cwd: "/work", fs })

    expect(result).toBe("peek [blocked: file reference outside workspace]")
    expect(reads.count).toBe(0)
  })

  //#given an in-root symlink whose realpath stays inside the workspace
  //#when resolving @alias.txt
  //#then the symlink target content is read
  test("allows a symlink whose realpath stays inside the workspace", async () => {
    const { fs, reads } = createFakeFs({
      "/work/alias.txt": { symlink: true, realpathTarget: "/work/notes.txt" },
      "/work/notes.txt": { content: "inside" },
    })

    const result = await resolveFileReferencesInText("peek @alias.txt", { cwd: "/work", fs })

    expect(result).toBe("peek inside")
    expect(reads.count).toBe(1)
  })

  //#given a workspace reached through a symlinked cwd, and a leaf symlink whose
  //#realpath stays inside the (canonical) workspace
  //#when resolving @alias.txt
  //#then the reference still resolves to the target content instead of being over-blocked
  test("allows an in-tree symlink in a symlinked-cwd workspace", async () => {
    const { fs, reads } = createFakeFs({
      "/ws-link": { dir: true, symlink: true, realpathTarget: "/real-ws" },
      "/ws-link/alias.txt": { symlink: true, realpathTarget: "/real-ws/notes.txt" },
      "/real-ws/notes.txt": { content: "inside" },
    })

    const result = await resolveFileReferencesInText("peek @alias.txt", { cwd: "/ws-link", fs })

    expect(result).toBe("peek inside")
    expect(reads.count).toBe(1)
  })


  //#given a 300 KiB file and maxBytes 262144
  //#when resolving @big.txt
  //#then it is reported as too large and no read is attempted
  test("blocks files larger than maxBytes without reading", async () => {
    const { fs, reads } = createFakeFs({ "/work/big.txt": { content: "a".repeat(300 * 1024) } })

    const result = await resolveFileReferencesInText("data @big.txt", {
      cwd: "/work",
      maxBytes: 262144,
      fs,
    })

    expect(result).toBe("data [file too large: 307200 bytes]")
    expect(reads.count).toBe(0)
  })

  //#given a file one byte over the hard default cap and no maxBytes option
  //#when resolving @big.txt
  //#then the hard default cap applies and the file is not read
  test("applies the hard default maxBytes when no option is given", async () => {
    const { fs, reads } = createFakeFs({ "/work/big.txt": { content: "a".repeat(262145) } })

    const result = await resolveFileReferencesInText("data @big.txt", { cwd: "/work", fs })

    expect(result).toBe("data [file too large: 262145 bytes]")
    expect(reads.count).toBe(0)
  })

  //#given two 1000-byte files and a 1500-byte total cap
  //#when resolving both references
  //#then the first is read and the second stays literal with a total-limit marker
  test("leaves remaining references literal with a marker once maxTotalBytes is exceeded", async () => {
    const { fs, reads } = createFakeFs({
      "/work/first.txt": { content: "x".repeat(1000) },
      "/work/second.txt": { content: "y".repeat(1000) },
    })

    const result = await resolveFileReferencesInText("a @first.txt b @second.txt", {
      cwd: "/work",
      maxTotalBytes: 1500,
      fs,
    })

    expect(result).toContain(`a ${"x".repeat(1000)}`)
    expect(result).toContain("b @second.txt")
    expect(result).toContain(
      "[file reference total size limit exceeded: remaining references left unresolved]",
    )
    expect(reads.count).toBe(1)
  })

  //#given allowFileRefs is false and the file exists
  //#when resolving @notes.txt
  //#then every reference is blocked and no read is attempted
  test("blocks every reference when allowFileRefs is false and reads nothing", async () => {
    const { fs, reads } = createFakeFs({ "/work/notes.txt": { content: "hello" } })

    const result = await resolveFileReferencesInText("see @notes.txt", {
      cwd: "/work",
      allowFileRefs: false,
      fs,
    })

    expect(result).toBe("see [blocked: file reference disabled for project-scope command]")
    expect(reads.count).toBe(0)
  })

  //#given a missing in-root file
  //#when resolving @missing.txt
  //#then the file-not-found marker names the resolved path
  test("keeps the file-not-found marker for a missing in-root file", async () => {
    const { fs } = createFakeFs({})

    const result = await resolveFileReferencesInText("see @missing.txt", { cwd: "/work", fs })

    expect(result).toBe("see [file not found: /work/missing.txt]")
  })

  //#given a directory referenced via @subdir
  //#when resolving the reference
  //#then the cannot-read-directory marker is used and no read is attempted
  test("keeps the cannot-read-directory marker for directories", async () => {
    const { fs, reads } = createFakeFs({ "/work/subdir": { dir: true } })

    const result = await resolveFileReferencesInText("see @subdir", { cwd: "/work", fs })

    expect(result).toBe("see [cannot read directory: /work/subdir]")
    expect(reads.count).toBe(0)
  })

  //#given a regular file whose parent directory is a symlink pointing outside the workspace
  //#when resolving @etc/hostname
  //#then the reference is blocked and the outside file is never read
  test("blocks a path escaping through a symlinked parent directory", async () => {
    const { fs, reads } = createFakeFs({
      "/work/etc/hostname": { content: "root:x:0:0", realpathTarget: "/outside/hostname" },
      "/outside/hostname": { content: "root:x:0:0" },
    })

    const result = await resolveFileReferencesInText("leak @etc/hostname", { cwd: "/work", fs })

    expect(result).toBe("leak [blocked: file reference outside workspace]")
    expect(reads.count).toBe(0)
  })

  //#given a regular in-root file with no symlinks involved
  //#when resolving @notes.txt
  //#then the content is still returned
  test("still returns the content of an in-root regular file", async () => {
    const { fs } = createFakeFs({ "/work/notes.txt": { content: "plain content" } })

    const result = await resolveFileReferencesInText("see @notes.txt", { cwd: "/work", fs })

    expect(result).toBe("see plain content")
  })
})

