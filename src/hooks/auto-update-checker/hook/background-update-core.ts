import * as fs from "node:fs"
import type { MatrixxContext } from "../../../plugin/tool/context"
import { getOpenCodeConfigPaths } from "../../../shared"
import { log } from "../../../shared/runtime/logger"
import { invalidatePackage } from "../cache"
import { findPluginEntry, getCachedVersion, getLatestVersion, revertPinnedVersion } from "../checker"
import { stripJsonComments } from "../checker/jsonc-strip"
import { PACKAGE_NAME } from "../constants"
import { assertIntegrity, fetchRegistryDist, redactIntegrity } from "../integrity"
import type { OpencodeConfig } from "../types"
import { extractChannel } from "../version-channel"
import { showAutoUpdatedToast, showUpdateAvailableToast } from "./update-toasts"

const BUN_INSTALL_TIMEOUT_SECONDS = 60
const BUN_INSTALL_TIMEOUT_MS = BUN_INSTALL_TIMEOUT_SECONDS * 1000

interface SecurityAutoUpdateSection {
  auto_install?: boolean
}
interface SecuritySection {
  auto_update?: SecurityAutoUpdateSection
}

export interface BunSpawnProc {
  exited: Promise<number>
  kill(): void
}
export type BunSpawnFn = (cmd: string[], options: { cwd: string; stdout: "inherit"; stderr: "inherit" }) => BunSpawnProc

export interface BackgroundUpdateCheckDeps {
  findPluginEntry?: typeof findPluginEntry
  getCachedVersion?: typeof getCachedVersion
  getLatestVersion?: typeof getLatestVersion
  extractChannel?: typeof extractChannel
  invalidatePackage?: typeof invalidatePackage
  showUpdateAvailableToast?: typeof showUpdateAvailableToast
  showAutoUpdatedToast?: typeof showAutoUpdatedToast
  revertPinnedVersion?: typeof revertPinnedVersion
  fetchRegistryDist?: typeof fetchRegistryDist
  spawn?: BunSpawnFn
}

function resolveDeps(deps: BackgroundUpdateCheckDeps) {
  return {
    findPluginEntry: deps.findPluginEntry ?? findPluginEntry,
    getCachedVersion: deps.getCachedVersion ?? getCachedVersion,
    getLatestVersion: deps.getLatestVersion ?? getLatestVersion,
    extractChannel: deps.extractChannel ?? extractChannel,
    invalidatePackage: deps.invalidatePackage ?? invalidatePackage,
    showUpdateAvailableToast: deps.showUpdateAvailableToast ?? showUpdateAvailableToast,
    showAutoUpdatedToast: deps.showAutoUpdatedToast ?? showAutoUpdatedToast,
    revertPinnedVersion: deps.revertPinnedVersion ?? revertPinnedVersion,
    fetchRegistryDist: deps.fetchRegistryDist ?? fetchRegistryDist,
    spawn: deps.spawn ?? Bun.spawn,
  }
}

function readAutoInstallEnabled(): boolean {
  const configPaths = getOpenCodeConfigPaths({ binary: "opencode", version: null })
  for (const configPath of [configPaths.configJson, configPaths.configJsonc]) {
    try {
      if (!fs.existsSync(configPath)) continue
      const content = fs.readFileSync(configPath, "utf-8")
      const config = JSON.parse(stripJsonComments(content)) as OpencodeConfig
      const security = config.security as SecuritySection | undefined
      return security?.auto_update?.auto_install === true
    } catch {
      // Malformed or unreadable config: treat as default (disabled), try next path
    }
  }
  return false
}

async function runBunInstallSafe(exactVersion: string, spawn: BunSpawnFn): Promise<boolean> {
  try {
    const configPaths = getOpenCodeConfigPaths({ binary: "opencode", version: null })
    const proc = spawn(["bun", "add", `${PACKAGE_NAME}@${exactVersion}`, "--ignore-scripts"], {
      cwd: configPaths.configDir,
      stdout: "inherit",
      stderr: "inherit",
    })

    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<boolean>((resolve) => {
      timeoutId = setTimeout(() => resolve(false), BUN_INSTALL_TIMEOUT_MS)
    })
    const exitPromise = proc.exited.then(() => true)
    const result = await Promise.race([exitPromise, timeoutPromise])
    clearTimeout(timeoutId)

    if (!result) {
      try {
        proc.kill()
      } catch {
        /* best-effort terminate: an already-exited process cannot be killed again */
      }
    }

    return result
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    log("[auto-update-checker] bun install error:", errorMessage)
    return false
  }
}

export async function runBackgroundUpdateCheck(
  ctx: MatrixxContext,
  autoUpdate: boolean,
  getToastMessage: (isUpdate: boolean, latestVersion?: string) => string,
  deps: BackgroundUpdateCheckDeps = {}
): Promise<void> {
  const d = resolveDeps(deps)

  const pluginInfo = d.findPluginEntry(ctx.directory)
  if (!pluginInfo) {
    log("[auto-update-checker] Plugin not found in config")
    return
  }

  const cachedVersion = d.getCachedVersion()
  const currentVersion = cachedVersion ?? pluginInfo.pinnedVersion
  if (!currentVersion) {
    log("[auto-update-checker] No version found (cached or pinned)")
    return
  }

  const channel = d.extractChannel(pluginInfo.pinnedVersion ?? currentVersion)
  const latestVersion = await d.getLatestVersion(channel)
  if (!latestVersion) {
    log("[auto-update-checker] Failed to fetch latest version for channel:", channel)
    return
  }

  if (currentVersion === latestVersion) {
    log("[auto-update-checker] Already on latest version for channel:", channel)
    return
  }

  log(`[auto-update-checker] Update available (${channel}): ${currentVersion} → ${latestVersion}`)

  if (!autoUpdate || !readAutoInstallEnabled()) {
    await d.showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
    log("[auto-update-checker] Auto-install disabled (security.auto_update.auto_install), notification only")
    return
  }

  if (pluginInfo.isPinned) {
    await d.showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
    log(`[auto-update-checker] User-pinned version detected (${pluginInfo.entry}), skipping auto-update. Notification only.`)
    return
  }

  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(latestVersion)) {
    log("[auto-update-checker] Refusing to install non-exact version:", latestVersion)
    await d.showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
    return
  }

  const meta = await d.fetchRegistryDist(PACKAGE_NAME, latestVersion)
  try {
    const integrity = assertIntegrity(meta)
    log(`[auto-update-checker] Registry integrity verified: ${redactIntegrity(integrity)}`)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    log("[auto-update-checker] Aborting install:", errorMessage)
    await d.showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
    return
  }

  d.invalidatePackage(PACKAGE_NAME)

  const installSuccess = await runBunInstallSafe(latestVersion, d.spawn)

  if (installSuccess) {
    await d.showAutoUpdatedToast(ctx, currentVersion, latestVersion)
    log(`[auto-update-checker] Update installed: ${currentVersion} → ${latestVersion}`)
    return
  }

  await d.showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
  log("[auto-update-checker] bun install failed; update not installed (falling back to notification-only)")
}
