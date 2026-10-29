/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  resolveStateRoot,
  stateRootFromPluginContext,
  stateRootFromToolContext,
} from "../../src/shared/state-root"

function makeDir(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function seedState(dir: string): void {
  mkdirSync(join(dir, ".matrixx", "plans"), { recursive: true })
  writeFileSync(join(dir, ".matrixx", "plans", "seed.md"), "# seed\n", "utf-8")
}

/** A linked git worktree carries `.git` as a FILE, not a directory. */
function seedLinkedWorktree(dir: string): void {
  writeFileSync(join(dir, ".git"), "gitdir: /nowhere/.git/worktrees/x\n", "utf-8")
}

describe("resolveStateRoot", () => {
  const created: string[] = []

  function track(prefix: string): string {
    const dir = makeDir(prefix)
    created.push(dir)
    return dir
  }

  afterEach(() => {
    while (created.length > 0) {
      const dir = created.pop()
      if (dir) rmSync(dir, { recursive: true, force: true })
    }
  })

  //#given a project root that owns .matrixx and a worktree-shaped session directory
  //#when the state root is resolved with the worktree as the live context directory
  //#then the project root wins, so state never follows the session move
  test("returns canonical when canonical owns .matrixx", () => {
    const canonical = track("sr-canonical")
    const worktree = track("sr-worktree")
    seedState(canonical)
    seedLinkedWorktree(worktree)

    const root = resolveStateRoot({
      canonical,
      pluginDirectory: canonical,
      contextDirectory: worktree,
    })

    expect(root).toBe(canonical)
  })

  //#given a canonical root that owns .matrixx
  //#when contextDirectory changes repeatedly (session_move semantics)
  //#then the resolved state root is invariant
  test("is invariant across contextDirectory changes", () => {
    const canonical = track("sr-invariant-canonical")
    seedState(canonical)
    const moved: string[] = []
    for (let i = 0; i < 3; i++) {
      const dir = track(`sr-moved-${i}`)
      seedLinkedWorktree(dir)
      moved.push(dir)
    }

    const roots = moved.map(contextDirectory =>
      resolveStateRoot({ canonical, pluginDirectory: canonical, contextDirectory }),
    )

    expect(new Set(roots).size).toBe(1)
    expect(roots[0]).toBe(canonical)
  })

  //#given a canonical root that has not created .matrixx yet
  //#and a linked worktree that carries a stale .matrixx from an earlier run
  //#when the state root is resolved
  //#then the stale worktree state is NOT adopted
  test("never adopts a linked worktree's stale .matrixx", () => {
    const canonical = track("sr-nostate-canonical")
    const worktree = track("sr-stale-worktree")
    seedLinkedWorktree(worktree)
    seedState(worktree)

    const root = resolveStateRoot({
      canonical,
      pluginDirectory: canonical,
      contextDirectory: worktree,
    })

    expect(root).toBe(canonical)
  })

  //#given a project root with no .matrixx and a plain subdirectory that has one
  //#when the state root is resolved
  //#then the legacy subdirectory state is adopted so existing plans stay reachable
  test("adopts legacy subdirectory state when canonical has none", () => {
    const canonical = track("sr-legacy-canonical")
    const subdir = track("sr-legacy-subdir")
    seedState(subdir)

    const root = resolveStateRoot({
      canonical,
      pluginDirectory: subdir,
      contextDirectory: subdir,
    })

    expect(root).toBe(subdir)
  })

  //#given no canonical root at all (V1 shape or non-git project)
  //#when the state root is resolved
  //#then the plugin directory wins over the live context directory
  test("prefers pluginDirectory over contextDirectory when canonical is absent", () => {
    const pluginDir = track("sr-nocanonical-plugin")
    const contextDir = track("sr-nocanonical-context")

    const root = resolveStateRoot({
      pluginDirectory: pluginDir,
      contextDirectory: contextDir,
    })

    expect(root).toBe(pluginDir)
  })

  //#given only a live context directory
  //#when the state root is resolved
  //#then the context directory is used
  test("falls back to contextDirectory", () => {
    const contextDir = track("sr-only-context")

    const root = resolveStateRoot({ contextDirectory: contextDir })

    expect(root).toBe(contextDir)
  })

  //#given no candidate resolvable to a non-empty string
  //#when the state root is resolved
  //#then the provided cwd is used instead of throwing
  test("falls back to cwd when every candidate is empty", () => {
    const cwd = track("sr-cwd")

    const root = resolveStateRoot({ canonical: "", pluginDirectory: "  ", contextDirectory: undefined, cwd })

    expect(root).toBe(cwd)
  })

  //#given a canonical root that no longer exists on disk
  //#when the state root is resolved
  //#then it degrades to the plugin directory rather than a vanished path
  test("does not return a canonical path that is not a directory", () => {
    const pluginDir = track("sr-missing-canonical-plugin")
    const ghost = join(tmpdir(), `sr-ghost-${Date.now()}`)

    const root = resolveStateRoot({ canonical: ghost, pluginDirectory: pluginDir })

    expect(root).toBe(pluginDir)
  })
})

describe("stateRootFromToolContext", () => {
  const created: string[] = []

  function track(prefix: string): string {
    const dir = makeDir(prefix)
    created.push(dir)
    return dir
  }

  afterEach(() => {
    while (created.length > 0) {
      const dir = created.pop()
      if (dir) rmSync(dir, { recursive: true, force: true })
    }
  })

  //#given a plugin context whose worktree is the project canonical root
  //#and a tool context whose directory has moved into a linked worktree
  //#when the state root is derived from both
  //#then the plugin context's worktree wins
  test("ctx.worktree wins over a moved context.directory", () => {
    const canonical = track("srtc-canonical")
    const worktree = track("srtc-worktree")
    seedState(canonical)
    seedLinkedWorktree(worktree)

    const root = stateRootFromToolContext({ directory: worktree }, { directory: worktree, worktree: canonical })

    expect(root).toBe(canonical)
  })

  //#given a plugin context with no worktree (V1 shape)
  //#when the state root is derived
  //#then the plugin context directory is used
  test("falls back to ctx.directory without a worktree", () => {
    const pluginDir = track("srtc-plugin")
    const contextDir = track("srtc-context")

    const root = stateRootFromToolContext({ directory: contextDir }, { directory: pluginDir })

    expect(root).toBe(pluginDir)
  })

  //#given a plugin context logger field present alongside directory
  //#when the state root is derived
  //#then unrelated fields are ignored
  test("stateRootFromPluginContext reads worktree from an unknown-shaped object", () => {
    const canonical = track("srpc-canonical")
    seedState(canonical)

    const root = stateRootFromPluginContext({ worktree: canonical, directory: "/elsewhere" })

    expect(root).toBe(canonical)
  })
})
