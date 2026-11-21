# comment-scan parity fixtures (T1)

Phase labels T1–T12 refer to the completed consolidation plan; the function names below reflect what shipped.

Captured from the **old external binary** (hereafter `OLD_BINARY`; the OLD package was
`@code-yeongyu/comment-checker` 0.6.1, Rust, 41.9 MB) before it was removed. Nothing here is
produced by the new renderer: a baseline produced by the new code would make the parity tests
tautological.

Binary sha256: `44ef2b13b68bf795848f957a435302a6a1152f65cdd74dc568fd3cce63310c09` (prefix `44ef2b13`)

## Files

| Path | Purpose | Consumed by |
|------|---------|-------------|
| `rubric-expected.txt` | Lines 1-34 of a real stderr capture, byte-for-byte (10 leading TABs preserved) | `render.test.ts` |
| `agent-memo-prefixes.txt` | 34 case-insensitive prefixes the binary uses for agent-memo detection, plus the 24 raw regexes it compiles | `allow-list.ts` |
| `cases/<case>/<file>` | Input file with its real extension | parity tests |
| `cases/<case>/case.json` | `{tool, filePath, content}` (write) or `{tool, filePath, oldString, newString}` (edit) + measured expectations | all tests |
| `baseline/<case>.expected.txt` | Raw stderr the old binary produced for that case | parity tests |
| `baseline/manifest.json` | Per case: exit code, byte length, sha256, capture command, `skipped` | parity tests |

## Capture

The binary takes a Claude-Code hook payload on **stdin** (`{"tool_input":{...}}`), ignores argv,
exits `2` with the message on stderr when it finds comments, and `0` otherwise:

```bash
# write case
OLD_BINARY=/path/to/the/removed/comment-checker-executable
jq -c '{tool_input:{file_path:.filePath,content:.content}}' cases/<case>/case.json \
  | $OLD_BINARY 2> baseline/<case>.expected.txt
# edit case
jq -c '{tool_input:{file_path:.filePath,old_string:.oldString,new_string:.newString}}' cases/<case>/case.json \
  | $OLD_BINARY 2> baseline/<case>.expected.txt
```

`content` wins over `old_string`/`new_string` when both are present, so edit cases omit `content`.

## Parity set (`"parity": true`)

`python`, `java`, `kotlin`, `go`, `bash`, `yaml`, `css`, `html`, `sql`, `toml`, `dockerfile`, `proto`.

Every `<comment>` line in those baselines must be reproducible by `formatReport`.
`filePath` is repo-relative, so a parity test must normalise the `file` attribute to the
fixture basename before comparing.

## Non-parity cases (`"parity": false` + `parityReason`)

| Case | Measured binary behaviour | Why it cannot be byte-parity |
|------|---------------------------|------------------------------|
| `typescript`, `javascript`, `typescript-edit` | every comment is reported **twice** (6 entries for 3 comments) | new scan dedupes by (file, line, text) |
| `rust` | `///` and `//!` reported **once each**, but the text keeps a trailing `\n` | new scan trims the node text |
| `jsonc` | exit 0, no rubric, no XML: `[check-comments] Skipping: Non-code file` | jsonc is regex-tier in the new design |
| `agent-memo` | 30-line memo block **replaces rubric line 1**, then rubric lines 3-35 | the new renderer keeps agent-memo out of `formatReport` |
| `bdd` | `given`/`when`/`then` comments **are** reported | the new scan allow-lists BDD comments, so it reports zero |

`bdd` and `agent-memo` are evidence cases for the allow-list / heuristic rows, not parity cases.

## `case.json` fields

`case`, `tool`, `filePath`, `content` | `oldString`/`newString`, `language`, `tier`,
`expectedExitCode`, `expectedFindings` (count of `<comment line-number=` entries in the baseline),
`hasXml`, `xmlStartLine`, `agentMemoBlock`, `parity`, `parityReason` (only when false), `notes`.
