#!/usr/bin/env bash
# check-adaptive-loop-health.sh — daily Adaptive Loop invariant scanner (epic #1510 Slice 1, #1511).
#
# Reads last-7d AppLog rows with stage LIKE 'pipeline.invariant.%' and reports
# counts per invariant (I-AL1..I-AL5). WARN-only — does NOT block deploys today.
# Cadence + gating decision lands with Slice 4 (#1514 canary) once the structural
# fix slices (#1512 / #1513) have driven the WARN counts down.
#
# Exit codes:
#   0 — scan completed (regardless of counts)
#   2 — invocation error or DB unreachable
#
# Usage:
#   ./scripts/check-adaptive-loop-health.sh                   — human report
#   ./scripts/check-adaptive-loop-health.sh --json            — JSON payload
#   DATABASE_URL=postgres://… ./scripts/check-adaptive-loop-health.sh
#
# Reads the same AppLog table the /x/help/pipeline-health dashboard reads from.
# Mirror in `apps/admin/scripts/audit-epic-100.ts` exposes the counts as audit
# counters (iAL1..iAL5).

set -euo pipefail

JSON=0
for arg in "$@"; do
  case "$arg" in
    --json) JSON=1 ;;
    -h|--help)
      sed -n '1,30p' "$0"
      exit 0
      ;;
  esac
done

if [[ -z "${DATABASE_URL:-}" ]]; then
  if [[ -f "apps/admin/.env" ]]; then
    # shellcheck disable=SC2046,SC2002
    export $(grep -E '^DATABASE_URL=' apps/admin/.env | head -1)
  fi
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[adaptive-loop-health] WARN: DATABASE_URL not set; skipping." >&2
  exit 2
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "[adaptive-loop-health] WARN: psql not installed; skipping." >&2
  exit 2
fi

# Pull counts per stage. The runner writes stage `pipeline.invariant.i-al<n>`
# and severity in the `level` column.
SQL=$(cat <<'SQL'
SELECT
  stage,
  level,
  COUNT(*) AS event_count,
  MIN("createdAt") AS first_seen,
  MAX("createdAt") AS last_seen
FROM "AppLog"
WHERE stage LIKE 'pipeline.invariant.%'
  AND "createdAt" >= NOW() - INTERVAL '7 days'
GROUP BY stage, level
ORDER BY stage, level;
SQL
)

if ! ROWS=$(psql "$DATABASE_URL" -At -F'|' -c "$SQL" 2>/dev/null); then
  echo "[adaptive-loop-health] WARN: psql query failed; skipping." >&2
  exit 2
fi

if [[ "$JSON" -eq 1 ]]; then
  echo "{"
  echo "  \"generatedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"window\": \"last-7-days\","
  echo "  \"rows\": ["
  FIRST=1
  while IFS='|' read -r stage level count first last; do
    [[ -z "$stage" ]] && continue
    if [[ "$FIRST" -eq 1 ]]; then FIRST=0; else echo ","; fi
    printf '    {"stage":"%s","level":"%s","count":%s,"firstSeen":"%s","lastSeen":"%s"}' \
      "$stage" "$level" "$count" "$first" "$last"
  done <<< "$ROWS"
  echo ""
  echo "  ]"
  echo "}"
  exit 0
fi

echo "=== Adaptive Loop invariant scan (last 7 days) ==="
echo ""
if [[ -z "$ROWS" ]]; then
  echo "  No invariant rows in the last 7 days."
  echo "  (Either the loop is clean, or no pipeline runs have completed since the runner shipped.)"
  exit 0
fi
printf "  %-32s %-7s %8s   %s\n" "stage" "level" "count" "last-seen"
while IFS='|' read -r stage level count first last; do
  [[ -z "$stage" ]] && continue
  printf "  %-32s %-7s %8s   %s\n" "$stage" "$level" "$count" "$last"
done <<< "$ROWS"
echo ""
echo "[adaptive-loop-health] scan complete. WARN-only — does not block deploy."
exit 0
