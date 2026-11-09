#!/usr/bin/env bash
# Read-only baseline recorder for background-task handles (remediation D4).
# Prints two stable, parseable lines and never writes, creates or removes files.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: report-bg-handles.sh [--root DIR]

Prints a stable two-line baseline:
  count=<N>   bg_*.json handle files under <root>/.matrixx/bg-handles (0 if absent)
  head=<sha>  git -C <root> rev-parse HEAD

--root DIR defaults to the repository root derived from this script's location.
Read-only: the working tree is never modified.

Exit codes: 0 success, 2 usage.
USAGE
}

ROOT=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --root)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      ROOT="$2"
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
ROOT=$(cd -- "$ROOT" && pwd)

HANDLE_DIR="$ROOT/.matrixx/bg-handles"

count=0
if [ -d "$HANDLE_DIR" ]; then
  count=$(find "$HANDLE_DIR" -maxdepth 1 -type f -name 'bg_*.json' | wc -l | tr -d '[:space:]')
fi

head=$(git -C "$ROOT" rev-parse HEAD)

printf 'count=%s\n' "$count"
printf 'head=%s\n' "$head"
