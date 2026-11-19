#!/usr/bin/env bash
# smoke-skill-pack.sh — end-to-end smoke test for the pinned ui-ux-pro-max pack.
#
# Installs the pinned pack into a throwaway root (never ~/.config/opencode),
# then runs uiux_search, uiux_design_system (persist) and uiux_validate against
# the installed payload. Requires bun, python3 and network access.
#
# Usage:
#   bash script/smoke-skill-pack.sh [--build]
#
#   --build  force a fresh `bun run build:cli` (by default the CLI is built only
#            when dist/cli.js is missing)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_ENTRY="$REPO_ROOT/dist/cli.js"

FORCE_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --build) FORCE_BUILD=1;;
    -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}"; exit 0;;
    *) echo "unknown arg: $arg" >&2; exit 2;;
  esac
done

command -v bun >/dev/null 2>&1 || { echo "FAIL: bun is not on PATH" >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "FAIL: python3 is not on PATH" >&2; exit 2; }

if [[ "$FORCE_BUILD" -eq 1 || ! -f "$CLI_ENTRY" ]]; then
  echo "==> building the CLI"
  ( cd "$REPO_ROOT" && bun run build:cli ) || { echo "FAIL: CLI build failed" >&2; exit 1; }
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PROJECT_DIR="$TMP/project"

echo "==> installing ui-ux-pro-max into $TMP"
bun "$CLI_ENTRY" skill add ui-ux-pro-max --root "$TMP" --allow-network || {
  echo "FAIL: pack install failed" >&2
  exit 1
}

# The runner lives outside the repo so it exercises the installed payload, not
# the test fixtures; it imports the source modules by absolute path.
cat > "$TMP/smoke.ts" <<'BUN_EOF'
const [repoRoot, packsRoot, projectDir] = process.argv.slice(2)
if (!repoRoot || !packsRoot || !projectDir) {
  console.error("FAIL: smoke runner needs <repoRoot> <packsRoot> <projectDir>")
  process.exit(2)
}

const { existsSync } = await import("node:fs")
const { join } = await import("node:path")
const { resolveCorePackRoot } = await import(`${repoRoot}/src/skills/packs/loader.ts`)
const { UIUX_MAX_STDOUT_BYTES } = await import(`${repoRoot}/src/tools/uiux/constants.ts`)
const { runUiuxDesignSystem, runUiuxSearch, runUiuxValidate } = await import(
  `${repoRoot}/src/tools/uiux/tools.ts`
)

function fail(message: string): never {
  console.error(`FAIL: ${message}`)
  process.exit(1)
}

const coreSkillRoot = resolveCorePackRoot("ui-ux-pro-max", packsRoot)
if (coreSkillRoot === undefined) fail("the pack is not installed")
const deps = {
  coreSkillRoot,
  pythonBin: "python3",
  timeoutMs: 20_000,
  maxStdoutBytes: UIUX_MAX_STDOUT_BYTES,
}

console.log("==> uiux_search")
const search = await runUiuxSearch(deps, {
  query: "glassmorphism dashboard",
  domain: "style",
  maxResults: 2,
})
if (!search.ok) fail(`uiux_search: ${search.error} - ${search.message}`)
if (search.output.trim().length === 0) fail("uiux_search returned no output")
console.log(`    ${search.output.trim().split("\n").length} line(s) of guidance`)

console.log("==> uiux_design_system (persist)")
const design = await runUiuxDesignSystem(deps, {
  project: "E2E Smoke",
  outputDir: projectDir,
  persist: true,
})
if (!design.ok) fail(`uiux_design_system: ${design.error} - ${design.message}`)
const master = join(projectDir, "design-system", "e2e-smoke", "MASTER.md")
if (!existsSync(master)) fail(`MASTER.md missing at ${master}`)
console.log(`    persisted ${master}`)

console.log("==> uiux_validate")
const report = await runUiuxValidate(deps)
if (!("checks" in report)) fail(`uiux_validate: ${report.error} - ${report.message}`)
if (!report.ok) {
  const failed = report.checks
    .filter((check) => check.skipped !== true && !check.ok)
    .map((check) => check.name)
  fail(`uiux_validate checks failed: ${failed.join(", ")}`)
}
console.log(`    ${report.checks.length} check(s) ok`)
BUN_EOF

echo "==> running the uiux tools"
bun "$TMP/smoke.ts" "$REPO_ROOT" "$TMP" "$PROJECT_DIR" || {
  echo "FAIL: uiux smoke run failed" >&2
  exit 1
}

echo "PASS: ui-ux-pro-max skill pack installed, searched, generated and validated"
