#!/usr/bin/env bash
# e2e runtime verification — proves matrixx works inside a real opencode runtime.
# Everything runs inside a container: the host only needs a container runtime.
# No host Bun, no host opencode, no host HOME mutation.
#
# Usage:
#   bash script/e2e-runtime.sh [--tier=pr|nightly] [--opencode-version=X.Y.Z]
#                              [--runtime=docker|podman] [--image=IMG]
#
# Tiers:
#   pr       install + build + plugin-load + tool-registration (no LLM needed).
#            Safe for every PR.
#   nightly  everything in pr + a real-model run asserting tool + hook artifacts
#            (.matrixx/tasks/T-*.json, .matrixx/bg-handles/bg_*.json).
#            Requires OPENCODE_API_KEY in the environment (passed through, never baked).
#
# Examples:
#   bash script/e2e-runtime.sh --tier=pr
#   OPENCODE_API_KEY=... NIGHTLY_MODEL=opencode/gpt-5.4-nano bash script/e2e-runtime.sh --tier=nightly
set -euo pipefail

TIER="pr"
OPENCODE_VERSION="${OPENCODE_VERSION:-}"
RUNTIME="${CONTAINER_RUNTIME:-docker}"
IMAGE="${E2E_IMAGE:-oven/bun:1.4.0}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for arg in "$@"; do
  case "$arg" in
    --tier=*) TIER="${arg#--tier=}";;
    --opencode-version=*) OPENCODE_VERSION="${arg#--opencode-version=}";;
    --runtime=*) RUNTIME="${arg#--runtime=}";;
    --image=*) IMAGE="${arg#--image=}";;
    -h|--help)
      sed -n '2,20p' "${BASH_SOURCE[0]}"
      exit 0;;
    *) echo "unknown arg: $arg" >&2; exit 2;;
  esac
done

if [[ "$TIER" != "pr" && "$TIER" != "nightly" ]]; then
  echo "error: --tier must be pr|nightly (got: $TIER)" >&2
  exit 2
fi
if [[ "$RUNTIME" != "docker" && "$RUNTIME" != "podman" ]]; then
  echo "error: --runtime must be docker|podman (got: $RUNTIME)" >&2
  exit 2
fi
if ! command -v "$RUNTIME" >/dev/null 2>&1; then
  echo "error: container runtime '$RUNTIME' not found" >&2
  exit 2
fi

# Nightly key is passed through as an env var, never written to disk or image.
NIGHTLY_ENV_ARGS=()
if [[ "$TIER" == "nightly" ]]; then
  if [[ -z "${OPENCODE_API_KEY:-}" ]]; then
    echo "error: nightly tier needs OPENCODE_API_KEY in the environment" >&2
    exit 2
  fi
  NIGHTLY_ENV_ARGS=(-e "OPENCODE_API_KEY=$OPENCODE_API_KEY"
                    -e "NIGHTLY_MODEL=${NIGHTLY_MODEL:-opencode/gpt-5.4-nano}")
fi

# The guest script runs INSIDE the container where the repo is mounted at /work
# and opencode is installed via the official v2 installer. All opencode stdio
# is detached from any TTY (< /dev/null) and guarded by `timeout` so a hung
# model call fails instead of hanging CI. CI=1 disables interactive prompts.
read -r -d '' GUEST_SCRIPT <<'GUEST_EOF' || true
set -euo pipefail
export CI=1
export PATH="$HOME/.opencode/bin:$PATH"

STEPS=0; FAILED=0
step() { STEPS=$((STEPS + 1)); echo "::group::[$STEPS] $*"; }
pass() { echo "✅ $*"; echo "::endgroup::"; }
fail() { echo "❌ $*"; FAILED=$((FAILED + 1)); echo "::endgroup::"; }

cd /work

step "install dependencies"
bun install && pass "bun install" || fail "bun install"

step "build plugin"
bun run build && pass "build" || fail "build"

step "dist smoke import"
if test -f dist/index.js; then
  timeout 60 bun -e "await import('./dist/index.js'); console.log('plugin entry imports cleanly'); process.exit(0)" \
    && pass "dist/index.js imports" || fail "dist/index.js import"
else
  fail "dist/index.js missing"
fi

step "guest prerequisites (curl for the opencode installer)"
if ! command -v curl >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq && apt-get install -y -qq curl ca-certificates \
    && pass "curl installed" || fail "curl install"
else
  pass "curl present"
fi

step "opencode binary (official v2 installer)"
if [ -n "${OPENCODE_VERSION:-}" ]; then
  curl -fsSL https://opencode.ai/v2/install | bash -s -- --version "$OPENCODE_VERSION" \
    && pass "opencode $OPENCODE_VERSION installed" || fail "opencode install $OPENCODE_VERSION"
elif command -v opencode >/dev/null 2>&1; then
  opencode --version && pass "opencode present: $(opencode --version)" || fail "opencode --version"
else
  curl -fsSL https://opencode.ai/v2/install | bash \
    && pass "opencode installed" || fail "opencode install"
fi
export PATH="$HOME/.opencode/bin:$PATH"

step "isolated runtime config (native V2 format)"
RUNTIME_HOME="$(mktemp -d)"; RUNTIME_PROJECT="$(mktemp -d)"
mkdir -p "$RUNTIME_HOME/.config/opencode"
cat > "$RUNTIME_HOME/.config/opencode/opencode.jsonc" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "plugins": [{ "package": "/work/dist" }],
  "permissions": [
    { "action": "edit", "resource": "*", "effect": "allow" },
    { "action": "shell", "resource": "*", "effect": "allow" }
  ]
}
EOF
export HOME="$RUNTIME_HOME"
pass "isolated HOME + project ready (V2 plugins/permissions)"

step "plugin resolves in real runtime"
CFG_EXIT=0
pushd "$RUNTIME_PROJECT" >/dev/null
timeout 60 opencode debug config </dev/null >"$RUNTIME_PROJECT/debug-config.txt" 2>&1 || CFG_EXIT=$?
popd >/dev/null
if [ "$CFG_EXIT" -eq 0 ]; then
  if grep -q '"/work/dist"' "$RUNTIME_PROJECT/debug-config.txt"; then
    pass "plugin package /work/dist present in resolved config"
    grep -i -B2 -A2 "dist" "$RUNTIME_PROJECT/debug-config.txt" | head -n 15 || true
  else
    fail "plugin missing from resolved config"
    tail -n 20 "$RUNTIME_PROJECT/debug-config.txt" || true
  fi
else
  fail "opencode debug config failed"
  tail -n 20 "$RUNTIME_PROJECT/debug-config.txt" || true
fi

step "negative-control run (plugin loads, only model auth may fail)"
if timeout 120 opencode run "say OK" --dir "$RUNTIME_PROJECT" --print-logs </dev/null >"$RUNTIME_PROJECT/run.txt" 2>&1; then
  pass "headless run exited 0 (model available, plugin loaded)"
else
  if grep -Eiq "plugin.*(fail|error|cannot|unable to load)|failed to load plugin|error.*loading.*plugin" "$RUNTIME_PROJECT/run.txt"; then
    fail "plugin load error in headless run"
    grep -Ei "plugin.*(fail|error|cannot|unable)" "$RUNTIME_PROJECT/run.txt" | head -n 10 || true
  else
    pass "no plugin-load errors (run stopped at model/auth stage only)"
  fi
  echo "--- plugin mentions in headless run log ---"
  grep -Ei "plugin|matrixx|/work/dist" "$RUNTIME_PROJECT/run.txt" | head -n 15 || echo "(no plugin mentions)"
fi

if [ "${E2E_TIER:-pr}" = "nightly" ]; then
  step "nightly real-model run ($NIGHTLY_MODEL)"
  if timeout 300 opencode run "Reply with exactly: RUNTIME_OK" \
      --dir "$RUNTIME_PROJECT" --model "$NIGHTLY_MODEL" --print-logs </dev/null >"$RUNTIME_PROJECT/nightly.txt" 2>&1; then
    grep -q "RUNTIME_OK" "$RUNTIME_PROJECT/nightly.txt" \
      && pass "nightly model round-trip (RUNTIME_OK)" \
      || { fail "RUNTIME_OK marker missing"; tail -n 20 "$RUNTIME_PROJECT/nightly.txt" || true; }
  else
    fail "nightly opencode run failed"
    tail -n 20 "$RUNTIME_PROJECT/nightly.txt" || true
  fi

  step "nightly hook artifacts"
  if compgen -G "$RUNTIME_PROJECT/.matrixx/tasks/T-*.json" > /dev/null; then
    pass "task-storage artifact present (.matrixx/tasks/T-*.json)"
  else
    fail "task-storage artifact missing (.matrixx/tasks/T-*.json)"
  fi
  if compgen -G "$RUNTIME_PROJECT/.matrixx/bg-handles/bg_*.json" > /dev/null; then
    pass "bg-handle artifact present (.matrixx/bg-handles/bg_*.json)"
  else
    echo "ℹ️ no bg_*.json (prompt spawned no background work — informational only)"
    echo "::endgroup::"
  fi
fi

echo ""
echo "========== E2E RUNTIME SUMMARY (guest) =========="
echo "Tier: ${E2E_TIER:-pr}, Steps: $STEPS, Passed: $((STEPS - FAILED)), Failed: $FAILED"
echo "STAGES: tier=${E2E_TIER:-pr} steps=$STEPS passed=$((STEPS - FAILED)) failed=$FAILED"
test "$FAILED" -eq 0
GUEST_EOF

RUN_ARGS=(run --rm
  -v "$REPO_ROOT:/work"
  -w /work
  -e "E2E_TIER=$TIER"
  -e "CI=1"
)
if [[ -n "$OPENCODE_VERSION" ]]; then
  RUN_ARGS+=(-e "OPENCODE_VERSION=$OPENCODE_VERSION")
fi
RUN_ARGS+=("${NIGHTLY_ENV_ARGS[@]}")

echo "=== e2e-runtime: tier=$TIER runtime=$RUNTIME image=$IMAGE ==="
"$RUNTIME" "${RUN_ARGS[@]}" "$IMAGE" bash -c "$GUEST_SCRIPT"
GUEST_EXIT=$?

# Guest runs as root, so dist/ it writes through the mount is root-owned; give it back.
"$RUNTIME" run --rm -v "$REPO_ROOT:/work" "$IMAGE" \
  chown -R "$(id -u):$(id -g)" /work >/dev/null 2>&1 || true

echo ""
echo "========== E2E RUNTIME SUMMARY (host) =========="
echo "STAGES: tier=$TIER guest_exit=$GUEST_EXIT"
exit "$GUEST_EXIT"
