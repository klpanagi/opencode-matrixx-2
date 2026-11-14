import type { KnowledgeConfig } from "../../config/schema/knowledge"
import { type LoadedHub, loadKnowledgeHubs } from "./loader"

const DEFAULT_TTL_MS = 5000
const MAX_ENTRIES = 16
const KEY_SEPARATOR = "\u0000"

interface CacheEntry {
  hubs: LoadedHub[]
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

function cacheKey(config: KnowledgeConfig, projectDir: string): string {
  return JSON.stringify(config) + KEY_SEPARATOR + projectDir
}

function evictSoonestExpiring(): void {
  let soonestKey: string | null = null
  let soonest = Number.POSITIVE_INFINITY
  for (const [key, entry] of cache) {
    if (entry.expiresAt < soonest) {
      soonest = entry.expiresAt
      soonestKey = key
    }
  }
  if (soonestKey !== null) {
    cache.delete(soonestKey)
  }
}

function pruneExpired(now: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) {
      cache.delete(key)
    }
  }
  while (cache.size > MAX_ENTRIES) {
    evictSoonestExpiring()
  }
}

export function getHubsCached(config: KnowledgeConfig, projectDir: string, ttlMs = DEFAULT_TTL_MS): LoadedHub[] {
  const key = cacheKey(config, projectDir)
  const now = Date.now()
  const cached = cache.get(key)
  if (cached !== undefined && cached.expiresAt > now) {
    return cached.hubs
  }
  if (cached !== undefined) {
    cache.delete(key)
  }
  const hubs = loadKnowledgeHubs(config, projectDir)
  cache.set(key, { hubs, expiresAt: now + ttlMs })
  pruneExpired(now)
  return hubs
}

export function clearHubCacheForTesting(): void {
  cache.clear()
}

export function getHubCacheSizeForTesting(): number {
  return cache.size
}
