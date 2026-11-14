import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { LoadedHub } from "../../../src/features/knowledge-hub/loader";
import type { MatrixxContext } from "../../../src/plugin/tool/context";
import type { MatrixxToolContext } from "../../../src/shared/tool/define-tool";
import { clearHubWriteApprovals, isHubWriteApproved } from "../../../src/hooks/knowledge-hub-guard/approvals";
import { createKnowledgeHubConfirmTool } from "../../../src/tools/knowledge-hub-confirm/tools";

beforeEach(() => {
  clearHubWriteApprovals();
});

function makeCtx(directory: string): MatrixxContext {
  return { directory, client: {} } as unknown as MatrixxContext;
}

function makeToolContext(sessionID: string, directory: string): MatrixxToolContext {
  return { sessionID, directory } as unknown as MatrixxToolContext;
}

function makeHub(root: string): LoadedHub {
  return {
    name: "kb",
    root,
    indexPath: path.join(root, "_index.md"),
    indexPresent: true,
    pinnedFiles: [],
    scope: "global",
    mode: "router-only",
    exclude: [],
  };
}

function makeHubRoot(): string {
  return mkdtempSync(path.join(tmpdir(), "kb-confirm-hub-"));
}

function makeConfirm(hubRoot: string) {
  return createKnowledgeHubConfirmTool(makeCtx(hubRoot), { getHubs: () => [makeHub(hubRoot)] });
}

describe("createKnowledgeHubConfirmTool", () => {
  test("approves a valid current-session in-hub existing file", async () => {
    //#given a hub with an existing file and the confirm tool
    const hubRoot = makeHubRoot();
    const confirm = makeConfirm(hubRoot);
    const target = path.join(hubRoot, "notes.md");
    writeFileSync(target, "# notes\n");
    //#when the tool executes for the current session
    const receipt = await confirm.execute({ path: target }, makeToolContext("ses-valid", hubRoot));
    //#then the approval is recorded for the exact path and current session
    expect(receipt).toContain("Approved");
    expect(receipt).toContain(target);
    expect(receipt).toContain("ses-valid");
    expect(isHubWriteApproved("ses-valid", target)).toBe(true);
  });

  test("resolves relative paths against ctx.directory", async () => {
    //#given a hub root used as the project dir and an existing relative file
    const hubRoot = makeHubRoot();
    const confirm = makeConfirm(hubRoot);
    writeFileSync(path.join(hubRoot, "notes.md"), "# notes\n");
    //#when the tool executes with a relative path
    const receipt = await confirm.execute({ path: "notes.md" }, makeToolContext("ses-rel", hubRoot));
    //#then the approval covers the resolved absolute path
    const resolved = path.resolve(hubRoot, "notes.md");
    expect(receipt).toContain(resolved);
    expect(isHubWriteApproved("ses-rel", resolved)).toBe(true);
  });

  test("refuses a mismatched explicit sessionID and records no approval", async () => {
    //#given a valid in-hub target and an explicit session that is not the current one
    const hubRoot = makeHubRoot();
    const confirm = makeConfirm(hubRoot);
    const target = path.join(hubRoot, "notes.md");
    writeFileSync(target, "# notes\n");
    //#when the tool executes with a foreign sessionID
    const receipt = await confirm.execute(
      { path: target, sessionID: "ses-foreign" },
      makeToolContext("ses-current", hubRoot),
    );
    //#then the call is refused and no session gains an approval
    expect(receipt).toContain("Refused");
    expect(isHubWriteApproved("ses-current", target)).toBe(false);
    expect(isHubWriteApproved("ses-foreign", target)).toBe(false);
  });

  test("refuses an out-of-hub path and records no approval", async () => {
    //#given a hub and a target outside every hub root
    const hubRoot = makeHubRoot();
    const outsideRoot = mkdtempSync(path.join(tmpdir(), "kb-confirm-outside-"));
    const confirm = makeConfirm(hubRoot);
    const target = path.join(outsideRoot, "notes.md");
    writeFileSync(target, "# notes\n");
    //#when the tool executes for the outside target
    const receipt = await confirm.execute({ path: target }, makeToolContext("ses-outside", hubRoot));
    //#then the call is refused and no approval is recorded
    expect(receipt).toContain("Refused");
    expect(isHubWriteApproved("ses-outside", target)).toBe(false);
  });

  test("refuses a non-existent target inside a hub", async () => {
    //#given a hub and a target path that does not exist yet
    const hubRoot = makeHubRoot();
    const confirm = makeConfirm(hubRoot);
    const target = path.join(hubRoot, "missing.md");
    //#when the tool executes for the missing target
    const receipt = await confirm.execute({ path: target }, makeToolContext("ses-missing", hubRoot));
    //#then the call is refused and no approval is recorded
    expect(receipt).toContain("Refused");
    expect(isHubWriteApproved("ses-missing", target)).toBe(false);
  });

  test("denies a child path after approving its parent (exact path only)", async () => {
    //#given an approval recorded for an in-hub parent directory
    const hubRoot = makeHubRoot();
    const confirm = makeConfirm(hubRoot);
    const child = path.join(hubRoot, "child.md");
    const parentReceipt = await confirm.execute({ path: hubRoot }, makeToolContext("ses-parent", hubRoot));
    //#when a child path under the approved parent is checked
    //#then the parent approval is honoured for itself only
    expect(parentReceipt).toContain("Approved");
    expect(isHubWriteApproved("ses-parent", hubRoot)).toBe(true);
    expect(isHubWriteApproved("ses-parent", child)).toBe(false);
  });

  test("refuses when the hub lookup throws", async () => {
    //#given a hub lookup that fails
    const hubRoot = makeHubRoot();
    const target = path.join(hubRoot, "notes.md");
    writeFileSync(target, "# notes\n");
    const confirm = createKnowledgeHubConfirmTool(makeCtx(hubRoot), {
      getHubs: () => {
        throw new Error("config unavailable");
      },
    });
    //#when the tool executes
    const receipt = await confirm.execute({ path: target }, makeToolContext("ses-broken", hubRoot));
    //#then it fails closed and records no approval
    expect(receipt).toContain("Refused");
    expect(isHubWriteApproved("ses-broken", target)).toBe(false);
  });
});
