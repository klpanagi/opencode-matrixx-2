import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test"
import { appendFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { MatrixxContext } from "../../../../src/plugin/tool/context"
import { PACKAGE_NAME } from "../../../../src/hooks/auto-update-checker/constants"

// Shared log file (mirrors src/shared/logger.ts): the logger mock below is
// process-wide, so it forwards to the real file instead of swallowing.
const LOG_FILE = join(tmpdir(), "matrixx.log")
const mockLog = mock((message: string, _data?: unknown) => {})
const mockFindPluginEntry = mock(() => null)
const mockGetCachedVersion = mock(() => null as string | null)
const mockGetLatestVersion = mock(async () => null as string | null)
const mockRevertPinnedVersion = mock(() => false)
const mockExtractChannel = mock(() => "latest")
const mockInvalidatePackage = mock(() => true)
const mockShowUpdateAvailableToast = mock(async () => {})
const mockShowAutoUpdatedToast = mock(async () => {})

// Spawn seam: the real module spawns through deps.spawn, never directly.
const defaultSpawnImpl = (_cmd: string[], _opts: { cwd: string }) => ({
  exited: Promise.resolve(0),
  kill: () => {},
})
const mockSpawn = mock(defaultSpawnImpl)
const DEFAULT_INTEGRITY = "sha512-aaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbcccccccc"
const defaultFetchRegistryDistImpl = async () => ({ integrity: DEFAULT_INTEGRITY })
const mockFetchRegistryDist = mock(defaultFetchRegistryDistImpl)

const mockLogForwarder = (message: string, data?: unknown) => {
  mockLog(message, data)
  try {
    appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${message} ${data !== undefined ? JSON.stringify(data) : ""}\n`)
  } catch {}
}
mock.module("../../../../src/shared/runtime/logger", () => ({ log: mockLogForwarder }))

afterAll(() => {
  // The logger mock above forwards from birth, so later suites are unaffected.
  mock.restore()
})

// Sibling suites mock the background-update-check specifier itself; bun's mock
// proxy poisons re-export getters, so evict the core module from the require
// cache and re-require it to get the un-proxied implementation.
const coreModulePath = require.resolve("../../../../src/hooks/auto-update-checker/hook/background-update-core")
delete require.cache[coreModulePath]
const { runBackgroundUpdateCheck } = require(coreModulePath)

// The config gate reads security.auto_update.auto_install from the opencode
// config under getOpenCodeConfigPaths(), which honors OPENCODE_CONFIG_DIR —
// point it at a temp dir and write per-scenario config files.
let configDir: string
const originalConfigDirEnv = process.env.OPENCODE_CONFIG_DIR

function configFilePath(): string {
  return join(configDir, "opencode.json")
}
function writeConfigFile(value: unknown): void {
  writeFileSync(configFilePath(), JSON.stringify(value), "utf-8")
}
function clearConfigFile(): void {
  rmSync(configFilePath(), { force: true })
}

const UNPINNED_PLUGIN = {
  entry: PACKAGE_NAME,
  isPinned: false,
  pinnedVersion: null,
  configPath: "/test/opencode.json",
}
const PINNED_PLUGIN = {
  entry: `${PACKAGE_NAME}@3.4.0`,
  isPinned: true,
  pinnedVersion: "3.4.0",
  configPath: "/test/opencode.json",
}

const mockCtx = { directory: "/test" } as unknown as MatrixxContext
const mockGetToastMessage = (isUpdate: boolean, version?: string) =>
  isUpdate ? `Update to ${version}` : "Up to date"

function deps() {
  return {
    findPluginEntry: mockFindPluginEntry,
    getCachedVersion: mockGetCachedVersion,
    getLatestVersion: mockGetLatestVersion,
    extractChannel: mockExtractChannel,
    invalidatePackage: mockInvalidatePackage,
    showUpdateAvailableToast: mockShowUpdateAvailableToast,
    showAutoUpdatedToast: mockShowAutoUpdatedToast,
    revertPinnedVersion: mockRevertPinnedVersion,
    fetchRegistryDist: mockFetchRegistryDist,
    spawn: mockSpawn,
  }
}

function logCalls(): string[] {
  return mockLog.mock.calls.map((call) => call.map((arg) => (arg === undefined ? "" : String(arg))).join(" "))
}

describe("runBackgroundUpdateCheck", () => {
  beforeAll(() => {
    configDir = mkdtempSync(join(tmpdir(), "matrixx-autoinstall-test-"))
    process.env.OPENCODE_CONFIG_DIR = configDir
  })
  afterAll(() => {
    if (originalConfigDirEnv === undefined) delete process.env.OPENCODE_CONFIG_DIR
    else process.env.OPENCODE_CONFIG_DIR = originalConfigDirEnv
    if (configDir && existsSync(configDir)) rmSync(configDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    // Last-wins patch: sibling suites re-mock the logger at top level, so
    // re-assert our recording forwarder before every test in this file.
    mock.module("../../../../src/shared/runtime/logger", () => ({ log: mockLogForwarder }))
    mockLog.mockClear()
    mockFindPluginEntry.mockClear()
    mockGetCachedVersion.mockClear()
    mockGetLatestVersion.mockClear()
    mockRevertPinnedVersion.mockClear()
    mockExtractChannel.mockClear()
    mockInvalidatePackage.mockClear()
    mockShowUpdateAvailableToast.mockClear()
    mockShowAutoUpdatedToast.mockClear()
    mockSpawn.mockClear()
    mockFetchRegistryDist.mockClear()

    mockExtractChannel.mockReturnValue("latest")
    mockGetLatestVersion.mockResolvedValue("3.5.0")
    mockGetCachedVersion.mockReturnValue("3.4.0")
    mockSpawn.mockImplementation(defaultSpawnImpl)
    mockFetchRegistryDist.mockImplementation(defaultFetchRegistryDistImpl)
    clearConfigFile()
  })

  describe("#given security.auto_update.auto_install is absent (default)", () => {
    beforeEach(() => {
      mockFindPluginEntry.mockReturnValue(UNPINNED_PLUGIN)
    })

    it("#then should never spawn a process", async () => {
      await runBackgroundUpdateCheck(mockCtx, true, mockGetToastMessage, deps())
      expect(mockSpawn).not.toHaveBeenCalled()
    })

    it("#then should only show the update-available toast", async () => {
      await runBackgroundUpdateCheck(mockCtx, true, mockGetToastMessage, deps())
      expect(mockShowUpdateAvailableToast).toHaveBeenCalledTimes(1)
      expect(mockShowUpdateAvailableToast).toHaveBeenCalledWith(mockCtx, "3.5.0", mockGetToastMessage)
      expect(mockShowAutoUpdatedToast).not.toHaveBeenCalled()
    })

    it("#then should not even fetch registry integrity metadata", async () => {
      await runBackgroundUpdateCheck(mockCtx, true, mockGetToastMessage, deps())
      expect(mockFetchRegistryDist).not.toHaveBeenCalled()
    })
  })

  describe("#given security.auto_update.auto_install is explicitly false", () => {
    beforeEach(() => {
      mockFindPluginEntry.mockReturnValue(UNPINNED_PLUGIN)
      writeConfigFile({ security: { auto_update: { auto_install: false } } })
    })

    it("#then should never spawn a process", async () => {
      await runBackgroundUpdateCheck(mockCtx, true, mockGetToastMessage, deps())
      expect(mockSpawn).not.toHaveBeenCalled()
    })

    it("#then should show the notification toast", async () => {
      await runBackgroundUpdateCheck(mockCtx, true, mockGetToastMessage, deps())
      expect(mockShowUpdateAvailableToast).toHaveBeenCalledTimes(1)
    })
  })

  describe("#given auto_install enabled and registry integrity present", () => {
    beforeEach(() => {
      mockFindPluginEntry.mockReturnValue(UNPINNED_PLUGIN)
      writeConfigFile({ security: { auto_update: { auto_install: true } } })
    })

    it("#then should spawn bun add with the exact version and --ignore-scripts", async () => {
      await runBackgroundUpdateCheck(mockCtx, true, mockGetToastMessage, deps())
      expect(mockSpawn).toHaveBeenCalledTimes(1)
      const [cmd, opts] = mockSpawn.mock.calls[0]
      expect(cmd).toEqual(["bun", "add", `${PACKAGE_NAME}@3.5.0`, "--ignore-scripts"])
      expect(opts.cwd).toBe(configDir)
    })

    it("#then should never install a dist-tag like latest", async () => {
      await runBackgroundUpdateCheck(mockCtx, true, mockGetToastMessage, deps())
      const [cmd] = mockSpawn.mock.calls[0]
      expect(cmd.some((arg: string) => arg.endsWith("@latest"))).toBe(false)
    })

    it("#then should invalidate the package cache and show the auto-updated toast", async () => {
      await runBackgroundUpdateCheck(mockCtx, true, mockGetToastMessage, deps())
      expect(mockInvalidatePackage).toHaveBeenCalledWith(PACKAGE_NAME)
      expect(mockShowAutoUpdatedToast).toHaveBeenCalledWith(mockCtx, "3.4.0", "3.5.0")
    })

    it("#then should log only a redacted integrity prefix", async () => {
      await runBackgroundUpdateCheck(mockCtx, true, mockGetToastMessage, deps())
      const messages = logCalls().join("\n")
      expect(messages).toContain(DEFAULT_INTEGRITY.slice(0, 14))
      expect(messages).not.toContain(DEFAULT_INTEGRITY)
    })
  })

  describe("#given auto_install enabled but registry integrity metadata is missing", () => {
    beforeEach(() => {
      mockFindPluginEntry.mockReturnValue(UNPINNED_PLUGIN)
      writeConfigFile({ security: { auto_update: { auto_install: true } } })
      mockFetchRegistryDist.mockResolvedValue({})
    })

    it("#then should never spawn a process", async () => {
      await runBackgroundUpdateCheck(mockCtx, true, mockGetToastMessage, deps())
      expect(mockSpawn).not.toHaveBeenCalled()
    })

    it("#then should log a warning about the missing integrity", async () => {
      await runBackgroundUpdateCheck(mockCtx, true, mockGetToastMessage, deps())
      expect(logCalls().some((m) => m.toLowerCase().includes("integrity"))).toBe(true)
    })

    it("#then should fall back to notification-only", async () => {
      await runBackgroundUpdateCheck(mockCtx, true, mockGetToastMessage, deps())
      expect(mockShowUpdateAvailableToast).toHaveBeenCalledTimes(1)
      expect(mockShowAutoUpdatedToast).not.toHaveBeenCalled()
      expect(mockRevertPinnedVersion).not.toHaveBeenCalled()
    })
  })

  describe("#given auto_install enabled but install fails (spawn throws)", () => {
    beforeEach(() => {
      mockFindPluginEntry.mockReturnValue(UNPINNED_PLUGIN)
      writeConfigFile({ security: { auto_update: { auto_install: true } } })
      mockSpawn.mockImplementation(() => {
        throw new Error("spawn failed")
      })
    })

    it("#then should keep the revert path unchanged (gated on isPinned, not called for unpinned)", async () => {
      await runBackgroundUpdateCheck(mockCtx, true, mockGetToastMessage, deps())
      expect(mockRevertPinnedVersion).not.toHaveBeenCalled()
    })

    it("#then should fall back to the update-available toast", async () => {
      await runBackgroundUpdateCheck(mockCtx, true, mockGetToastMessage, deps())
      expect(mockInvalidatePackage).toHaveBeenCalledWith(PACKAGE_NAME)
      expect(mockShowUpdateAvailableToast).toHaveBeenCalledTimes(1)
      expect(mockShowAutoUpdatedToast).not.toHaveBeenCalled()
    })
  })

  describe("#given pinned plugin with auto_install enabled", () => {
    beforeEach(() => {
      mockFindPluginEntry.mockReturnValue(PINNED_PLUGIN)
      writeConfigFile({ security: { auto_update: { auto_install: true } } })
    })

    it("#then should never spawn and keep notification-only (pinned gate unchanged)", async () => {
      await runBackgroundUpdateCheck(mockCtx, true, mockGetToastMessage, deps())
      expect(mockSpawn).not.toHaveBeenCalled()
      expect(mockShowUpdateAvailableToast).toHaveBeenCalledTimes(1)
      expect(mockRevertPinnedVersion).not.toHaveBeenCalled()
    })
  })

  describe("#given latest version resolved to a dist-tag string", () => {
    beforeEach(() => {
      mockFindPluginEntry.mockReturnValue(UNPINNED_PLUGIN)
      writeConfigFile({ security: { auto_update: { auto_install: true } } })
      mockGetLatestVersion.mockResolvedValue("latest")
    })

    it("#then should refuse to install and never spawn", async () => {
      await runBackgroundUpdateCheck(mockCtx, true, mockGetToastMessage, deps())
      expect(mockSpawn).not.toHaveBeenCalled()
      expect(mockShowUpdateAvailableToast).toHaveBeenCalledTimes(1)
      expect(mockShowAutoUpdatedToast).not.toHaveBeenCalled()
    })
  })

  describe("#given autoUpdate option is false", () => {
    beforeEach(() => {
      mockFindPluginEntry.mockReturnValue(UNPINNED_PLUGIN)
      writeConfigFile({ security: { auto_update: { auto_install: true } } })
    })

    it("#then should only show the notification toast", async () => {
      await runBackgroundUpdateCheck(mockCtx, false, mockGetToastMessage, deps())
      expect(mockShowUpdateAvailableToast).toHaveBeenCalledTimes(1)
      expect(mockSpawn).not.toHaveBeenCalled()
      expect(mockRevertPinnedVersion).not.toHaveBeenCalled()
    })
  })

  describe("#given already on latest version", () => {
    beforeEach(() => {
      mockFindPluginEntry.mockReturnValue(PINNED_PLUGIN)
      mockGetCachedVersion.mockReturnValue("3.5.0")
      mockGetLatestVersion.mockResolvedValue("3.5.0")
      writeConfigFile({ security: { auto_update: { auto_install: true } } })
    })

    it("#then should not update or show any toast", async () => {
      await runBackgroundUpdateCheck(mockCtx, true, mockGetToastMessage, deps())
      expect(mockShowUpdateAvailableToast).not.toHaveBeenCalled()
      expect(mockShowAutoUpdatedToast).not.toHaveBeenCalled()
      expect(mockSpawn).not.toHaveBeenCalled()
    })
  })

  describe("#given latest version is a semver-lookalike (1.2.3evil)", () => {
    beforeEach(() => {
      mockFindPluginEntry.mockReturnValue(UNPINNED_PLUGIN)
      writeConfigFile({ security: { auto_update: { auto_install: true } } })
      mockGetLatestVersion.mockResolvedValue("1.2.3evil")
    })

    it("#then should refuse to install and never spawn", async () => {
      await runBackgroundUpdateCheck(mockCtx, true, mockGetToastMessage, deps())
      expect(mockSpawn).not.toHaveBeenCalled()
      expect(mockFetchRegistryDist).not.toHaveBeenCalled()
      expect(mockShowUpdateAvailableToast).toHaveBeenCalledTimes(1)
      expect(mockShowAutoUpdatedToast).not.toHaveBeenCalled()
    })
  })
})
