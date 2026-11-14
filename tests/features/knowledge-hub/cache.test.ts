import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { KnowledgeConfig } from "../../../src/config/schema/knowledge";
import {
  clearHubCacheForTesting,
  getHubCacheSizeForTesting,
  getHubsCached,
} from "../../../src/features/knowledge-hub/cache";

const tmpRoots: string[] = [];
afterEach(() => {
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop() as string;
    rmSync(dir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  clearHubCacheForTesting();
});

function makeHubRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "kb-cache-"));
  tmpRoots.push(root);
  return root;
}

function configFor(hubPath: string): KnowledgeConfig {
  return {
    hubs: [
      {
        name: "kb",
        path: hubPath,
        index: "_index.md",
        scope: "global",
        mode: "router-only",
        exclude: [],
      },
    ],
  };
}

describe("getHubsCached", () => {
  test("reuses the loaded hubs within the TTL", () => {
    //#given a hub root with no index file
    const root = makeHubRoot();
    const config = configFor(root);
    //#when loading twice within the TTL
    const first = getHubsCached(config, tmpdir(), 5000);
    writeFileSync(path.join(root, "_index.md"), "# index\n");
    const second = getHubsCached(config, tmpdir(), 5000);
    //#then the cached snapshot is returned (index still flagged absent)
    expect(second).toBe(first);
    expect(second[0].indexPresent).toBe(false);
  });

  test("reloads after the TTL elapses", () => {
    //#given a zero TTL
    const root = makeHubRoot();
    const config = configFor(root);
    //#when loading twice
    const first = getHubsCached(config, tmpdir(), 0);
    const second = getHubsCached(config, tmpdir(), 0);
    //#then each call reloads
    expect(second).not.toBe(first);
  });

  test("invalidates when the config key changes", () => {
    //#given two configs describing different hubs
    const rootA = makeHubRoot();
    const rootB = makeHubRoot();
    writeFileSync(path.join(rootA, "_index.md"), "# a\n");
    writeFileSync(path.join(rootB, "_index.md"), "# b\n");
    //#when loading both
    const a = getHubsCached(configFor(rootA), tmpdir(), 5000);
    const b = getHubsCached(configFor(rootB), tmpdir(), 5000);
    //#then each config maps to its own hubs
    expect(a[0].root).toBe(rootA);
    expect(b[0].root).toBe(rootB);
  });

  test("invalidates when the project dir changes", () => {
    //#given a hub path relative to the project dir
    const base = makeHubRoot();
    const other = makeHubRoot();
    const config = configFor("docs/kb");
    //#when loading from two project dirs
    const first = getHubsCached(config, base, 5000);
    const second = getHubsCached(config, other, 5000);
    //#then the keys differ and both entries are retained
    expect(first).not.toBe(second);
    expect(getHubCacheSizeForTesting()).toBe(2);
  });

  test("stays bounded at 16 keys", () => {
    //#given 20 distinct cache keys
    //#when loaded
    for (let i = 0; i < 20; i += 1) {
      getHubsCached({ hubs: [] }, `/tmp/kh-cache-project-${i}`, 5000);
    }
    //#then the oldest entries are evicted
    expect(getHubCacheSizeForTesting()).toBeLessThanOrEqual(16);
  });

  test("clearHubCacheForTesting drops every entry", () => {
    //#given a populated cache
    getHubsCached({ hubs: [] }, "/tmp/kh-cache-clear", 5000);
    expect(getHubCacheSizeForTesting()).toBe(1);
    //#when cleared
    clearHubCacheForTesting();
    //#then it is empty
    expect(getHubCacheSizeForTesting()).toBe(0);
  });
});
