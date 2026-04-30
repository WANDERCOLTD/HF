#!/usr/bin/env bash
# deploy-gate.sh — mandatory pre-deploy check. Runs fast local gates + VM-
# routed verification before /deploy is allowed to proceed. Designed to
# catch the failure modes that have actually bitten us in production:
#
#   1. Missing migration on target env (2026-04-15 incident: ContentSource.
#      extractorVersion missing, prod code expected it).
#   2. Broken production build (syntax or type errors in shipped code).
#   3. Dead routes — unit tests pass but a route is broken end-to-end.
#
# Design notes on why each gate is what it is:
#
#   Gate 1 uses `npm run build` (next build), NOT raw `tsc --noEmit`, because
#     Next.js build is what actually deploys. Raw tsc is stricter and surfaces
#     pre-existing type debt the build tolerates — those are valid bugs to
#     triage in Sprint 2, but blocking tonight's deploy on them punishes the
#     person shipping today's fixes for yesterday's tech debt.
#
#   Gate 4 runs on the VM via gcloud SSH, NOT from the developer's laptop,
#     because Cloud SQL private IPs are only reachable from inside the VPC.
#     A laptop-side prisma migrate status can't see the target DB at all.
#     The VM is already inside the VPC so the migration diff works there.
#     It runs `git pull --rebase` first so the VM's migration folder matches
#     what's being deployed — without this, a stale VM reports "up to date"
#     even when new migrations exist locally (2026-04-19 incident).
#
#   Gate 6 is the count-cap ratchet (#227). It compares tsc errors, lint
#     errors/warnings, and quarantined-test count against `.ratchet.json`
#     at the repo root. The pool of known debt can shrink (and we hint at
#     locking the win) but never grow. Tightens by deliberate human commit
#     via `npm run ratchet:lock`.
#
# Usage:
#   ./scripts/deploy-gate.sh <env>
#     env: dev | test | prod
#
# Exit codes:
#   0 — all gates green, safe to deploy
#   1 — at least one gate failed (details printed)
#   2 — invocation error

set -euo pipefail

ENV="${1:-}"
if [[ -z "$ENV" ]]; then
  echo "error: missing env. usage: $0 <dev|test|prod>" >&2
  exit 2
fi

case "$ENV" in
  dev)
    BASE_URL="https://dev.humanfirstfoundation.com"
    DB_SECRET="DATABASE_URL_DEV"
    ;;
  test)
    BASE_URL="https://test.humanfirstfoundation.com"
    DB_SECRET="DATABASE_URL_TEST"
    ;;
  prod)
    BASE_URL="https://lab.humanfirstfoundation.com"
    DB_SECRET="DATABASE_URL"
    ;;
  *)
    echo "error: unknown env '$ENV' (expected dev|test|prod)" >&2
    exit 2
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$APP_DIR"

# ─── Auto-route to VM when run from non-Linux ────────────────
# Linux is the canonical platform — `.ratchet.json` baseline is locked there,
# and tests (esp. vitest worker pool) are stable there. macOS reports +1
# lint_warnings vs Linux due to platform-specific @types resolution, and
# vitest workers occasionally crash with `Closing rpc while "fetch" was
# pending` on Mac. Both are tooling flakes that mask real gate signal.
#
# Solution: when run on macOS, SSH the entire gate to hf-dev and exec it
# there with `__GATE_RUNNING_ON_VM=1` so gate 4 knows not to recurse.
# When run from Linux (VM or CI) we just run locally.
if [[ "${__GATE_RUNNING_ON_VM:-}" != "1" && "$(uname -s)" == "Darwin" ]]; then
  if ! command -v gcloud >/dev/null 2>&1; then
    echo "error: macOS detected but gcloud not installed — cannot route to VM" >&2
    exit 2
  fi
  echo "→ macOS detected; routing gate to hf-dev (Linux canonical platform)"
  # Sync VM to current local branch before running. Use fetch + reset --hard
  # rather than pull --rebase so VM-side auto-generated files (constants-
  # manifest timestamp, etc.) don't block sync. The branch lives in origin.
  CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  exec gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap \
    --command="set -e; export __GATE_RUNNING_ON_VM=1; cd ~/HF; git fetch origin --quiet; git reset --hard origin/$CURRENT_BRANCH 2>&1 | tail -1; cd apps/admin; bash scripts/deploy-gate.sh $ENV"
fi

failed_gates=()

section() {
  echo
  echo "=========================================="
  echo "  $1"
  echo "=========================================="
}

gate_fail() {
  failed_gates+=("$1")
}

# ─── Gate 1: next build ──────────────────────────────────────
# Matches what CI/Cloud Build actually runs. If `npm run build` passes here
# it will pass on Cloud Build. If it fails, the deploy would fail too.
section "Gate 1/6 — Next.js production build"
if npm run build >/tmp/deploy-gate-build.$$ 2>&1; then
  echo "  PASS  build succeeded"
else
  echo "  FAIL  build failed — tail:" >&2
  tail -40 /tmp/deploy-gate-build.$$ >&2
  gate_fail "build"
fi
rm -f /tmp/deploy-gate-build.$$

# ─── Gate 2: lint ────────────────────────────────────────────
section "Gate 2/6 — ESLint"
if npm run lint 2>&1 | tail -10 | grep -qE "error" ; then
  echo "  FAIL  lint errors detected" >&2
  gate_fail "lint"
else
  echo "  PASS  lint clean"
fi

# ─── Gate 3: unit tests ──────────────────────────────────────
# Quarantined pre-existing failing test files live in vitest.config.ts exclude.
# Run them via `npm run test:debt` during triage.
section "Gate 3/6 — Unit tests (vitest, excl quarantined)"
if npm run test >/tmp/deploy-gate-test.$$ 2>&1; then
  if tail -20 /tmp/deploy-gate-test.$$ | grep -qE "failed" ; then
    echo "  FAIL  unit tests red — tail:" >&2
    tail -30 /tmp/deploy-gate-test.$$ >&2
    gate_fail "unit-tests"
  else
    passed=$(grep -oE "[0-9]+ passed" /tmp/deploy-gate-test.$$ | tail -1)
    echo "  PASS  unit tests green ($passed)"
  fi
else
  echo "  FAIL  unit test run crashed — tail:" >&2
  tail -30 /tmp/deploy-gate-test.$$ >&2
  gate_fail "unit-tests"
fi
rm -f /tmp/deploy-gate-test.$$

# ─── Gate 4: migration diff vs target env ───────────────────
# Cloud SQL private IPs are only reachable from inside the VPC, so this
# gate must run on hf-dev (or in CI inside the same VPC). Two paths:
#
#   • If we're already on the VM (auto-routed from Mac, or running in CI
#     on Linux): fetch the secret + run prisma migrate status locally.
#   • If we're on Linux but NOT on the VM (rare — manual run from CI
#     elsewhere): SSH to hf-dev. Same logic as before.
#
# When run from macOS the script auto-routes itself to the VM at the top,
# so this branch always lands in the "on-VM" path.
section "Gate 4/6 — Prisma migration status vs $ENV Cloud SQL"

if [[ "${__GATE_RUNNING_ON_VM:-}" == "1" ]] || [[ -f /etc/google_compute_engine_metadata ]] || hostname | grep -qE '^hf-dev'; then
  # On the VM — run migrate status locally
  if ! command -v gcloud >/dev/null 2>&1; then
    echo "  FAIL  gcloud not installed on VM — cannot fetch DB secret" >&2
    gate_fail "migration-no-gcloud"
  else
    DB_URL="$(gcloud secrets versions access latest --secret="$DB_SECRET" --project=hf-admin-prod 2>/dev/null || true)"
    if [[ -z "$DB_URL" ]]; then
      echo "  FAIL  VM could not read $DB_SECRET from Secret Manager" >&2
      gate_fail "migration-vm-secret"
    else
      # `prisma migrate status` exits 1 when migrations are pending — valid state to parse, not a transport failure.
      DATABASE_URL="$DB_URL" npx prisma migrate status 2>&1 | tee /tmp/deploy-gate-migrate.$$ || true
      if grep -qE "Database schema is up to date" /tmp/deploy-gate-migrate.$$; then
        echo "  PASS  schema up to date on $ENV"
      elif grep -qE "Following migrations have not yet been applied|Drift detected" /tmp/deploy-gate-migrate.$$; then
        echo "  FAIL  pending migrations on $ENV — /deploy must run Full deploy to apply them" >&2
        gate_fail "migration-pending"
      else
        echo "  FAIL  migrate status output unrecognised" >&2
        gate_fail "migration-unknown"
      fi
    fi
  fi
else
  # Off-VM Linux (rare — manual CI elsewhere). SSH to VM.
  if ! command -v gcloud >/dev/null 2>&1; then
    echo "  FAIL  gcloud not installed — cannot reach hf-dev VM" >&2
    gate_fail "migration-no-gcloud"
  else
    ssh_cmd='set -e
      cd ~/HF && git pull --rebase --quiet 2>&1 || { echo "__GATE_PULL_FAILED__"; exit 12; }
      export DATABASE_URL="$(gcloud secrets versions access latest --secret='"$DB_SECRET"' --project=hf-admin-prod 2>/dev/null)"
      if [ -z "$DATABASE_URL" ]; then
        echo "__GATE_NO_SECRET__"
        exit 11
      fi
      cd apps/admin && (npx prisma migrate status 2>&1 || true)'

    if gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap \
         --command="$ssh_cmd" 2>&1 | tee /tmp/deploy-gate-migrate.$$; then
      if grep -q "__GATE_PULL_FAILED__" /tmp/deploy-gate-migrate.$$; then
        echo "  FAIL  git pull on hf-dev failed — VM may have uncommitted changes or be on a different branch" >&2
        gate_fail "migration-vm-pull"
      elif grep -q "__GATE_NO_SECRET__" /tmp/deploy-gate-migrate.$$; then
        echo "  FAIL  VM could not read $DB_SECRET from Secret Manager" >&2
        gate_fail "migration-vm-secret"
      elif grep -qE "Database schema is up to date" /tmp/deploy-gate-migrate.$$; then
        echo "  PASS  schema up to date on $ENV"
      elif grep -qE "Following migrations have not yet been applied|Drift detected" /tmp/deploy-gate-migrate.$$; then
        echo "  FAIL  pending migrations on $ENV — /deploy must run Full deploy to apply them" >&2
        gate_fail "migration-pending"
      else
        echo "  FAIL  migrate status output unrecognised" >&2
        gate_fail "migration-unknown"
      fi
    else
      echo "  FAIL  gcloud ssh to hf-dev failed (network? IAP? auth?)" >&2
      gate_fail "migration-ssh"
    fi
  fi
fi
rm -f /tmp/deploy-gate-migrate.$$

# ─── Gate 5: smoke against current live env ──────────────────
section "Gate 5/6 — Smoke-env against $BASE_URL"
if bash "$SCRIPT_DIR/smoke-env.sh" "$BASE_URL"; then
  echo "  PASS  live env responding to all critical endpoints"
else
  echo "  FAIL  live env smoke red — schema drift or broken route" >&2
  gate_fail "smoke-env"
fi

# ─── Gate 6: ratchet (count-cap) ─────────────────────────────
# Fails if any of tsc errors / lint errors / lint warnings / quarantined
# tests has grown above its baseline in `.ratchet.json` at repo root.
# Hints at "lock the win" when a count drops below baseline. See
# scripts/check-ratchet.sh for measurement details.
section "Gate 6/6 — Ratchet (count-cap)"
if bash "$SCRIPT_DIR/check-ratchet.sh"; then
  echo "  PASS  no metric over baseline"
else
  echo "  FAIL  ratchet exceeded — see counts above" >&2
  gate_fail "ratchet"
fi

# ─── Summary ────────────────────────────────────────────────
section "Summary"
total=6
if [[ ${#failed_gates[@]} -eq 0 ]]; then
  echo "  ✅ All $total gates PASSED — safe to deploy to $ENV"
  exit 0
else
  echo "  ❌ ${#failed_gates[@]}/$total gate(s) FAILED: ${failed_gates[*]}"
  echo "  Deploy to $ENV is BLOCKED. Fix the failing gates above and re-run."
  exit 1
fi
