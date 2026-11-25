import { clearInjectedRules, loadInjectedRules } from "./storage";

export type SessionInjectedRulesCache = {
  contentHashes: Set<string>;
  realPaths: Set<string>;
};

export const MAX_SESSION_CACHES = 1000;

export function createSessionCacheStore(): {
  getSessionCache: (sessionID: string) => SessionInjectedRulesCache;
  clearSessionCache: (sessionID: string) => void;
} {
  const sessionCaches = new Map<string, SessionInjectedRulesCache>();

  function getSessionCache(sessionID: string): SessionInjectedRulesCache {
    const cached = sessionCaches.get(sessionID);
    if (cached !== undefined) {
      // Bump insertion order: an active session must not be the oldest entry.
      sessionCaches.delete(sessionID);
      sessionCaches.set(sessionID, cached);
      return cached;
    }

    const loaded = loadInjectedRules(sessionID);
    if (sessionCaches.size >= MAX_SESSION_CACHES) {
      const oldest = sessionCaches.keys().next().value;
      if (oldest !== undefined) sessionCaches.delete(oldest);
    }
    sessionCaches.set(sessionID, loaded);
    return loaded;
  }

  function clearSessionCache(sessionID: string): void {
    sessionCaches.delete(sessionID);
    clearInjectedRules(sessionID);
  }

  return { getSessionCache, clearSessionCache };
}
