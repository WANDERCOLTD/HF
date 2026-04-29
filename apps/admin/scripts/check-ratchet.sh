#!/usr/bin/env bash
# check-ratchet.sh — count-cap ratchet gate (#227)
#
# Reads `.ratchet.json` at the repo root, measures four counts in the
# `apps/admin` tree, and:
#   • fails if any count exceeds its baseline  (ratchet up = forbidden)
#   • emits a "lock the win" hint if any count drops below baseline
#     (ratchet down only via deliberate human commit — npm run ratchet:lock)
#
# Metrics:
#   tsc_errors        — `error TS####:` lines from `tsc --noEmit`
#   lint_errors       — sum of errorCount across files (eslint --format json)
#   lint_warnings     — sum of warningCount across files
#   quarantined_tests — `'…test.ts',`-shaped lines in vitest.config.ts exclude
#
# Notes:
#   • Run init/lock on hf-dev VM (Linux) to set the canonical baseline.
#     macOS and Linux can produce different tsc counts because of platform-
#     specific @types resolution.
#   • A tsc crash (exit ≥ 128 from a signal, or "Internal Error" in output)
#     emits a warning and SKIPS that metric rather than recording 0 — which
#     would falsely look like a huge improvement.
#   • A baseline value of `null` means "not yet baselined" — the metric is
#     skipped with a hint to run ratchet:lock.
#
# Usage:
#   ./check-ratchet.sh         — measure + compare against baseline (default)
#   ./check-ratchet.sh init    — write a fresh `.ratchet.json` (refuses overwrite)
#   ./check-ratchet.sh lock    — overwrite `.ratchet.json` with current counts
#
# Exit codes:
#   0 — all metrics within baseline
#   1 — at least one metric exceeded baseline
#   2 — invocation error / missing baseline / measurement crash on init or lock

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$APP_DIR/../.." && pwd)"
BASELINE_FILE="$REPO_ROOT/.ratchet.json"

MODE="${1:-check}"

# ─── Measurement helpers ───────────────────────────────────────
# Each helper writes a single integer to stdout, or the literal `ERR`
# when measurement crashed (caller decides whether ERR is fatal).

measure_tsc() {
  local out rc count
  out=$(mktemp)
  set +e
  ( cd "$APP_DIR" && npx tsc --noEmit ) >"$out" 2>&1
  rc=$?
  set -e
  # Bash maps SIGSEGV/SIGABRT/SIGKILL to exit codes 128 + signum.
  if [ "$rc" -ge 128 ]; then
    echo "WARN tsc crashed with exit $rc — skipping tsc_errors metric" >&2
    rm -f "$out"
    echo "ERR"
    return
  fi
  if grep -qE "Internal Error|Debug Failure" "$out"; then
    echo "WARN tsc reported Internal Error — skipping tsc_errors metric" >&2
    rm -f "$out"
    echo "ERR"
    return
  fi
  count=$(grep -cE "error TS[0-9]+:" "$out" || true)
  rm -f "$out"
  echo "${count:-0}"
}

measure_lint() {
  # Emits "<errors> <warnings>" or the literal `ERR`.
  local out rc result
  out=$(mktemp)
  set +e
  ( cd "$APP_DIR" && npx eslint . --format json ) >"$out" 2>/dev/null
  rc=$?
  set -e
  if [ "$rc" -ge 128 ]; then
    echo "WARN eslint crashed with exit $rc — skipping lint metrics" >&2
    rm -f "$out"
    echo "ERR"
    return
  fi
  if [ ! -s "$out" ]; then
    echo "WARN eslint produced no output — skipping lint metrics" >&2
    rm -f "$out"
    echo "ERR"
    return
  fi
  if ! result=$(node -e '
    const fs = require("fs");
    try {
      const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const e = j.reduce((s, f) => s + (f.errorCount || 0), 0);
      const w = j.reduce((s, f) => s + (f.warningCount || 0), 0);
      console.log(e + " " + w);
    } catch (err) {
      console.error("eslint json parse failed: " + err.message);
      process.exit(2);
    }
  ' "$out" 2>&1); then
    echo "WARN eslint json parse failed: $result" >&2
    rm -f "$out"
    echo "ERR"
    return
  fi
  rm -f "$out"
  echo "$result"
}

measure_quarantined() {
  local count
  count=$(grep -cE "^[[:space:]]+'.*\.test\.ts',[[:space:]]*$" "$APP_DIR/vitest.config.ts" || true)
  echo "${count:-0}"
}

# ─── Baseline I/O ──────────────────────────────────────────────

read_baseline() {
  # Echoes the numeric value of $1 from .ratchet.json, or empty for null/missing.
  node -e '
    const fs = require("fs");
    try {
      const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const v = j[process.argv[2]];
      if (typeof v === "number") console.log(v);
    } catch {}
  ' "$BASELINE_FILE" "$1"
}

write_baseline() {
  # Args: tsc lint_e lint_w quarantined  (use "null" string to write JSON null)
  cat > "$BASELINE_FILE" <<JSON
{
  "tsc_errors": $1,
  "lint_errors": $2,
  "lint_warnings": $3,
  "quarantined_tests": $4
}
JSON
}

# ─── Mode dispatch ─────────────────────────────────────────────

measure_all() {
  TSC=$(measure_tsc)
  local lint
  lint=$(measure_lint)
  if [ "$lint" = "ERR" ]; then
    LINT_E="ERR"
    LINT_W="ERR"
  else
    LINT_E="${lint%% *}"
    LINT_W="${lint##* }"
  fi
  QUAR=$(measure_quarantined)
}

case "$MODE" in
  init)
    if [ -f "$BASELINE_FILE" ]; then
      echo "ratchet baseline already exists at $BASELINE_FILE" >&2
      echo "use 'npm run ratchet:lock' to overwrite with current counts." >&2
      exit 2
    fi
    measure_all
    if [ "$TSC" = "ERR" ] || [ "$LINT_E" = "ERR" ]; then
      echo "ratchet:init failed — at least one metric crashed (see warnings above)" >&2
      exit 2
    fi
    write_baseline "$TSC" "$LINT_E" "$LINT_W" "$QUAR"
    echo "wrote $BASELINE_FILE"
    echo "  tsc_errors        = $TSC"
    echo "  lint_errors       = $LINT_E"
    echo "  lint_warnings     = $LINT_W"
    echo "  quarantined_tests = $QUAR"
    exit 0
    ;;

  lock)
    measure_all
    if [ "$TSC" = "ERR" ] || [ "$LINT_E" = "ERR" ]; then
      echo "ratchet:lock failed — at least one metric crashed (see warnings above)" >&2
      exit 2
    fi
    prev_tsc=""
    prev_le=""
    prev_lw=""
    prev_q=""
    if [ -f "$BASELINE_FILE" ]; then
      prev_tsc=$(read_baseline tsc_errors)
      prev_le=$(read_baseline lint_errors)
      prev_lw=$(read_baseline lint_warnings)
      prev_q=$(read_baseline quarantined_tests)
    fi
    write_baseline "$TSC" "$LINT_E" "$LINT_W" "$QUAR"
    echo "updated $BASELINE_FILE"
    echo "  tsc_errors        : ${prev_tsc:-(none)} → $TSC"
    echo "  lint_errors       : ${prev_le:-(none)} → $LINT_E"
    echo "  lint_warnings     : ${prev_lw:-(none)} → $LINT_W"
    echo "  quarantined_tests : ${prev_q:-(none)} → $QUAR"
    exit 0
    ;;

  check|"")
    if [ ! -f "$BASELINE_FILE" ]; then
      echo "ratchet baseline missing — run npm run ratchet:init to create one." >&2
      exit 2
    fi
    measure_all
    failed=0
    compare() {
      local name="$1" base="$2" cur="$3"
      if [ "$cur" = "ERR" ]; then
        echo "  ⚠️  $name: measurement skipped (see warning above)"
        return
      fi
      if [ -z "$base" ]; then
        echo "  ⚠️  $name: $cur — not yet baselined. Run 'npm run ratchet:lock' to set."
        return
      fi
      if [ "$cur" -gt "$base" ]; then
        local d=$((cur - base))
        echo "  ❌ $name: $cur (+$d over baseline $base)"
        failed=1
      elif [ "$cur" -lt "$base" ]; then
        local d=$((base - cur))
        echo "  ℹ️  $name: $cur (-$d under baseline). Update .ratchet.json to lock the win."
      else
        echo "  ✅ $name: $cur (== baseline)"
      fi
    }
    compare tsc_errors        "$(read_baseline tsc_errors)"        "$TSC"
    compare lint_errors       "$(read_baseline lint_errors)"       "$LINT_E"
    compare lint_warnings     "$(read_baseline lint_warnings)"     "$LINT_W"
    compare quarantined_tests "$(read_baseline quarantined_tests)" "$QUAR"
    [ "$failed" -eq 0 ]
    ;;

  *)
    echo "usage: $0 [check|init|lock]" >&2
    exit 2
    ;;
esac
