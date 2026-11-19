import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { parseSkillArgs, SkillUsageError } from "../../../src/cli/skill/args"
import { runSkillCommand } from "../../../src/cli/skill/index"
import type { InstallPackOptions, installPack } from "../../../src/cli/skill-pack/installer"
import type { PackId } from "../../../src/skills/packs/types"

const tempRoots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "matrixx-skill-cli-"))
  tempRoots.push(root)
  return root
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function capture() {
  const out: string[] = []
  const err: string[] = []
  return {
    out,
    err,
    io: {
      stdout: (line: string) => out.push(line),
      stderr: (line: string) => err.push(line),
    },
  }
}

function fakeInstall(calls: InstallPackOptions[]): typeof installPack {
  return async (options) => {
    calls.push(options)
    const packId = options.packId as PackId
    const version = options.version ?? "2.15.0"
    return {
      packId,
      version,
      dir: path.join(options.root ?? "/tmp", packId, version),
      skills: [packId],
      lock: {
        packId,
        version,
        integrity: "sha512-fixture",
        sourceUrl: "https://fixture.test/pack.tgz",
        installedAt: "2026-01-01T00:00:00.000Z",
        files: [],
        skills: [],
        risks: [],
        pythonRequired: false,
      },
    }
  }
}

describe("parseSkillArgs", () => {
  test("parses add with defaults", () => {
    //#given an add invocation with one pack
    //#when parsing the argv
    const command = parseSkillArgs(["add", "ui-ux-pro-max"])

    //#then every optional flag defaults to off
    expect(command).toEqual({
      command: "add",
      packs: ["ui-ux-pro-max"],
      all: false,
      force: false,
      dryRun: false,
      allowNetwork: false,
      allowApiKeys: false,
      json: false,
    })
  })

  test("parses every add flag", () => {
    //#given all supported add flags
    //#when parsing
    const command = parseSkillArgs([
      "add",
      "ui-styling",
      "--version",
      "2.15.0",
      "--force",
      "--dry-run",
      "--allow-network",
      "--allow-api-keys",
      "--root",
      "/tmp/packs",
      "--json",
    ])

    //#then the flags are carried through
    expect(command).toMatchObject({
      packs: ["ui-styling"],
      version: "2.15.0",
      force: true,
      dryRun: true,
      allowNetwork: true,
      allowApiKeys: true,
      root: "/tmp/packs",
      json: true,
    })
  })

  test("parses add --version= and --root= forms", () => {
    //#given inline flag values
    //#when parsing
    const command = parseSkillArgs(["add", "brand", "--version=1.2.3", "--root=/tmp/x"])

    //#then both values are captured
    expect(command).toMatchObject({ version: "1.2.3", root: "/tmp/x" })
  })

  test("parses add --all", () => {
    //#given the --all selector
    //#when parsing
    const command = parseSkillArgs(["add", "--all", "--allow-network", "--allow-api-keys"])

    //#then all is set with no explicit packs
    expect(command).toMatchObject({ all: true, packs: [], allowNetwork: true, allowApiKeys: true })
  })

  test("rejects --all combined with explicit packs", () => {
    //#given a contradictory selector
    //#when parsing
    const parse = () => parseSkillArgs(["add", "brand", "--all"])

    //#then it is a usage error
    expect(parse).toThrow(SkillUsageError)
  })

  test("rejects add without packs or --all", () => {
    //#given no pack selector
    //#when parsing
    const parse = () => parseSkillArgs(["add", "--dry-run"])

    //#then it is a usage error
    expect(parse).toThrow(SkillUsageError)
  })

  test("rejects unknown add flags", () => {
    //#given a flag add does not support
    //#when parsing
    const parse = () => parseSkillArgs(["add", "brand", "--frobnicate"])

    //#then it is a usage error
    expect(parse).toThrow(SkillUsageError)
  })

  test("rejects a flag missing its value", () => {
    //#given --version without a value
    //#when parsing
    const parse = () => parseSkillArgs(["add", "brand", "--version"])

    //#then it is a usage error
    expect(parse).toThrow(SkillUsageError)
  })

  test("parses list with json and root", () => {
    //#given list flags
    //#when parsing
    const command = parseSkillArgs(["list", "--json", "--root", "/tmp/packs"])

    //#then both are captured
    expect(command).toEqual({ command: "list", json: true, root: "/tmp/packs" })
  })

  test("rejects positional arguments for list", () => {
    //#given list with a stray argument
    //#when parsing
    const parse = () => parseSkillArgs(["list", "brand"])

    //#then it is a usage error
    expect(parse).toThrow(SkillUsageError)
  })

  test("parses remove with one pack", () => {
    //#given a remove invocation
    //#when parsing
    const command = parseSkillArgs(["remove", "brand", "--version", "2.15.0", "--force", "--root", "/tmp/p"])

    //#then the pack and flags are captured
    expect(command).toEqual({
      command: "remove",
      pack: "brand",
      version: "2.15.0",
      force: true,
      root: "/tmp/p",
    })
  })

  test("requires exactly one pack for remove", () => {
    //#given zero and two pack arguments
    //#when parsing each
    const none = () => parseSkillArgs(["remove"])
    const many = () => parseSkillArgs(["remove", "brand", "slides"])

    //#then both are usage errors
    expect(none).toThrow(SkillUsageError)
    expect(many).toThrow(SkillUsageError)
  })

  test("rejects unknown subcommands and missing subcommands", () => {
    //#given no subcommand and a bogus subcommand
    //#when parsing each
    const empty = () => parseSkillArgs([])
    const bogus = () => parseSkillArgs(["install"])

    //#then both are usage errors
    expect(empty).toThrow(SkillUsageError)
    expect(bogus).toThrow(SkillUsageError)
  })

  test("returns the help command for --help and -h", () => {
    //#given help flags at any position
    //#when parsing
    const long = parseSkillArgs(["add", "--help"])
    const short = parseSkillArgs(["list", "-h"])

    //#then both resolve to help
    expect(long).toEqual({ command: "help" })
    expect(short).toEqual({ command: "help" })
  })
})

describe("runSkillCommand", () => {
  test("empty list exits 0 with an install hint", async () => {
    //#given an empty packs root
    const root = tempRoot()
    const { io, out } = capture()

    //#when listing
    const code = await runSkillCommand(["list", "--root", root], io)

    //#then it succeeds and points at the next command
    expect(code).toBe(0)
    expect(out.join("\n")).toContain("No skill packs installed. Run: matrixx skill add ui-ux-pro-max")
  })

  test("empty list in JSON mode emits an array", async () => {
    //#given an empty packs root
    const root = tempRoot()
    const { io, out } = capture()

    //#when listing as JSON
    const code = await runSkillCommand(["list", "--json", "--root", root], io)

    //#then the output parses to an empty array
    expect(code).toBe(0)
    expect(JSON.parse(out.join("\n"))).toEqual([])
  })

  test("unknown pack on add exits 2 and prints the catalog", async () => {
    //#given an unknown pack id
    const calls: InstallPackOptions[] = []
    const { io, err } = capture()

    //#when adding it
    const code = await runSkillCommand(["add", "not-a-pack"], {
      ...io,
      install: fakeInstall(calls),
    })

    //#then it fails as usage, names the catalog, and never installs
    expect(code).toBe(2)
    expect(err.join("\n")).toContain("Unknown skill pack: not-a-pack")
    expect(err.join("\n")).toContain("ui-ux-pro-max")
    expect(calls).toHaveLength(0)
  })

  test("--all without --allow-network refuses ui-styling before installing", async () => {
    //#given --all without consent flags
    const calls: InstallPackOptions[] = []
    const { io, err } = capture()

    //#when adding every pack
    const code = await runSkillCommand(["add", "--all"], { ...io, install: fakeInstall(calls) })

    //#then the network pack is refused and nothing was installed
    expect(code).toBe(2)
    expect(err.join("\n")).toContain("ui-styling")
    expect(err.join("\n")).toContain("--allow-network")
    expect(calls).toHaveLength(0)
  })

  test("add --dry-run forwards dryRun and writes nothing", async () => {
    //#given a permission-free pack and an empty root
    const root = tempRoot()
    const calls: InstallPackOptions[] = []
    const { io, out } = capture()

    //#when adding in dry-run mode
    const code = await runSkillCommand(["add", "slides", "--dry-run", "--root", root], {
      ...io,
      install: fakeInstall(calls),
    })

    //#then the installer saw dryRun, the table says dry-run, and no files exist
    expect(code).toBe(0)
    expect(calls[0]?.dryRun).toBe(true)
    expect(out.join("\n")).toContain("dry-run")
    expect(existsSync(root) ? readdirSync(root) : []).toEqual([])
  })

  test("add --json emits machine-readable rows", async () => {
    //#given a permission-free pack
    const root = tempRoot()
    const { io, out } = capture()

    //#when adding as JSON
    const code = await runSkillCommand(["add", "banner-design", "--root", root, "--json"], {
      ...io,
      install: fakeInstall([]),
    })

    //#then the payload parses and reports the pack
    expect(code).toBe(0)
    expect(JSON.parse(out.join("\n"))).toMatchObject([{ pack: "banner-design", status: "installed" }])
  })

  test("remove exits 2 for a pack outside the catalog", async () => {
    //#given an unknown pack
    const { io, err } = capture()

    //#when removing it
    const code = await runSkillCommand(["remove", "mystery"], io)

    //#then it is a usage error with the catalog
    expect(code).toBe(2)
    expect(err.join("\n")).toContain("ui-ux-pro-max")
  })

  test("remove exits 1 when the pack is not installed", async () => {
    //#given an empty root
    const root = tempRoot()
    const { io, err } = capture()

    //#when removing a catalog pack
    const code = await runSkillCommand(["remove", "slides", "--root", root], io)

    //#then it fails at runtime
    expect(code).toBe(1)
    expect(err.join("\n")).toContain("not installed")
  })

  test("remove deletes an installed pack version", async () => {
    //#given an installed version directory
    const root = tempRoot()
    mkdirSync(path.join(root, "slides", "2.15.0"), { recursive: true })
    const { io, out } = capture()

    //#when removing it
    const code = await runSkillCommand(["remove", "slides", "--root", root], io)

    //#then it succeeds and the directory is gone
    expect(code).toBe(0)
    expect(existsSync(path.join(root, "slides"))).toBe(false)
    expect(out.join("\n")).toContain("Removed slides")
  })

  test("unknown subcommand exits 2 with usage", async () => {
    //#given a bogus subcommand
    const { io, err } = capture()

    //#when dispatching it
    const code = await runSkillCommand(["bogus"], io)

    //#then usage is printed and the exit code is 2
    expect(code).toBe(2)
    expect(err.join("\n")).toContain("Usage:")
  })

  test("help exits 0 with usage", async () => {
    //#given the help flag
    const { io, out } = capture()

    //#when dispatching it
    const code = await runSkillCommand(["--help"], io)

    //#then usage is printed without an error
    expect(code).toBe(0)
    expect(out.join("\n")).toContain("matrixx skill add")
  })
})
