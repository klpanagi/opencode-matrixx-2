import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { MatrixxContext } from "../../../src/plugin/context";
import type { MatrixxToolContext } from "../../../src/tools/shared/define-tool";
import { isHubWriteApproved } from "../../../src/hooks/knowledge-hub-guard/approvals";
import { createKnowledgeHubConfirmTool } from "../../../src/tools/knowledge-hub-confirm/tools";

function makeCtx(directory: string): MatrixxContext {
  return { directory, client: {} } as unknown as MatrixxContext;
}

function makeToolContext(sessionID: string, directory: string): MatrixxToolContext {
  return { sessionID, directory } as unknown as MatrixxToolContext;
}

describe("createKnowledgeHubConfirmTool", () => {
  test("records approval for an absolute path", async () => {
    //#given the confirm tool and an absolute hub path
    const dir = mkdtempSync(path.join(tmpdir(), "kb-confirm-"));
    const confirm = createKnowledgeHubConfirmTool(makeCtx(dir));
    const target = path.join(dir, "notes.md");
    //#when the tool executes with the current session
    const receipt = await confirm.execute({ path: target }, makeToolContext("ses-abs", dir));
    //#then the receipt names the path and the approval is recorded
    expect(receipt).toContain(target);
    expect(receipt).toContain("ses-abs");
    expect(isHubWriteApproved("ses-abs", target)).toBe(true);
  });

  test("resolves relative paths against ctx.directory", async () => {
    //#given the confirm tool rooted at a project dir
    const dir = mkdtempSync(path.join(tmpdir(), "kb-confirm-"));
    const confirm = createKnowledgeHubConfirmTool(makeCtx(dir));
    //#when the tool executes with a relative path
    const receipt = await confirm.execute({ path: "notes.md" }, makeToolContext("ses-rel", dir));
    //#then the approval covers the resolved absolute path
    const resolved = path.resolve(dir, "notes.md");
    expect(receipt).toContain(resolved);
    expect(isHubWriteApproved("ses-rel", resolved)).toBe(true);
  });

  test("explicit sessionID overrides the current session", async () => {
    //#given the confirm tool and an explicit session arg
    const dir = mkdtempSync(path.join(tmpdir(), "kb-confirm-"));
    const confirm = createKnowledgeHubConfirmTool(makeCtx(dir));
    const target = path.join(dir, "notes.md");
    //#when the tool executes with a sessionID arg
    await confirm.execute({ path: target, sessionID: "ses-explicit" }, makeToolContext("ses-current", dir));
    //#then the approval lands on the explicit session only
    expect(isHubWriteApproved("ses-explicit", target)).toBe(true);
    expect(isHubWriteApproved("ses-current", target)).toBe(false);
  });
});
