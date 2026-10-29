import { existsSync, statSync } from "node:fs"
import { join } from "node:path"

export const MATRIX_STATE_DIR = ".matrixx"

export type StateRootCandidates = {
  readonly canonical?: unknown
  readonly pluginDirectory?: unknown
  readonly contextDirectory?: unknown
  readonly cwd?: string
}

function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed === "" ? undefined : trimmed
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function hasState(directory: string): boolean {
  return isDirectory(join(directory, MATRIX_STATE_DIR))
}

/**
 * A linked git worktree carries `.git` as a file pointing at the main checkout,
 * while the main checkout carries `.git` as a directory. State under a linked
 * worktree is per-session and disposable, so it must never be adopted as the
 * project's state root.
 */
export function isLinkedWorktree(directory: string): boolean {
  try {
    return statSync(join(directory, ".git")).isFile()
  } catch {
    return false
  }
}

/**
 * Resolves the directory that owns `.matrixx` state.
 *
 * The canonical project root is authoritative and is invariant across
 * `session_move`, which mutates only the live session directory. A directory
 * that already holds `.matrixx` is adopted only as a legacy migration path,
 * and never when it is a linked worktree.
 */
export function resolveStateRoot(candidates: StateRootCandidates): string {
  const canonical = nonEmpty(candidates.canonical)
  const pluginDirectory = nonEmpty(candidates.pluginDirectory)
  const contextDirectory = nonEmpty(candidates.contextDirectory)
  const cwd = nonEmpty(candidates.cwd) ?? process.cwd()

  if (canonical && isDirectory(canonical)) {
    if (hasState(canonical)) return canonical
    for (const legacy of [pluginDirectory, contextDirectory]) {
      if (!legacy || legacy === canonical) continue
      if (isLinkedWorktree(legacy)) continue
      if (hasState(legacy)) return legacy
    }
    return canonical
  }

  for (const candidate of [pluginDirectory, contextDirectory]) {
    if (candidate && isDirectory(candidate) && hasState(candidate)) return candidate
  }

  return pluginDirectory ?? contextDirectory ?? cwd
}

export function stateRootFromToolContext(context: unknown, ctx: unknown): string {
  const pluginRecord = asRecord(ctx)
  const contextRecord = asRecord(context)
  return resolveStateRoot({
    canonical: pluginRecord?.worktree,
    pluginDirectory: pluginRecord?.directory,
    contextDirectory: contextRecord?.directory,
    cwd: process.cwd(),
  })
}

export function stateRootFromPluginContext(ctx: unknown): string {
  const record = asRecord(ctx)
  return resolveStateRoot({
    canonical: record?.worktree,
    pluginDirectory: record?.directory,
    cwd: process.cwd(),
  })
}

export function stateExists(directory: string): boolean {
  return existsSync(join(directory, MATRIX_STATE_DIR))
}
