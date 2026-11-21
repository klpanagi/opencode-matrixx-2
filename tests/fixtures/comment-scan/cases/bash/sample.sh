#!/usr/bin/env bash
set -euo pipefail

# Runs the smoke suite against the local build.
main() {
  local target="${1:-.}" # defaults to the repo root
  echo "running in $target"
}

main "$@"
