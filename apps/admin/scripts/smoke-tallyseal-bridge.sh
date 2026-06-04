#!/usr/bin/env bash
# Phase 1 smoke test for /api/tallyseal-bridge/*.
#
# Tests the two endpoints that are expected to return 200 in Phase 1:
#   - GET /health                  (no auth — version + scope summary)
#   - GET /intents                 (bearer auth — empty array)
#
# Explicitly skips the endpoints that 403/404 by design in Phase 1:
#   - /intent/:id/events           → 403 (PrismaNoopProjection.current()
#                                          returns null → scope denies)
#   - /intent/:id/bundle           → 403 (same)
#   - /intent/:id/bundle.pdf       → 403 (same) or 501 (no PDF renderer)
#
# See tallyseal docs/notebook/08-design-partner/
# hf-tkt-admin-bridge-1-phase1-qa-20260604.md (Q-A B1/B2/C2) for the
# rationale.
#
# Required env vars:
#   TALLYSEAL_BRIDGE_DEV_SECRET — must match the value the bridge route
#                                 handler reads at boot. Set in
#                                 apps/admin/.env (local) or .env.local
#                                 before running this script.
# Optional:
#   BASE_URL — defaults to http://localhost:3000

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"

if [[ -z "${TALLYSEAL_BRIDGE_DEV_SECRET:-}" ]]; then
  echo "ERROR: TALLYSEAL_BRIDGE_DEV_SECRET is not set." >&2
  echo "       export TALLYSEAL_BRIDGE_DEV_SECRET=... before running." >&2
  exit 64
fi

fail=0

echo "=== Phase 1 smoke — /health (no auth) ==="
if curl -fsS "${BASE_URL}/api/tallyseal-bridge/health" | tee /dev/stderr; then
  echo
  echo "  -> PASS"
else
  echo "  -> FAIL (/health did not return 2xx)"
  fail=1
fi

echo
echo "=== Phase 1 smoke — /intents (bearer auth) ==="
if curl -fsS \
  -H "Authorization: Bearer ${TALLYSEAL_BRIDGE_DEV_SECRET}" \
  "${BASE_URL}/api/tallyseal-bridge/intents?limit=10" | tee /dev/stderr; then
  echo
  echo "  -> PASS (expected empty array — intentLister.list returns [] in Phase 1)"
else
  echo "  -> FAIL (/intents did not return 2xx)"
  fail=1
fi

echo
if [[ "$fail" -eq 0 ]]; then
  echo "Phase 1 smoke: PASS"
  echo
  echo "NOTE: /intent/:id/events and /intent/:id/bundle* are NOT tested here —"
  echo "      they return 403 by design in Phase 1 (PrismaNoopProjection)."
  echo "      Phase 2 (TKT-PRISMA-ADAPTER-PRIMITIVES-10-14) wires the real"
  echo "      ProjectionPort and these endpoints become testable."
  exit 0
else
  echo "Phase 1 smoke: FAIL"
  exit 1
fi
