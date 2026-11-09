#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
exec bun script/pr1a-neutrality.ts
