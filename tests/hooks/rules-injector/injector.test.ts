import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RULES_INJECTOR_STORAGE } from "../../../src/hooks/rules-injector/constants";
import type { DynamicTruncator } from "../../../src/hooks/rules-injector/injector";

type StatSnapshot = { mtimeMs: number; size: number };

// Stateless mock — all tests need it, no mutable shared state.
mock.module("../../../src/hooks/rules-injector/matcher", () => ({
  shouldApplyRule: () => ({ applies: true, reason: "matched" }),
  isDuplicateByRealPath: (realPath: string, cache: Set<string>) =>
    cache.has(realPath),
  createContentHash: (content: string) => `hash:${content}`,
  isDuplicateByContentHash: (hash: string, cache: Set<string>) => cache.has(hash),
}));

afterAll(() => {
  mock.restore()
})

function createOutput(): { title: string; output: string; metadata: unknown } {
  return { title: "tool", output: "", metadata: {} };
}

function createProcessor(
  projectRoot: string,
  createRuleInjectionProcessor: (deps: {
    workspaceDirectory: string;
    truncator: DynamicTruncator;
    getSessionCache: (sessionID: string) => {
      contentHashes: Set<string>;
      realPaths: Set<string>;
    };
  }) => { processFilePathForInjection: (...args: unknown[]) => Promise<void> },
) {
  const sessionCaches = new Map<
    string,
    { contentHashes: Set<string>; realPaths: Set<string> }
  >();

  return createRuleInjectionProcessor({
    workspaceDirectory: projectRoot,
    truncator: {
      truncate: async (_sessionID: string, content: string) => ({
        result: content,
        truncated: false,
      }),
    },
    getSessionCache: (sessionID: string) => {
      if (!sessionCaches.has(sessionID)) {
        sessionCaches.set(sessionID, {
          contentHashes: new Set<string>(),
          realPaths: new Set<string>(),
        });
      }
      const cache = sessionCaches.get(sessionID);
      if (!cache) {
        throw new Error("Session cache should exist");
      }
      return cache;
    },
  });
}

function getInjectedRulesPath(sessionID: string): string {
  return join(RULES_INJECTOR_STORAGE, `${sessionID}.json`);
}

describe("createRuleInjectionProcessor", () => {
  let testRoot: string;
  let projectRoot: string;
  let homeRoot: string;
  let targetFile: string;
  let ruleFile: string;
  let ruleRealPath: string;

  beforeEach(() => {
    testRoot = join(tmpdir(), `rules-injector-injector-${Date.now()}-${randomUUID()}`);
    projectRoot = join(testRoot, "project");
    homeRoot = join(testRoot, "home");
    targetFile = join(projectRoot, "src", "index.ts");
    ruleFile = join(
      projectRoot,
      ".github",
      "instructions",
      "typescript.instructions.md",
    );

    mkdirSync(join(projectRoot, ".git"), { recursive: true });
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    mkdirSync(join(projectRoot, ".github", "instructions"), { recursive: true });
    mkdirSync(homeRoot, { recursive: true });

    writeFileSync(targetFile, "export const value = 1;\n");
    writeFileSync(ruleFile, "rule-content\n");

    ruleRealPath = fs.realpathSync(ruleFile);
  });

  afterEach(() => {
    if (fs.existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("reads and parses same file once when stat is unchanged", async () => {
    const realFs = require("node:fs") as typeof import("node:fs");
    const realOs = require("node:os") as typeof import("node:os");

    const localTrackedRulePath = ruleFile;
    const localStatSnapshots: Array<StatSnapshot | Error> = [
      { mtimeMs: 1000, size: 13 },
      { mtimeMs: 1000, size: 13 },
    ];
    let localTrackedReadFileCount = 0;
    const localMockedHomeDir = homeRoot;

    mock.module("node:fs", () => ({
      ...realFs,
      readFileSync: (filePath: string, encoding?: string) => {
        if (filePath === localTrackedRulePath) {
          localTrackedReadFileCount += 1;
        }
        return realFs.readFileSync(filePath, encoding as never);
      },
      statSync: (filePath: string) => {
        if (filePath === localTrackedRulePath) {
          const next = localStatSnapshots.shift();
          if (next instanceof Error) {
            throw next;
          }
          if (next) {
            return {
              mtimeMs: next.mtimeMs,
              size: next.size,
              isFile: () => true,
            } as ReturnType<typeof realFs.statSync>;
          }
        }
        return realFs.statSync(filePath);
      },
    }));

    mock.module("node:os", () => ({
      ...realOs,
      homedir: () => localMockedHomeDir,
    }));

    const { createRuleInjectionProcessor } = await import(
      `../../../src/hooks/rules-injector/injector?bust=${randomUUID()}`
    );
    const processor = createProcessor(projectRoot, createRuleInjectionProcessor);

    await processor.processFilePathForInjection(targetFile, "session-1", createOutput());
    await processor.processFilePathForInjection(targetFile, "session-2", createOutput());

    expect(localTrackedReadFileCount).toBe(1);
  });

  it("serves a cache hit without statSync or a second read", async () => {
    const realFs = require("node:fs") as typeof import("node:fs");
    const realOs = require("node:os") as typeof import("node:os");

    const localTrackedRulePath = ruleFile;
    let localTrackedReadFileCount = 0;
    let localTrackedStatCount = 0;
    const localMockedHomeDir = homeRoot;

    mock.module("node:fs", () => ({
      ...realFs,
      readFileSync: (filePath: string, encoding?: string) => {
        if (filePath === localTrackedRulePath) {
          localTrackedReadFileCount += 1;
        }
        return realFs.readFileSync(filePath, encoding as never);
      },
      statSync: (filePath: string) => {
        if (filePath === localTrackedRulePath) {
          localTrackedStatCount += 1;
        }
        return realFs.statSync(filePath);
      },
    }));

    mock.module("node:os", () => ({
      ...realOs,
      homedir: () => localMockedHomeDir,
    }));

    const { createRuleInjectionProcessor } = await import(
      `../../../src/hooks/rules-injector/injector?bust=${randomUUID()}`
    );
    const processor = createProcessor(projectRoot, createRuleInjectionProcessor);

    await processor.processFilePathForInjection(targetFile, "session-1", createOutput());
    await processor.processFilePathForInjection(targetFile, "session-2", createOutput());

    // then: the first call reads once, and the cache hit never stats the rule file
    expect(localTrackedReadFileCount).toBe(1);
    expect(localTrackedStatCount).toBe(0);
  });

  it("re-reads after the rule cache is reset", async () => {
    const realFs = require("node:fs") as typeof import("node:fs");
    const realOs = require("node:os") as typeof import("node:os");

    const localTrackedRulePath = ruleFile;
    let localTrackedReadFileCount = 0;
    const localMockedHomeDir = homeRoot;

    mock.module("node:fs", () => ({
      ...realFs,
      readFileSync: (filePath: string, encoding?: string) => {
        if (filePath === localTrackedRulePath) {
          localTrackedReadFileCount += 1;
        }
        return realFs.readFileSync(filePath, encoding as never);
      },
    }));

    mock.module("node:os", () => ({
      ...realOs,
      homedir: () => localMockedHomeDir,
    }));

    const injectorModule = await import(
      `../../../src/hooks/rules-injector/injector?bust=${randomUUID()}`
    );
    const processor = createProcessor(projectRoot, injectorModule.createRuleInjectionProcessor);

    await processor.processFilePathForInjection(targetFile, "session-1", createOutput());
    injectorModule._resetRuleCacheForTesting();
    await processor.processFilePathForInjection(targetFile, "session-2", createOutput());

    // then: clearing the cache (the watcher's invalidation signal in tests) re-reads
    expect(localTrackedReadFileCount).toBe(2);
  });

});
