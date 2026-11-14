import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { analyzeBash } from "../../../src/hooks/knowledge-hub-guard/bash-analysis";

const tmpRoots: string[] = [];
afterEach(() => {
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop() as string;
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeHubRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "kb-bash-"));
  tmpRoots.push(root);
  return root;
}

function analyze(command: string, cwd: string): string[] {
  return analyzeBash(command, cwd, cwd);
}

describe("analyzeBash", () => {
  test("returns no candidates for read-only commands", () => {
    //#given read-only commands
    const hub = makeHubRoot();
    //#when analyzed
    const rmCandidates = analyze(`cat ${path.join(hub, "notes.md")}`, tmpdir());
    const lsCandidates = analyze(`ls -la ${hub}`, tmpdir());
    const echoCandidates = analyze("echo hi", tmpdir());
    const findCandidates = analyze(`find ${hub} -name "*.md"`, tmpdir());
    const gitCandidates = analyze("git status", tmpdir());
    //#then nothing is flagged
    expect(rmCandidates).toEqual([]);
    expect(lsCandidates).toEqual([]);
    expect(echoCandidates).toEqual([]);
    expect(findCandidates).toEqual([]);
    expect(gitCandidates).toEqual([]);
  });

  test("flags rm and skips flags", () => {
    //#given a destructive removal with flags
    const hub = makeHubRoot();
    const target = path.join(hub, "notes.md");
    //#when analyzed
    const candidates = analyze(`rm -rf ${target}`, tmpdir());
    //#then the target is a candidate and the flag is not
    expect(candidates).toContain(target);
    expect(candidates).not.toContain("-rf");
  });

  test("respects quoted separators and spaces", () => {
    //#given a quoted target containing separator characters and a space
    const hub = makeHubRoot();
    const quoted = path.join(hub, "a;b c.md");
    //#when analyzed
    const candidates = analyze(`rm "${quoted}"`, tmpdir());
    //#then the path is kept whole
    expect(candidates).toContain(quoted);
    expect(candidates).not.toContain(path.join(hub, "a"));
  });

  test("splits on &&, ||, ;, | and newlines", () => {
    //#given chained and piped commands
    const hub = makeHubRoot();
    const first = path.join(hub, "first.md");
    const second = path.join(hub, "second.md");
    const command = `rm ${first} && true || echo x; cat /tmp/y | tee ${second}\nrm ${path.join(hub, "third.md")}`;
    //#when analyzed
    const candidates = analyze(command, tmpdir());
    //#then every destructive segment contributes a candidate
    expect(candidates).toContain(first);
    expect(candidates).toContain(second);
    expect(candidates).toContain(path.join(hub, "third.md"));
  });

  test("tracks cd into subsequent segments", () => {
    //#given a cd followed by a relative removal
    const hub = makeHubRoot();
    const base = makeHubRoot();
    //#when analyzed
    const candidates = analyze(`cd ${hub} && rm notes.md`, base);
    //#then the relative path resolves against the tracked cwd
    expect(candidates).toContain(path.join(hub, "notes.md"));
    expect(candidates).toContain(hub);
  });

  test("tracks relative cd and tilde cd", () => {
    //#given relative and tilde cd targets
    const base = makeHubRoot();
    const candidates = analyze("cd sub && rm notes.md", base);
    const tilde = analyze("cd ~ && rm notes.md", base);
    //#then both resolve
    expect(candidates).toContain(path.join(base, "sub", "notes.md"));
    expect(tilde).toContain(path.join(process.env.HOME ?? "", "notes.md"));
  });

  test("expands $VAR and ${VAR} targets", () => {
    //#given an env var pointing at a root
    const hub = makeHubRoot();
    process.env.KH_BASH_TEST_ROOT = hub;
    try {
      //#when analyzed with both forms
      const plain = analyze("rm $KH_BASH_TEST_ROOT/plain.md", tmpdir());
      const braced = analyze("rm ${KH_BASH_TEST_ROOT}/braced.md", tmpdir());
      //#then both resolve to absolute paths
      expect(plain).toContain(path.join(hub, "plain.md"));
      expect(braced).toContain(path.join(hub, "braced.md"));
    } finally {
      delete process.env.KH_BASH_TEST_ROOT;
    }
  });

  test("flags find -delete and git -C", () => {
    //#given find -delete and git -C targeting a hub
    const hub = makeHubRoot();
    //#when analyzed
    const findCandidates = analyze(`find ${hub} -name "*.md" -delete`, tmpdir());
    const gitCandidates = analyze(`git -C ${hub} status`, tmpdir());
    //#then both flag their targets
    expect(findCandidates).toContain(hub);
    expect(gitCandidates).toContain(hub);
  });

  test("flags copy destinations, chmod, touch, truncate, install, ln and dd of=", () => {
    //#given destructive verbs into a hub
    const hub = makeHubRoot();
    const dest = path.join(hub, "dest");
    //#when analyzed
    //#then each verb reports the hub destination
    expect(analyze(`cp /tmp/src ${dest}`, tmpdir())).toContain(dest);
    expect(analyze(`chmod 700 ${dest}`, tmpdir())).toContain(dest);
    expect(analyze(`touch ${dest}`, tmpdir())).toContain(dest);
    expect(analyze(`truncate -s 0 ${dest}`, tmpdir())).toContain(dest);
    expect(analyze(`install -m 644 /tmp/src ${dest}`, tmpdir())).toContain(dest);
    expect(analyze(`ln -s /tmp/src ${dest}`, tmpdir())).toContain(dest);
    expect(analyze(`dd if=/tmp/src of=${dest}`, tmpdir())).toContain(dest);
  });

  test("flags rsync and sed -i targets", () => {
    //#given rsync and in-place sed into a hub
    const hub = makeHubRoot();
    const dest = path.join(hub, "dest");
    //#when analyzed
    //#then both report the hub destination
    expect(analyze(`rsync -a /tmp/src ${dest}`, tmpdir())).toContain(dest);
    expect(analyze(`sed -i 's/a/b/' ${dest}`, tmpdir())).toContain(dest);
  });

  test("flags redirections into a hub", () => {
    //#given echo/printf redirecting into a hub
    const hub = makeHubRoot();
    const truncate = path.join(hub, "log.txt");
    const append = path.join(hub, "append.txt");
    //#when analyzed
    const candidates = analyze(`echo hi > ${truncate} && printf x >> ${append}`, tmpdir());
    //#then both redirect targets are flagged
    expect(candidates).toContain(truncate);
    expect(candidates).toContain(append);
  });

  test("flags interpreter one-liners containing a hub path", () => {
    //#given interpreter one-liners
    const hub = makeHubRoot();
    const target = path.join(hub, "notes.md");
    //#when analyzed
    const candidates = analyze(`bash -c "rm ${target}"`, tmpdir());
    const nodeCandidates = analyze(`node -e "require('fs').unlinkSync('${target}')"`, tmpdir());
    //#then the inner target is reported
    expect(candidates).toContain(target);
    expect(nodeCandidates).toContain(target);
  });

  test("flags moves in both directions", () => {
    //#given moves into and out of a hub
    const hub = makeHubRoot();
    const inside = path.join(hub, "a.md");
    const outside = path.join(makeHubRoot(), "b.md");
    //#when analyzed
    const into = analyze(`mv ${outside} ${inside}`, tmpdir());
    const out = analyze(`mv ${inside} ${outside}`, tmpdir());
    //#then both mention the hub path
    expect(into).toContain(inside);
    expect(out).toContain(inside);
  });

  test("never throws on malformed input", () => {
    //#given malformed commands
    //#when analyzed
    //#then an array is returned
    expect(Array.isArray(analyze("rm 'unterminated", tmpdir()))).toBe(true);
    expect(analyze("", tmpdir())).toEqual([]);
    expect(analyze("   ", tmpdir())).toEqual([]);
    expect(analyze("rm", tmpdir())).toEqual([path.normalize(tmpdir())]);
    expect(Array.isArray(analyze("rm $KH_DEFINITELY_MISSING_VAR/x", tmpdir()))).toBe(true);
  });
});
