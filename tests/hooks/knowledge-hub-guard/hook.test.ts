import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { MatrixxContext } from "../../../src/plugin/tool/context";
import type { MatrixxToolContext } from "../../../src/shared/tool/define-tool";
import type { LoadedHub } from "../../../src/features/knowledge-hub/loader";
import { createKnowledgeHubConfirmTool } from "../../../src/tools/knowledge-hub-confirm/tools";
import {
  approveHubWrite,
  clearHubWriteApprovals,
  isHubWriteApproved,
} from "../../../src/hooks/knowledge-hub-guard/approvals";
import {
  clearHubMatcherCacheForTesting,
  createKnowledgeHubGuardHook,
} from "../../../src/hooks/knowledge-hub-guard/hook";
import { clearHubCacheForTesting } from "../../../src/features/knowledge-hub/cache";

const tmpRoots: string[] = [];
afterEach(() => {
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop() as string;
    rmSync(dir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  clearHubWriteApprovals();
  clearHubCacheForTesting();
  clearHubMatcherCacheForTesting();
});

function makeCtx(directory: string): MatrixxContext {
  return { directory, client: {} } as unknown as MatrixxContext;
}

function makeHubRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "kb-guard-"));
  tmpRoots.push(root);
  return root;
}

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

function makeHub(root: string, exclude: string[] = [], indexPresent = true): LoadedHub {
  return {
    name: "kb",
    root,
    indexPath: path.join(root, "_index.md"),
    indexPresent,
    pinnedFiles: [],
    scope: "global",
    mode: "router-only",
    exclude,
  };
}

function writeArgs(filePath: string): { args: Record<string, unknown> } {
  return { args: { filePath } };
}

function bashArgs(command: string): { args: Record<string, unknown> } {
  return { args: { command } };
}

describe("createKnowledgeHubGuardHook", () => {
  test("blocks writes inside the hub root", async () => {
    //#given a hub and a write targeting a file inside it
    const root = makeHubRoot();
    const hook = createKnowledgeHubGuardHook(makeCtx(tmpdir()), { hubs: [makeHub(root)] });
    const target = path.join(root, "notes.md");
    //#when the guard runs before the write
    const blocked = hook["tool.execute.before"](
      { tool: "write", sessionID: "ses-1", callID: "c1" },
      writeArgs(target),
    );
    //#then it throws naming the hub and the read-only rule
    await expect(blocked).rejects.toThrow('knowledge hub "kb"');
  });

  test("allows writes outside all hubs", async () => {
    //#given a hub and a write targeting an unrelated path
    const root = makeHubRoot();
    const outside = makeTempDir("kb-outside-");
    const hook = createKnowledgeHubGuardHook(makeCtx(tmpdir()), { hubs: [makeHub(root)] });
    //#when the guard runs before the write
    await hook["tool.execute.before"](
      { tool: "edit", sessionID: "ses-1", callID: "c1" },
      writeArgs(path.join(outside, "notes.md")),
    );
    //#then it resolves without throwing
  });

  test("allows writes to excluded paths inside the hub", async () => {
    //#given a hub whose exclude list covers scratch files
    const root = makeHubRoot();
    const hook = createKnowledgeHubGuardHook(makeCtx(tmpdir()), {
      hubs: [makeHub(root, ["scratch/**"])],
    });
    //#when the guard runs before a write to an excluded path
    await hook["tool.execute.before"](
      { tool: "write", sessionID: "ses-1", callID: "c1" },
      writeArgs(path.join(root, "scratch", "draft.md")),
    );
    //#then it resolves without throwing
  });

  test("allows writes to an excluded basename pattern", async () => {
    //#given a hub excluding a bare basename pattern
    const root = makeHubRoot();
    const hook = createKnowledgeHubGuardHook(makeCtx(tmpdir()), {
      hubs: [makeHub(root, ["*.log"])],
    });
    //#when the guard runs before a write to a nested .log file
    await hook["tool.execute.before"](
      { tool: "write", sessionID: "ses-1", callID: "c1" },
      writeArgs(path.join(root, "deep", "dir", "run.log")),
    );
    //#then the basename pattern matches
  });

  test("fails open when hub config is unavailable", async () => {
    //#given a guard whose loader throws (missing config)
    const hook = createKnowledgeHubGuardHook(makeCtx(tmpdir()), {
      loadHubs: () => {
        throw new Error("no config");
      },
    });
    //#when the guard runs twice
    await hook["tool.execute.before"](
      { tool: "write", sessionID: "ses-1", callID: "c1" },
      writeArgs("/any/path/notes.md"),
    );
    await hook["tool.execute.before"](
      { tool: "write", sessionID: "ses-1", callID: "c2" },
      writeArgs("/any/path/other.md"),
    );
    //#then both writes are allowed
  });

  test("calls the loader on every invocation", async () => {
    //#given a loader that changes its answer between calls
    let calls = 0;
    const root = makeHubRoot();
    const hook = createKnowledgeHubGuardHook(makeCtx(tmpdir()), {
      loadHubs: () => {
        calls += 1;
        return calls === 1 ? [] : [makeHub(root)];
      },
    });
    const target = path.join(root, "notes.md");
    //#when the first write passes and the second is checked again
    await hook["tool.execute.before"](
      { tool: "write", sessionID: "ses-1", callID: "c1" },
      writeArgs(target),
    );
    const blocked = hook["tool.execute.before"](
      { tool: "write", sessionID: "ses-1", callID: "c2" },
      writeArgs(target),
    );
    //#then the refreshed hubs are applied (no forever cache)
    await expect(blocked).rejects.toThrow('knowledge hub "kb"');
    expect(calls).toBe(2);
  });

  test("blocks destructive bash targeting hub paths, allows reads", async () => {
    //#given a hub and bash commands touching it
    const root = makeHubRoot();
    const hook = createKnowledgeHubGuardHook(makeCtx(tmpdir()), { hubs: [makeHub(root)] });
    const target = path.join(root, "notes.md");
    //#when rm targets the hub file
    const blocked = hook["tool.execute.before"](
      { tool: "bash", sessionID: "ses-1", callID: "c1" },
      bashArgs(`rm ${target}`),
    );
    //#then it throws
    await expect(blocked).rejects.toThrow('knowledge hub "kb"');
    //#when cat reads the same file
    await hook["tool.execute.before"](
      { tool: "bash", sessionID: "ses-1", callID: "c2" },
      bashArgs(`cat ${target}`),
    );
    //#then the read is allowed
  });

  test("guards a hub without an index", async () => {
    //#given a loaded hub flagged indexPresent: false
    const root = makeHubRoot();
    const hook = createKnowledgeHubGuardHook(makeCtx(tmpdir()), {
      hubs: [makeHub(root, [], false)],
    });
    //#when a write targets the hub
    const blocked = hook["tool.execute.before"](
      { tool: "write", sessionID: "ses-1", callID: "c1" },
      writeArgs(path.join(root, "notes.md")),
    );
    //#then the root alone still protects it
    await expect(blocked).rejects.toThrow('knowledge hub "kb"');
  });
});

describe("knowledge-hub-guard tool coverage", () => {
  test("blocks ast_grep_replace with a hub path string", async () => {
    //#given an ast-grep replace targeting the hub
    const root = makeHubRoot();
    const hook = createKnowledgeHubGuardHook(makeCtx(tmpdir()), { hubs: [makeHub(root)] });
    //#when the paths arg is a hub path
    const blocked = hook["tool.execute.before"](
      { tool: "ast_grep_replace", sessionID: "ses-1", callID: "c1" },
      { args: { pattern: "a", rewrite: "b", paths: root } },
    );
    //#then it throws
    await expect(blocked).rejects.toThrow('knowledge hub "kb"');
  });

  test("blocks ast_grep_replace with a hub path in an array", async () => {
    //#given an ast-grep replace with an array of paths
    const root = makeHubRoot();
    const outside = makeTempDir("kb-outside-");
    const hook = createKnowledgeHubGuardHook(makeCtx(tmpdir()), { hubs: [makeHub(root)] });
    //#when one path lands in the hub
    const blocked = hook["tool.execute.before"](
      { tool: "ast_grep_replace", sessionID: "ses-1", callID: "c1" },
      { args: { pattern: "a", rewrite: "b", paths: [outside, path.join(root, "src")] } },
    );
    //#then it throws
    await expect(blocked).rejects.toThrow('knowledge hub "kb"');
  });

  test("allows ast_grep_replace outside the hub and with absent paths", async () => {
    //#given an ast-grep replace outside every hub
    const root = makeHubRoot();
    const outside = makeTempDir("kb-outside-");
    const hook = createKnowledgeHubGuardHook(makeCtx(tmpdir()), { hubs: [makeHub(root)] });
    //#when paths are outside or absent
    await hook["tool.execute.before"](
      { tool: "ast_grep_replace", sessionID: "ses-1", callID: "c1" },
      { args: { pattern: "a", rewrite: "b", paths: [outside] } },
    );
    await hook["tool.execute.before"](
      { tool: "ast_grep_replace", sessionID: "ses-1", callID: "c2" },
      { args: { pattern: "a", rewrite: "b" } },
    );
    //#then both resolve
  });

  test("blocks lsp_rename on a hub file", async () => {
    //#given an lsp rename targeting the hub
    const root = makeHubRoot();
    const hook = createKnowledgeHubGuardHook(makeCtx(tmpdir()), { hubs: [makeHub(root)] });
    //#when the file path is inside
    const blocked = hook["tool.execute.before"](
      { tool: "lsp_rename", sessionID: "ses-1", callID: "c1" },
      { args: { filePath: path.join(root, "a.ts"), line: 1, character: 1, newName: "b" } },
    );
    //#then it throws
    await expect(blocked).rejects.toThrow('knowledge hub "kb"');
  });

  test("allows lsp_rename outside the hub", async () => {
    //#given an lsp rename outside every hub
    const root = makeHubRoot();
    const outside = makeTempDir("kb-outside-");
    const hook = createKnowledgeHubGuardHook(makeCtx(tmpdir()), { hubs: [makeHub(root)] });
    //#when the file path is outside
    await hook["tool.execute.before"](
      { tool: "lsp_rename", sessionID: "ses-1", callID: "c1" },
      { args: { filePath: path.join(outside, "a.ts"), line: 1, character: 1, newName: "b" } },
    );
    //#then it resolves
  });

  test("blocks an edit rename destination inside the hub", async () => {
    //#given an edit whose source is outside but whose rename destination is inside
    const root = makeHubRoot();
    const outside = makeTempDir("kb-outside-");
    const hook = createKnowledgeHubGuardHook(makeCtx(tmpdir()), { hubs: [makeHub(root)] });
    //#when the rename arg points at the hub
    const blocked = hook["tool.execute.before"](
      { tool: "edit", sessionID: "ses-1", callID: "c1" },
      {
        args: { filePath: path.join(outside, "notes.md"), rename: path.join(root, "notes.md") },
      },
    );
    //#then it throws
    await expect(blocked).rejects.toThrow('knowledge hub "kb"');
  });

  test("blocks an edit rename source inside the hub", async () => {
    //#given an edit whose source is inside and whose rename destination is outside
    const root = makeHubRoot();
    const outside = makeTempDir("kb-outside-");
    const hook = createKnowledgeHubGuardHook(makeCtx(tmpdir()), { hubs: [makeHub(root)] });
    //#when the file path points at the hub
    const blocked = hook["tool.execute.before"](
      { tool: "edit", sessionID: "ses-1", callID: "c1" },
      {
        args: { filePath: path.join(root, "notes.md"), rename: path.join(outside, "notes.md") },
      },
    );
    //#then it throws
    await expect(blocked).rejects.toThrow('knowledge hub "kb"');
  });

  test("allows read and search tools inside the hub", async () => {
    //#given read/search tools aimed at the hub
    const root = makeHubRoot();
    const hook = createKnowledgeHubGuardHook(makeCtx(tmpdir()), { hubs: [makeHub(root)] });
    const target = path.join(root, "notes.md");
    const tools = [
      "read",
      "grep",
      "glob",
      "websearch",
      "webfetch",
      "ast_grep_search",
      "lsp_goto_definition",
      "lsp_find_references",
      "lsp_diagnostics",
      "lsp_symbols",
      "lsp_prepare_rename",
    ];
    //#when each runs against a hub path
    for (const tool of tools) {
      await hook["tool.execute.before"](
        { tool, sessionID: "ses-1", callID: tool },
        { args: { filePath: target, path: target, pattern: target } },
      );
    }
    //#then none of them throw
  });
});

describe("knowledge-hub-guard bash bypass matrix", () => {
  const cases: Array<[string, (root: string) => string]> = [
    ["cd-then-rm", (root) => `cd ${root} && rm notes.md`],
    ["variable target", (root) => "rm $KH_GUARD_TEST_ROOT/notes.md"],
    ["find -delete", (root) => `find ${root} -name "*.md" -delete`],
    ["git -C", (root) => `git -C ${root} status`],
    ["cp destination", (root) => `cp /tmp/src ${root}/notes.md`],
    ["chmod", (root) => `chmod 700 ${root}/notes.md`],
    ["touch", (root) => `touch ${root}/notes.md`],
    ["truncate", (root) => `truncate -s 0 ${root}/notes.md`],
    ["install", (root) => `install -m 644 /tmp/src ${root}/notes.md`],
    ["ln", (root) => `ln -s /tmp/src ${root}/notes.md`],
    ["rsync destination", (root) => `rsync -a /tmp/src ${root}/dest`],
    ["dd of=", (root) => `dd if=/tmp/src of=${root}/notes.md`],
    ["sed -i", (root) => `sed -i 's/a/b/' ${root}/notes.md`],
    ["redirection", (root) => `echo hi > ${root}/log.txt`],
    ["append redirection", (root) => `printf x >> ${root}/log.txt`],
    ["move from hub", (root) => `mv ${root}/notes.md /tmp/moved.md`],
    ["bash -c", (root) => `bash -c "rm ${root}/notes.md"`],
    ["node -e", (root) => `node -e "require('fs').unlinkSync('${root}/notes.md')"`],
  ];

  for (const [name, build] of cases) {
    test(`denies ${name}`, async () => {
      //#given a hub and a destructive command variant
      const root = makeHubRoot();
      process.env.KH_GUARD_TEST_ROOT = root;
      try {
        const hook = createKnowledgeHubGuardHook(makeCtx(tmpdir()), { hubs: [makeHub(root)] });
        //#when the command is checked
        const blocked = hook["tool.execute.before"](
          { tool: "bash", sessionID: `ses-${name}`, callID: "c1" },
          bashArgs(build(root)),
        );
        //#then it throws the best-effort deny
        await expect(blocked).rejects.toThrow('knowledge hub "kb"');
      } finally {
        delete process.env.KH_GUARD_TEST_ROOT;
      }
    });
  }

  test("allows unrelated shell work outside hubs", async () => {
    //#given a hub and ordinary shell work elsewhere
    const root = makeHubRoot();
    const outside = makeTempDir("kb-bash-outside-");
    const hook = createKnowledgeHubGuardHook(makeCtx(tmpdir()), { hubs: [makeHub(root)] });
    //#when echoing into a temp file and copying unrelated files
    await hook["tool.execute.before"](
      { tool: "bash", sessionID: "ses-1", callID: "c1" },
      bashArgs(`echo hi > ${path.join(outside, "x.txt")}`),
    );
    await hook["tool.execute.before"](
      { tool: "bash", sessionID: "ses-1", callID: "c2" },
      bashArgs("cp a b"),
    );
    //#then neither throws
  });
});

describe("knowledge-hub-guard shell alias (V2)", () => {
  test("blocks destructive shell targeting hub paths like bash", async () => {
    //#given a hub and a shell rm touching it
    const root = makeHubRoot();
    const hook = createKnowledgeHubGuardHook(makeCtx(tmpdir()), { hubs: [makeHub(root)] });
    const target = path.join(root, "notes.md");
    //#when shell removes the hub file
    const blocked = hook["tool.execute.before"](
      { tool: "shell", sessionID: "ses-1", callID: "c1" },
      bashArgs(`rm ${target}`),
    );
    //#then it throws
    await expect(blocked).rejects.toThrow('knowledge hub "kb"');
  });
});

describe("hub write approvals", () => {
  test("approval allows the exact path", async () => {
    //#given a hub, a blocked target, and a recorded approval
    const root = makeHubRoot();
    const hook = createKnowledgeHubGuardHook(makeCtx(tmpdir()), { hubs: [makeHub(root)] });
    const target = path.join(root, "notes.md");
    approveHubWrite("ses-exact", target);
    //#when the guard runs before the write
    await hook["tool.execute.before"](
      { tool: "write", sessionID: "ses-exact", callID: "c1" },
      writeArgs(target),
    );
    //#then it resolves without throwing
  });

  test("parent-dir approval allows a child path", async () => {
    //#given an approval recorded for the hub root
    const root = makeHubRoot();
    const hook = createKnowledgeHubGuardHook(makeCtx(tmpdir()), { hubs: [makeHub(root)] });
    approveHubWrite("ses-parent", root);
    //#when the guard runs before a write to a nested file
    await hook["tool.execute.before"](
      { tool: "edit", sessionID: "ses-parent", callID: "c1" },
      writeArgs(path.join(root, "sub", "notes.md")),
    );
    //#then it resolves without throwing
  });

  test("approval matches non-normalized equivalents", async () => {
    //#given an approval recorded with dot segments in the path
    const root = makeHubRoot();
    const hook = createKnowledgeHubGuardHook(makeCtx(tmpdir()), { hubs: [makeHub(root)] });
    approveHubWrite("ses-norm", path.join(root, "sub", "..", "notes.md"));
    //#when the guard runs before a write to the normalized path
    await hook["tool.execute.before"](
      { tool: "write", sessionID: "ses-norm", callID: "c1" },
      writeArgs(path.join(root, "notes.md")),
    );
    //#then it resolves without throwing
  });

  test("expired approval still denies", async () => {
    //#given an approval whose TTL already elapsed
    const root = makeHubRoot();
    const hook = createKnowledgeHubGuardHook(makeCtx(tmpdir()), { hubs: [makeHub(root)] });
    const target = path.join(root, "notes.md");
    approveHubWrite("ses-expired", target, -1000);
    //#when the guard runs before the write
    const blocked = hook["tool.execute.before"](
      { tool: "write", sessionID: "ses-expired", callID: "c1" },
      writeArgs(target),
    );
    //#then it throws naming the hub and the confirm flow
    await expect(blocked).rejects.toThrow('knowledge hub "kb"');
    await expect(blocked).rejects.toThrow("knowledge_hub_confirm");
  });

  test("approval from another session denies", async () => {
    //#given an approval recorded for a different session
    const root = makeHubRoot();
    const hook = createKnowledgeHubGuardHook(makeCtx(tmpdir()), { hubs: [makeHub(root)] });
    const target = path.join(root, "notes.md");
    approveHubWrite("ses-other", target);
    //#when the guard runs before a write in this session
    const blocked = hook["tool.execute.before"](
      { tool: "write", sessionID: "ses-mine", callID: "c1" },
      writeArgs(target),
    );
    //#then it throws
    await expect(blocked).rejects.toThrow('knowledge hub "kb"');
  });

  test("deny message instructs the confirm flow", async () => {
    //#given a hub and a write with no approval
    const root = makeHubRoot();
    const hook = createKnowledgeHubGuardHook(makeCtx(tmpdir()), { hubs: [makeHub(root)] });
    const target = path.join(root, "notes.md");
    //#when the guard denies the write
    const blocked = hook["tool.execute.before"](
      { tool: "write", sessionID: "ses-no-approval", callID: "c1" },
      writeArgs(target),
    );
    //#then the error names the hub, the path, and both confirm steps
    await expect(blocked).rejects.toThrow('knowledge hub "kb"');
    await expect(blocked).rejects.toThrow(target);
    await expect(blocked).rejects.toThrow("question tool");
    await expect(blocked).rejects.toThrow("knowledge_hub_confirm");
  });

  test("approval allows destructive bash targeting hub paths", async () => {
    //#given an approval covering the hub file
    const root = makeHubRoot();
    const hook = createKnowledgeHubGuardHook(makeCtx(tmpdir()), { hubs: [makeHub(root)] });
    const target = path.join(root, "notes.md");
    approveHubWrite("ses-bash", target);
    //#when bash removes the approved file
    await hook["tool.execute.before"](
      { tool: "bash", sessionID: "ses-bash", callID: "c1" },
      bashArgs(`rm ${target}`),
    );
    //#then it resolves without throwing
  });

  test("caps retained sessions at 128", () => {
    //#given more approved sessions than the cap
    const root = makeHubRoot();
    for (let i = 0; i < 130; i += 1) {
      approveHubWrite(`ses-cap-${i}`, path.join(root, `p${i}.md`));
    }
    //#when checking the earliest and latest sessions
    //#then the earliest are evicted and the latest survive
    expect(isHubWriteApproved("ses-cap-0", path.join(root, "p0.md"))).toBe(false);
    expect(isHubWriteApproved("ses-cap-129", path.join(root, "p129.md"))).toBe(true);
  });

  test("caps retained paths per session at 256", () => {
    //#given more approved paths than the per-session cap
    const root = makeHubRoot();
    for (let i = 0; i < 260; i += 1) {
      approveHubWrite("ses-cap-paths", path.join(root, `p${i}.md`));
    }
    //#when checking the earliest and latest paths
    //#then the earliest are evicted and the latest survive
    expect(isHubWriteApproved("ses-cap-paths", path.join(root, "p0.md"))).toBe(false);
    expect(isHubWriteApproved("ses-cap-paths", path.join(root, "p259.md"))).toBe(true);
  });

  test("confirm tool records approval end-to-end with guard", async () => {
    //#given a guard blocking a hub file and the confirm tool
    const root = makeHubRoot();
    const hook = createKnowledgeHubGuardHook(makeCtx(tmpdir()), { hubs: [makeHub(root)] });
    const target = path.join(root, "notes.md");
    const confirm = createKnowledgeHubConfirmTool(makeCtx(tmpdir()));
    const context = { sessionID: "ses-e2e", directory: tmpdir() } as unknown as MatrixxToolContext;
    //#when the user-approved path is confirmed
    const receipt = await confirm.execute({ path: target }, context);
    //#then the receipt names the path and the retry succeeds
    expect(receipt).toContain(target);
    expect(receipt).toContain("ses-e2e");
    await hook["tool.execute.before"](
      { tool: "write", sessionID: "ses-e2e", callID: "c1" },
      writeArgs(target),
    );
  });
});
