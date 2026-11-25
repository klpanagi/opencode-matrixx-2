import { describe, expect, test } from "bun:test";
import {
  createSessionCacheStore,
  MAX_SESSION_CACHES,
} from "../../../src/hooks/rules-injector/cache";

describe("createSessionCacheStore bounded LRU", () => {
  test("retains a cached session and returns the same object", () => {
    //#given a store with one cached session
    const store = createSessionCacheStore();
    const first = store.getSessionCache("session-a");

    //#when reading the same session again
    const second = store.getSessionCache("session-a");

    //#then the load is memoised and the identical object is returned
    expect(second).toBe(first);
  });

  test("does not evict entries while at the cap", () => {
    //#given a store holding exactly MAX_SESSION_CACHES entries
    const store = createSessionCacheStore();
    const oldest = store.getSessionCache("session-0");
    for (let i = 1; i < MAX_SESSION_CACHES; i++) {
      store.getSessionCache(`session-${i}`);
    }

    //#when the oldest entry is read at exactly the cap
    const reloaded = store.getSessionCache("session-0");

    //#then it was never evicted (same cached object)
    expect(reloaded).toBe(oldest);
  });

  test("caps at MAX_SESSION_CACHES and evicts oldest-first when inserting 5000 sessions", () => {
    //#given a store with the two oldest sessions captured
    const store = createSessionCacheStore();
    const first = store.getSessionCache("session-0");
    const second = store.getSessionCache("session-1");

    //#when inserting 5000 sessions in total
    for (let i = 2; i < 5000; i++) {
      store.getSessionCache(`session-${i}`);
    }

    //#then the earliest entries were evicted and reload as fresh objects
    expect(store.getSessionCache("session-0")).not.toBe(first);
    expect(store.getSessionCache("session-1")).not.toBe(second);

    //#and the most recently inserted session is still cached
    const recent = store.getSessionCache("session-4999");
    expect(store.getSessionCache("session-4999")).toBe(recent);
  });
});
