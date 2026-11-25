/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import type { MatrixxContext } from "../../../src/plugin/tool/context"
import { createDocumentReaderGuardHook } from "../../../src/hooks/document-reader-guard/hook"
import { evaluateDocumentReaderUri, isBlockedUriHost } from "../../../src/hooks/document-reader-guard/uri-guard"

const WORKSPACE = "/workspace-root"

function makeHookAt(workspaceRoot: string) {
  return createDocumentReaderGuardHook({
    directory: workspaceRoot,
    worktree: workspaceRoot,
  } as unknown as MatrixxContext)
}

function makeHook() {
  return makeHookAt(WORKSPACE)
}

async function run(tool: string, args: Record<string, unknown>) {
  const hook = makeHook()
  const input = { tool, sessionID: "ses_1", callID: "call_1" }
  const output = { args }
  return hook["tool.execute.before"]?.(input, output)
}

interface TempWorkspace {
  root: string
  workspace: string
  outsideDir: string
}

function createTempWorkspace(): TempWorkspace {
  const root = mkdtempSync(join(tmpdir(), "matrixx-uri-guard-"))
  const workspace = join(root, "ws")
  const outsideDir = join(root, "outside")
  mkdirSync(workspace)
  mkdirSync(outsideDir)
  return { root, workspace, outsideDir }
}

let tempWorkspace: TempWorkspace

beforeEach(() => {
  tempWorkspace = createTempWorkspace()
})

afterEach(() => {
  rmSync(tempWorkspace.root, { recursive: true, force: true })
})

describe("document-reader-guard: document_reader URI guard", () => {
  test("blocks cloud metadata endpoint over http", async () => {
    //#given a document_reader call targeting the link-local metadata service
    //#when the guard runs
    const result = run("document_reader_convert_to_markdown", {
      uri: "http://169.254.169.254/latest/meta-data/",
    })
    //#then it is rejected with a reason + fix
    await expect(result).rejects.toThrow(/\[document-reader-guard\]/)
    await expect(result).rejects.toThrow(/file:\/\//)
  })

  test("blocks file:///etc/passwd — outside the workspace root", async () => {
    //#given an absolute file URI outside the workspace
    //#when
    const result = run("document_reader_convert_to_markdown", { uri: "file:///etc/passwd" })
    //#then
    await expect(result).rejects.toThrow(/outside the workspace root/)
  })

  test("allows in-workspace file:// URI", async () => {
    //#given a real document inside a real workspace
    //#when
    writeFileSync(join(tempWorkspace.workspace, "report.pdf"), "%PDF-1.4\n")
    const hook = makeHookAt(tempWorkspace.workspace)
    const result = hook["tool.execute.before"]?.(
      { tool: "document_reader_convert_to_markdown", sessionID: "ses_1", callID: "call_1" },
      { args: { uri: pathToFileURL(join(tempWorkspace.workspace, "report.pdf")).href } },
    )
    //#then it passes through to the MCP
    await expect(result).resolves.toBeUndefined()
  })

  test("blocks percent-encoded traversal out of the workspace", async () => {
    //#given / #when
    const result = run("document_reader_convert_to_markdown", {
      uri: "file:///workspace-root/%2e%2e/%2e%2e/etc/passwd",
    })
    //#then
    await expect(result).rejects.toThrow(/outside the workspace root/)
  })

  test("blocks loopback host (127.0.0.0/8)", async () => {
    //#given / #when
    const result = run("document_reader_convert_to_markdown", {
      uri: "file://127.0.0.1/workspace-root/docs/report.pdf",
    })
    //#then
    await expect(result).rejects.toThrow(/127\.0\.0\.1/)
  })

  test("blocks link-local host (169.254.0.0/16) over file:", async () => {
    //#given / #when
    const result = run("document_reader_convert_to_markdown", {
      uri: "file://169.254.169.254/workspace-root/docs/report.pdf",
    })
    //#then
    await expect(result).rejects.toThrow(/169\.254\.169\.254/)
  })

  test("blocks IPv6 loopback ::1", async () => {
    //#given / #when
    const result = run("document_reader_convert_to_markdown", {
      uri: "file://[::1]/workspace-root/docs/report.pdf",
    })
    //#then
    await expect(result).rejects.toThrow(/::1/)
  })

  test("blocks private ranges 10/8, 172.16/12, 192.168/16", async () => {
    //#given / #when / #then
    for (const host of ["10.1.2.3", "172.16.0.9", "172.31.255.255", "192.168.1.10"]) {
      await expect(
        run("document_reader_convert_to_markdown", {
          uri: `file://${host}/workspace-root/docs/report.pdf`,
        }),
      ).rejects.toThrow(new RegExp(host.replace(/\./g, "\\.")))
    }
  })

  test("allows public hosts in the 172.32+ range boundary", async () => {
    //#given a host outside every blocked range (172.32.0.1 is public) and a real in-workspace document
    //#when
    writeFileSync(join(tempWorkspace.workspace, "report.pdf"), "%PDF-1.4\n")
    const hook = makeHookAt(tempWorkspace.workspace)
    const result = hook["tool.execute.before"]?.(
      { tool: "document_reader_convert_to_markdown", sessionID: "ses_1", callID: "call_1" },
      {
        args: {
          uri: `file://172.32.0.1${pathToFileURL(join(tempWorkspace.workspace, "report.pdf")).pathname}`,
        },
      },
    )
    //#then host is allowed; only containment applies → in-workspace path passes
    await expect(result).resolves.toBeUndefined()
  })

  test("blocks metadata.google.internal literal host", async () => {
    //#given / #when
    const result = run("document_reader_convert_to_markdown", {
      uri: "file://metadata.google.internal/workspace-root/docs/report.pdf",
    })
    //#then
    await expect(result).rejects.toThrow(/metadata\.google\.internal/)
  })

  test("blocks data: URIs (non-file scheme)", async () => {
    //#given / #when
    const result = run("document_reader_convert_to_markdown", {
      uri: "data:text/html;base64,PGh0bWw+PC9odG1sPg==",
    })
    //#then
    await expect(result).rejects.toThrow(/only local file: URIs/)
  })

  test("blocks https: URIs (non-file scheme)", async () => {
    //#given / #when
    const result = run("document_reader_convert_to_markdown", {
      uri: "https://example.com/report.pdf",
    })
    //#then
    await expect(result).rejects.toThrow(/only local file: URIs/)
  })

  test("accepts the uri/path/filePath/source argument aliases", async () => {
    //#given the same out-of-workspace URI under each alias key
    //#when / #then all are guarded
    for (const key of ["uri", "path", "filePath", "source"]) {
      await expect(
        run("document_reader_convert_to_markdown", { [key]: "file:///etc/passwd" }),
      ).rejects.toThrow(/outside the workspace root/)
    }
  })

  test("matches bare document_reader and dotted/dashed variants", async () => {
    //#given / #when / #then
    for (const tool of ["document_reader", "document_reader.convert", "document_reader-convert"]) {
      await expect(run(tool, { uri: "file:///etc/passwd" })).rejects.toThrow(
        /outside the workspace root/,
      )
    }
  })

  test("document_reader call without a URI argument passes through", async () => {
    //#given no uri arg — the MCP tool itself surfaces its own input error
    //#when
    const result = run("document_reader_convert_to_markdown", {})
    //#then
    await expect(result).resolves.toBeUndefined()
  })

  test("unrelated tools are untouched", async () => {
    //#given Read on plain text and a benign shell command
    //#when / #then both pass through
    await expect(run("Read", { filePath: "/tmp/notes.md" })).resolves.toBeUndefined()
    await expect(run("bash", { command: "ls src" })).resolves.toBeUndefined()
  })
})

describe("document-reader-guard: symlink escape hardening", () => {
  test("blocks a leaf symlink pointing outside the workspace", () => {
    //#given <ws>/leaf_link.txt -> <root>/outside/secret.txt
    const outsideFile = join(tempWorkspace.outsideDir, "secret.txt")
    writeFileSync(outsideFile, "secret")
    symlinkSync(outsideFile, join(tempWorkspace.workspace, "leaf_link.txt"))

    //#when the URI points at the symlink
    const reason = evaluateDocumentReaderUri(
      pathToFileURL(join(tempWorkspace.workspace, "leaf_link.txt")).href,
      tempWorkspace.workspace,
    )

    //#then the read is blocked as outside the workspace
    expect(reason).toMatch(/outside the workspace root/)
    expect(reason).toContain(outsideFile)
  })

  test("blocks a symlinked parent directory carrying the path outside (etc -> /etc)", () => {
    //#given <ws>/etc -> /etc
    symlinkSync("/etc", join(tempWorkspace.workspace, "etc"))

    //#when
    const reason = evaluateDocumentReaderUri(
      pathToFileURL(join(tempWorkspace.workspace, "etc", "hostname")).href,
      tempWorkspace.workspace,
    )

    //#then
    expect(reason).toMatch(/outside the workspace root/)
  })

  test("allows a real document when both the file and the workspace are real", () => {
    //#given a real file inside a real workspace
    writeFileSync(join(tempWorkspace.workspace, "doc.pdf"), "%PDF-1.4\n")

    //#when
    const reason = evaluateDocumentReaderUri(
      pathToFileURL(join(tempWorkspace.workspace, "doc.pdf")).href,
      tempWorkspace.workspace,
    )

    //#then
    expect(reason).toBeUndefined()
  })

  test("blocks a broken symlink (fail closed)", () => {
    //#given <ws>/broken.txt -> a target that does not exist
    symlinkSync(join(tempWorkspace.root, "no-such-target"), join(tempWorkspace.workspace, "broken.txt"))

    //#when
    const reason = evaluateDocumentReaderUri(
      pathToFileURL(join(tempWorkspace.workspace, "broken.txt")).href,
      tempWorkspace.workspace,
    )

    //#then the guard fails closed with a resolvability reason
    expect(reason).toMatch(/could not be resolved/)
  })

  test("blocks a non-existent in-workspace file (fail closed)", () => {
    //#given
    //#when
    const reason = evaluateDocumentReaderUri(
      pathToFileURL(join(tempWorkspace.workspace, "missing.pdf")).href,
      tempWorkspace.workspace,
    )
    //#then
    expect(reason).toMatch(/could not be resolved/)
  })

  test("does not self-block when the workspace root itself is a symlink", () => {
    //#given a workspace reached through a symlink
    const realWorkspace = join(tempWorkspace.root, "real-ws")
    mkdirSync(realWorkspace)
    writeFileSync(join(realWorkspace, "doc.pdf"), "%PDF-1.4\n")
    const linkedWorkspace = join(tempWorkspace.root, "linked-ws")
    symlinkSync(realWorkspace, linkedWorkspace)

    //#when the URI goes through the symlinked workspace root
    const reason = evaluateDocumentReaderUri(
      pathToFileURL(join(linkedWorkspace, "doc.pdf")).href,
      linkedWorkspace,
    )

    //#then it is allowed
    expect(reason).toBeUndefined()
  })

  test("hook-level guard blocks a leaf symlink escape", async () => {
    //#given
    const outsideFile = join(tempWorkspace.outsideDir, "secret.txt")
    writeFileSync(outsideFile, "secret")
    symlinkSync(outsideFile, join(tempWorkspace.workspace, "leaf_link.txt"))
    const hook = makeHookAt(tempWorkspace.workspace)

    //#when
    const result = hook["tool.execute.before"]?.(
      { tool: "document_reader_convert_to_markdown", sessionID: "ses_1", callID: "call_1" },
      { args: { uri: pathToFileURL(join(tempWorkspace.workspace, "leaf_link.txt")).href } },
    )

    //#then
    await expect(result).rejects.toThrow(/outside the workspace root/)
  })
})

describe("document-reader-guard: relative file: URI base", () => {
  test("blocks a relative-form file: URI whose path escapes the workspace root", () => {
    //#given a relative pathname with '..' segments and no host
    //#when it is resolved against the workspace root instead of process.cwd()
    //#then containment fails and the read is blocked
    const reason = evaluateDocumentReaderUri("file:../../outside/secret.txt", tempWorkspace.workspace)

    expect(reason).toMatch(/outside the workspace root/)
  })

  test("blocks a bare relative-form file: URI (URL normalisation anchors it at the filesystem root, outside the workspace)", () => {
    //#given a hostless relative file: URI; WHATWG parsing rewrites it to an absolute
    //#pathname at the filesystem root (<root>/doc.pdf), which is outside any workspace
    writeFileSync(join(tempWorkspace.workspace, "doc.pdf"), "%PDF-1.4\n")

    //#when
    const reason = evaluateDocumentReaderUri("file:doc.pdf", tempWorkspace.workspace)

    //#then it is refused instead of silently resolving against process.cwd()
    expect(reason).toMatch(/outside the workspace root/)
  })
})

describe("document-reader-guard: IPv6 host normalisation", () => {
  test("blocks IPv4-mapped loopback in dotted form", () => {
    //#given / #when / #then
    expect(isBlockedUriHost("::ffff:127.0.0.1")).toBe(true)
  })

  test("blocks IPv4-mapped loopback in hex form (::ffff:7f00:1)", () => {
    //#given / #when / #then
    expect(isBlockedUriHost("::ffff:7f00:1")).toBe(true)
    expect(isBlockedUriHost("::ffff:7f00:0001")).toBe(true)
  })

  test("blocks the long spelling of the IPv4-mapped form", () => {
    //#given / #when / #then
    expect(isBlockedUriHost("0:0:0:0:0:ffff:7f00:1")).toBe(true)
  })

  test("blocks link-local fe80::/10 in every valid spelling", () => {
    //#given / #when / #then
    expect(isBlockedUriHost("fe80::1")).toBe(true)
    expect(isBlockedUriHost("fe80:0:0:0:0:0:0:1")).toBe(true)
    expect(isBlockedUriHost("febf::1")).toBe(true)
  })

  test("allows addresses just outside fe80::/10", () => {
    //#given / #when / #then
    expect(isBlockedUriHost("fec0::1")).toBe(false)
    expect(isBlockedUriHost("fe7f::1")).toBe(false)
  })

  test("blocks unique-local fc00::/7 (fc00:: and fd00::/8)", () => {
    //#given / #when / #then
    expect(isBlockedUriHost("fc00::1")).toBe(true)
    expect(isBlockedUriHost("fd12::3456")).toBe(true)
    expect(isBlockedUriHost("fdff::1")).toBe(true)
  })

  test("allows addresses outside fc00::/7", () => {
    //#given / #when / #then
    expect(isBlockedUriHost("fb00::1")).toBe(false)
    expect(isBlockedUriHost("fe00::1")).toBe(false)
  })

  test("blocks the unspecified address ::", () => {
    //#given / #when / #then
    expect(isBlockedUriHost("::")).toBe(true)
  })

  test("blocks IPv4-compatible loopback ::127.0.0.1", () => {
    //#given / #when / #then
    expect(isBlockedUriHost("::127.0.0.1")).toBe(true)
  })

  test("allows public IPv4-mapped hosts (falls through to path containment)", () => {
    //#given / #when / #then
    expect(isBlockedUriHost("::ffff:8.8.8.8")).toBe(false)
    expect(isBlockedUriHost("::8.8.8.8")).toBe(false)
  })

  test("still allows a missing (empty) host for plain file: paths", () => {
    //#given / #when / #then
    expect(isBlockedUriHost("")).toBe(false)
  })

  test("blocks hex-mapped loopback host over file: (URL-normalised hostname)", async () => {
    //#given WHATWG URL normalises [::ffff:127.0.0.1] to ::ffff:7f00:1
    //#when
    writeFileSync(join(tempWorkspace.workspace, "doc.pdf"), "%PDF-1.4\n")
    const hook = makeHookAt(tempWorkspace.workspace)
    const result = hook["tool.execute.before"]?.(
      { tool: "document_reader_convert_to_markdown", sessionID: "ses_1", callID: "call_1" },
      { args: { uri: `file://[::ffff:127.0.0.1]${pathToFileURL(join(tempWorkspace.workspace, "doc.pdf")).pathname}` } },
    )
    //#then
    await expect(result).rejects.toThrow(/::ffff:7f00:1/)
  })

  test("blocks hex-mapped loopback and link-local hosts over http (scheme guard)", async () => {
    //#given / #when / #then non-file schemes are blocked regardless of host spelling
    await expect(
      run("document_reader_convert_to_markdown", { uri: "http://[::ffff:127.0.0.1]/doc.pdf" }),
    ).rejects.toThrow(/only local file: URIs/)
    await expect(
      run("document_reader_convert_to_markdown", { uri: "http://[fe80::1]/doc.pdf" }),
    ).rejects.toThrow(/only local file: URIs/)
  })
})
