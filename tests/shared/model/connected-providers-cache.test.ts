import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  hasConnectedProvidersCache,
  hasProviderModelsCache,
  readConnectedProvidersCache,
  readProviderModelsCache,
} from "../../../src/shared/model/connected-providers-cache"
import * as logger from "../../../src/shared/runtime/logger"

const CONNECTED_PAYLOAD = JSON.stringify({
  connected: ["openai", "anthropic"],
  updatedAt: "2026-01-01T00:00:00.000Z",
})
const MODELS_PAYLOAD = JSON.stringify({
  models: { openai: ["gpt-5.2"], anthropic: ["claude-opus-4-6"] },
  connected: ["openai", "anthropic"],
  updatedAt: "2026-01-01T00:00:00.000Z",
})

interface FsProbe {
  readonly counts: Map<string, number>
  stop(): void
}

describe("connected-providers-cache", () => {
  let tempDir: string
  let originalXdgCache: string | undefined
  const restores: Array<() => void> = []

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "matrixx-connected-cache-test-"))
    originalXdgCache = process.env.XDG_CACHE_HOME
    process.env.XDG_CACHE_HOME = tempDir
    const logSpy = spyOn(logger, "log").mockImplementation(() => {})
    restores.push(() => logSpy.mockRestore())
  })

  afterEach(() => {
    for (const restore of restores.splice(0)) restore()
    mock.restore()
    if (originalXdgCache !== undefined) process.env.XDG_CACHE_HOME = originalXdgCache
    else delete process.env.XDG_CACHE_HOME
    rmSync(tempDir, { recursive: true, force: true })
  })

  function writeCacheFile(filename: string, data: unknown): void {
    const cacheDir = join(tempDir, "matrixx")
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(join(cacheDir, filename), JSON.stringify(data, null, 2))
  }

  function probeFs(options: { exists: boolean; contents?: string }): FsProbe {
    const counts = new Map<string, number>()
    let recording = true
    const record = (operation: string) => {
      if (recording) counts.set(operation, (counts.get(operation) ?? 0) + 1)
    }
    const existsSpy = spyOn(fs, "existsSync").mockImplementation((() => {
      record("existsSync")
      return options.exists
    }) as typeof fs.existsSync)
    const readSpy = spyOn(fs, "readFileSync").mockImplementation((() => {
      record("readFileSync")
      return options.contents ?? ""
    }) as typeof fs.readFileSync)
    restores.push(() => existsSpy.mockRestore())
    restores.push(() => readSpy.mockRestore())
    return {
      counts,
      stop: () => {
        recording = false
      },
    }
  }

  it("#given no cache file #when hasConnectedProvidersCache #then false", () => {
    expect(hasConnectedProvidersCache()).toBe(false)
  })

  it("#given cache file #when hasConnectedProvidersCache #then true", () => {
    writeCacheFile("connected-providers.json", { connected: ["openai"], updatedAt: "2026-01-01T00:00:00.000Z" })

    expect(hasConnectedProvidersCache()).toBe(true)
  })

  it("#given cache created after a call #when hasConnectedProvidersCache called again #then reflects the new file with no stale memoization", () => {
    expect(hasConnectedProvidersCache()).toBe(false)

    writeCacheFile("connected-providers.json", { connected: ["openai"], updatedAt: "2026-01-01T00:00:00.000Z" })

    expect(hasConnectedProvidersCache()).toBe(true)
  })

  it("#given cache file #when hasConnectedProvidersCache called five times #then one existsSync and zero readFileSync per call", () => {
    const probe = probeFs({ exists: true, contents: CONNECTED_PAYLOAD })

    for (let i = 0; i < 5; i++) hasConnectedProvidersCache()
    probe.stop()

    expect(probe.counts.get("existsSync")).toBe(5)
    expect(probe.counts.get("readFileSync")).toBeUndefined()
  })

  it("#given no cache file #when readConnectedProvidersCache #then null and only one existsSync", () => {
    const probe = probeFs({ exists: false })

    const result = readConnectedProvidersCache()
    probe.stop()

    expect(result).toBeNull()
    expect(probe.counts.get("existsSync")).toBe(1)
    expect(probe.counts.get("readFileSync")).toBeUndefined()
  })

  it("#given cache file #when readConnectedProvidersCache called three times #then parses the list and reads exactly once per call", () => {
    const probe = probeFs({ exists: true, contents: CONNECTED_PAYLOAD })

    const results = [
      readConnectedProvidersCache(),
      readConnectedProvidersCache(),
      readConnectedProvidersCache(),
    ]
    probe.stop()

    expect(results).toEqual([
      ["openai", "anthropic"],
      ["openai", "anthropic"],
      ["openai", "anthropic"],
    ])
    expect(probe.counts.get("existsSync")).toBe(3)
    expect(probe.counts.get("readFileSync")).toBe(3)
  })

  it("#given provider-models cache file #when readProviderModelsCache called twice #then parses models and reads exactly once per call", () => {
    const probe = probeFs({ exists: true, contents: MODELS_PAYLOAD })

    const results = [readProviderModelsCache(), readProviderModelsCache()]
    probe.stop()

    expect(results[0]?.connected).toEqual(["openai", "anthropic"])
    expect(results[0]?.models).toEqual({ openai: ["gpt-5.2"], anthropic: ["claude-opus-4-6"] })
    expect(results[1]?.connected).toEqual(["openai", "anthropic"])
    expect(probe.counts.get("existsSync")).toBe(2)
    expect(probe.counts.get("readFileSync")).toBe(2)
  })

  it("#given provider-models cache #when hasProviderModelsCache called four times #then one existsSync and zero readFileSync per call", () => {
    const probe = probeFs({ exists: true, contents: MODELS_PAYLOAD })

    for (let i = 0; i < 4; i++) hasProviderModelsCache()
    probe.stop()

    expect(probe.counts.get("existsSync")).toBe(4)
    expect(probe.counts.get("readFileSync")).toBeUndefined()
  })
})
