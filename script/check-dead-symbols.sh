#!/usr/bin/env bash
# Proven dead-symbol checker. Three checks only:
#   1. declaration absence inside the row's proof-scope
#   2. import absence across src/**/*.ts and tests/**/*.ts
#   3. residual: bun run typecheck once for the whole inventory
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: check-dead-symbols.sh [--inventory] [--root DIR] [--file INVENTORY]

Checks:
  1. declaration absence in proof-scope
  2. import absence across src/**/*.ts and tests/**/*.ts
  3. residual: bun run typecheck once (set DEAD_SYMBOLS_SKIP_TYPECHECK=1 to skip)

--inventory prints symbol, status, evidence and proof-scope for every row.

Exit codes: 0 pass, 1 findings, 2 usage.
USAGE
}

INVENTORY_MODE=0
ROOT=""
INVENTORY=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --inventory)
      INVENTORY_MODE=1
      shift
      ;;
    --root)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      ROOT="$2"
      shift 2
      ;;
    --file)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      INVENTORY="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[ -n "$ROOT" ] || ROOT=$(dirname -- "$SCRIPT_DIR")
[ -n "$INVENTORY" ] || INVENTORY="$SCRIPT_DIR/dead-symbols.txt"
ROOT=$(cd -- "$ROOT" && pwd)

case "$INVENTORY" in
  /*) ;;
  *) INVENTORY="$ROOT/$INVENTORY" ;;
esac

[ -f "$INVENTORY" ] || { echo "inventory not found: $INVENTORY" >&2; exit 2; }
command -v git >/dev/null 2>&1 || { echo "git is required" >&2; exit 2; }

FINDINGS=0

fail() {
  echo "FAIL: $*" >&2
  FINDINGS=$((FINDINGS + 1))
}

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

evidence_names_consumer() {
  local evidence="$1"
  if [[ "$evidence" =~ readSrc\( ]]; then
    return 0
  fi
  if [[ "$evidence" =~ [A-Za-z0-9_./-]+\.(ts|tsx|js|mjs|cjs|jsx|sh|json|md)(:[0-9]+([-,][0-9]+)*)? ]]; then
    return 0
  fi
  return 1
}

check_declaration() {
  local symbol="$1"
  local proof="$2"
  local row_kind="$3"
  local path="$4"
  local pattern="^(export )?(interface|type|const|function|class|enum|let|var)[[:space:]]+${symbol}([^A-Za-z0-9_]|$)"

  case "$row_kind" in
    field)
      pattern="^[[:space:]]*${symbol}\\??[[:space:]]*:"
      ;;
    method)
      pattern="^[[:space:]]*(public |private |protected )?(async )?${symbol}[[:space:]]*\\("
      ;;
    union-member|branch|file|local)
      return 0
      ;;
  esac

  local hits
  hits=$(git -C "$ROOT" grep -nE "$pattern" -- "$proof" 2>/dev/null || true)
  if [ -n "$hits" ]; then
    fail "declaration remains for '$symbol' ($path) in $proof:"$'\n'"$hits"
  fi
}

check_import() {
  local symbol="$1"
  local path="$2"
  local hits
  hits=$(git -C "$ROOT" grep -nE "import[^;]*\b${symbol}\b" -- ':(glob)src/**/*.ts' ':(glob)tests/**/*.ts' 2>/dev/null || true)
  if [ -n "$hits" ]; then
    fail "import remains for '$symbol' ($path):"$'\n'"$hits"
  fi
}

check_readsrc() {
  local symbol="$1"
  local proof="$2"
  local path="$3"

  [ "$proof" = "—" ] && return 0

  local escaped
  escaped=$(printf '%s' "$proof" | sed 's/[.[\*^$()+?{}|]/\\&/g')
  local hits
  hits=$(git -C "$ROOT" grep -nE "readSrc\((['\"])${escaped}\1\).*(toMatch|toContain|toMatchInlineSnapshot)" -- ':(glob)src/**/*.ts' ':(glob)tests/**/*.ts' 2>/dev/null || true)
  if [ -n "$hits" ]; then
    fail "same-statement readSrc consumer remains for '$symbol' ($path):"$'\n'"$hits"
  fi
}

row_no=0

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    ''|'#'*) continue ;;
  esac

  row_no=$((row_no + 1))

  IFS='|' read -r symbol path status evidence proof row_kind <<< "$line"
  symbol=$(trim "$symbol")
  path=$(trim "$path")
  status=$(trim "$status")
  evidence=$(trim "$evidence")
  proof=$(trim "$proof")
  row_kind=$(trim "$row_kind")
  [ -n "$row_kind" ] || row_kind="declaration"

  if [ "$INVENTORY_MODE" -eq 1 ]; then
    printf '%s\t%s\t%s\t%s\n' "$symbol" "$status" "$evidence" "$proof"
    continue
  fi

  if [ -z "$symbol" ] || [ -z "$path" ] || [ -z "$status" ]; then
    fail "row $row_no is missing a required column (symbol/path/status): $line"
    continue
  fi

  case "$status" in
    KEEP)
      if ! evidence_names_consumer "$evidence"; then
        fail "KEEP row for '$symbol' ($path) does not name a consumer: $evidence"
      fi
      ;;
    DELETE)
      if [ -z "$proof" ] || [ "$proof" = "—" ]; then
        fail "DELETE row for '$symbol' ($path) is missing proof-scope"
        continue
      fi
      check_declaration "$symbol" "$proof" "$row_kind" "$path"
      check_import "$symbol" "$path"
      check_readsrc "$symbol" "$proof" "$path"
      ;;
    DEFER)
      ;;
    *)
      fail "row $row_no for '$symbol' ($path) has unknown status '$status'"
      ;;
  esac
done < "$INVENTORY"

if [ "$INVENTORY_MODE" -eq 1 ]; then
  exit 0
fi

if [ "${DEAD_SYMBOLS_SKIP_TYPECHECK:-0}" != "1" ]; then
  if ! ( cd "$ROOT" && bun run typecheck ); then
    fail "residual check: bun run typecheck failed"
  fi
fi

if [ "$FINDINGS" -gt 0 ]; then
  echo "check-dead-symbols: $FINDINGS finding(s)" >&2
  exit 1
fi

echo "check-dead-symbols: OK"
exit 0
