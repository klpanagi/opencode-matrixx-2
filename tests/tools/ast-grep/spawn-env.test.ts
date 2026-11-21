/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, dirname, join } from "node:path"

import { isUsableSgBinary } from "../../../src/shared/comment-scan/sg-invoke"
import { runSg } from "../../../src/tools/ast-grep/cli"
import { setSgCliPath } from "../../../src/tools/ast-grep/constants"
import { sgSpawnEnv } from "../../../src/tools/ast-grep/spawn-env"

const originalPath = process.env.PATH
const PROBE_KEY = "MATRIXX_SPAWN_ENV_PROBE"

const LAUNCHER_SCRIPT = `#!/bin/sh
self_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
case ":$PATH:" in
  *":$self_dir:"*) ;;
  *) echo 'Error: Os { code: 2, kind: NotFound, message: "No such file or directory" }' >&2; exit 1 ;;
esac
if [ "$1" = "--version" ]; then
  echo "ast-grep 0.40.5"
  exit 0
fi
exit 0
`

let tempDir: string
let launcherPath: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "matrixx-spawn-env-"))
  launcherPath = join(tempDir, "sg")
  writeFileSync(launcherPath, LAUNCHER_SCRIPT)
  chmodSync(launcherPath, 0o755)
})

afterEach(() => {
  process.env.PATH = originalPath
  delete process.env[PROBE_KEY]
  setSgCliPath("")
  rmSync(tempDir, { recursive: true, force: true })
})

describe("sgSpawnEnv", () => {
  it("#when PATH is set #then prepends the binary directory", () => {
    //#given
    const cliPath = join("/opt", "ast-grep", "sg")

    //#when
    const env = sgSpawnEnv(cliPath)

    //#then
    expect(env.PATH).toBe(`${dirname(cliPath)}${delimiter}${originalPath}`)
  })

  it("#when PATH is missing #then returns only the binary directory", () => {
    //#given
    delete process.env.PATH

    //#when
    const env = sgSpawnEnv(join("/opt", "ast-grep", "sg"))

    //#then
    expect(env.PATH).toBe(join("/opt", "ast-grep"))
  })

  it("#when the process environment has other variables #then preserves them", () => {
    //#given
    process.env[PROBE_KEY] = "kept"

    //#when
    const env = sgSpawnEnv(join("/opt", "ast-grep", "sg"))

    //#then
    expect(env[PROBE_KEY]).toBe("kept")
  })
})

describe("launcher PATH resolution", () => {
  it.skipIf(process.platform === "win32")("#when the launcher needs its own directory on PATH #then isUsableSgBinary accepts it", async () => {
    //#given
    //#when
    const usable = await isUsableSgBinary(launcherPath, (await import("bun")).spawn)

    //#then
    expect(usable).toBe(true)
  })

  it.skipIf(process.platform === "win32")("#when runSg spawns the launcher #then the run succeeds", async () => {
    //#given
    setSgCliPath(launcherPath)

    //#when
    const result = await runSg({ pattern: "console.log($A)", lang: "typescript", paths: ["."] })

    //#then
    expect(result.error).toBeUndefined()
  })
})
