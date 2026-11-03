import { afterAll, describe, expect, it, mock } from "bun:test"
import { appendFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
// Shared log file (mirrors src/shared/logger.ts): the logger mock below is
// process-wide, so it forwards to the real file instead of swallowing.
const LOG_FILE = join(tmpdir(), "matrixx.log")

const mockShowConfigErrorsIfAny = mock(async () => {})
const mockShowModelCacheWarningIfNeeded = mock(async () => {})
const mockUpdateAndShowConnectedProvidersCacheStatus = mock(async () => {})
const mockShowLocalDevToast = mock(async () => {})
const mockShowVersionToast = mock(async () => {})
const mockRunBackgroundUpdateCheck = mock(async () => {})
const mockGetCachedVersion = mock(() => "3.6.0")
const mockGetLocalDevVersion = mock(() => "3.6.0")

const realBackgroundUpdateCheckModule = require("../../../src/hooks/auto-update-checker/hook/background-update-check")
const realCheckerModule = require("../../../src/hooks/auto-update-checker/checker")

mock.module("../../../src/hooks/auto-update-checker/hook/config-errors-toast", () => ({
  showConfigErrorsIfAny: mockShowConfigErrorsIfAny,
}))

mock.module("../../../src/hooks/auto-update-checker/hook/model-cache-warning", () => ({
  showModelCacheWarningIfNeeded: mockShowModelCacheWarningIfNeeded,
}))

mock.module("../../../src/hooks/auto-update-checker/hook/connected-providers-status", () => ({
  updateAndShowConnectedProvidersCacheStatus:
    mockUpdateAndShowConnectedProvidersCacheStatus,
}))

mock.module("../../../src/hooks/auto-update-checker/hook/startup-toasts", () => ({
  showLocalDevToast: mockShowLocalDevToast,
  showVersionToast: mockShowVersionToast,
}))

mock.module("../../../src/hooks/auto-update-checker/hook/background-update-check", () => ({
  runBackgroundUpdateCheck: mockRunBackgroundUpdateCheck,
}))

mock.module("../../../src/hooks/auto-update-checker/checker", () => ({
  getCachedVersion: mockGetCachedVersion,
  getLocalDevVersion: mockGetLocalDevVersion,
}))

mock.module("../../../src/shared/logger", () => ({
  // Transparent from birth: forward to the real log file (same format as
  // src/shared/logger.ts). Never references the mocked module.
  log: (message: string, data?: unknown) => {
    try {
      appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${message} ${data !== undefined ? JSON.stringify(data) : ""}\n`)
    } catch {}
  },
}))

const { createAutoUpdateCheckerHook } = await import("../../../src/hooks/auto-update-checker/hook")

afterAll(() => {
  mock.module("../../../src/hooks/auto-update-checker/hook/background-update-check", () => realBackgroundUpdateCheckModule)
  mock.module("../../../src/hooks/auto-update-checker/checker", () => realCheckerModule)
  // The logger mock above forwards from birth, so later suites are unaffected.
  mock.restore()
})

describe("createAutoUpdateCheckerHook", () => {
  it("skips startup toasts and checks in CLI run mode", async () => {
    //#given - CLI run mode enabled
    process.env.OPENCODE_CLI_RUN_MODE = "true"
    mockShowConfigErrorsIfAny.mockClear()
    mockShowModelCacheWarningIfNeeded.mockClear()
    mockUpdateAndShowConnectedProvidersCacheStatus.mockClear()
    mockShowLocalDevToast.mockClear()
    mockShowVersionToast.mockClear()
    mockRunBackgroundUpdateCheck.mockClear()

    const hook = createAutoUpdateCheckerHook(
      {
        directory: "/test",
        client: {} as never,
      } as never,
      { showStartupToast: true, isMorpheusEnabled: true, autoUpdate: true }
    )

    //#when - session.created event arrives
    hook.event({
      event: {
        type: "session.created",
        properties: { info: { parentID: undefined } },
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 25))

    //#then - no update checker side effects run
    expect(mockShowConfigErrorsIfAny).not.toHaveBeenCalled()
    expect(mockShowModelCacheWarningIfNeeded).not.toHaveBeenCalled()
    expect(mockUpdateAndShowConnectedProvidersCacheStatus).not.toHaveBeenCalled()
    expect(mockShowLocalDevToast).not.toHaveBeenCalled()
    expect(mockShowVersionToast).not.toHaveBeenCalled()
    expect(mockRunBackgroundUpdateCheck).not.toHaveBeenCalled()

    delete process.env.OPENCODE_CLI_RUN_MODE
  })
  it("surfaces the MCP startup notice on session.created when uvx is missing", async () => {
    //#given - uvx-missing failure in startup state with a captured notify sink
    const { _resetMcpStartupFailuresForTesting, setMcpStartupFailures } = await import(
      "../../../src/mcps/mcp-startup-state"
    )
    const { resetNotifySink, setNotifySink } = await import("../../../src/shared/notify")
    const seen: Array<{ level: string; message: string }> = []
    setNotifySink((level, message) => {
      seen.push({ level, message: String(message) })
    })
    setMcpStartupFailures([
      {
        name: "document_reader",
        error:
          "uvx (uv package manager) not found in PATH. Install with: curl -LsSf https://astral.sh/uv/install.sh | sh",
      },
    ])
    const hook = createAutoUpdateCheckerHook(
      {
        directory: "/test",
        client: {} as never,
      } as never,
      { showStartupToast: true, isMorpheusEnabled: false, autoUpdate: false }
    )

    try {
      //#when - session.created event arrives
      hook.event({
        type: "session.created",
        data: { info: { parentID: undefined } },
      } as never)
      await new Promise((resolve) => setTimeout(resolve, 25))

      //#then - notify sink received the uvx warning with the install fix
      const mcpNotices = seen.filter((entry) => entry.message.includes("mcp-startup"))
      expect(mcpNotices).toHaveLength(1)
      expect(mcpNotices[0]?.level).toBe("warn")
      expect(mcpNotices[0]?.message ?? "").toContain("uvx")
      expect(mcpNotices[0]?.message ?? "").toContain("astral.sh/uv/install.sh")
    } finally {
      _resetMcpStartupFailuresForTesting()
      resetNotifySink()
    }
  })
})
