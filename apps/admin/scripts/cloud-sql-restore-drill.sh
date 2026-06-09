#!/usr/bin/env bash
# KB: catalogued in docs/kb/guard-registry.md (CI check scripts). See for class + why.
#
# cloud-sql-restore-drill.sh — monthly tested-restore drill for hf-db.
# Runbook: docs/runbooks/RB-1394-CLOUD-SQL-RESTORE.md
# Issue: #1394
#
# Run as a Cloud Run Job (see RB-1394-RESTORE-DRILL-DEPLOY.md) OR locally for
# first-time validation. Picks a PIT, clones hf-db, runs sanity SQL, deletes
# the clone, emits a structured log line for the alerting policy.
#
# Exit codes:
#   0  drill succeeded — clone, sanity, cleanup all green
#   1  setup failed (gcloud, auth, env vars)
#   2  clone failed (PITR window, tier restriction, quota)
#   3  sanity query failed (data integrity concern OR proxy/auth failed)
#   4  cleanup failed (drill instance left behind — operator must delete)
set -euo pipefail

# ---------------- config ----------------
PROJECT="${PROJECT:-hf-admin-prod}"
SOURCE_INSTANCE="${SOURCE_INSTANCE:-hf-db}"
DRILL_DB="${DRILL_DB:-hf_sandbox}"
DB_USER="${DB_USER:-postgres}"
# Drill instance name — month-based so a re-run in the same month is a no-op clone-conflict
DRILL_INSTANCE="${DRILL_INSTANCE:-hf-db-drill-$(date -u +%Y%m)}"
# PIT: default to 1 hour ago (safely within the 7-day window, after any in-flight backups)
PIT="${PIT:-$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)}"
PROXY_PORT="${PROXY_PORT:-5433}"
LOG_PREFIX="[restore-drill]"

# ---------------- helpers ---------------
log()   { echo "$LOG_PREFIX $*"; }
fail()  { local code=$1; shift; log "FAIL: $*"; emit_log ERROR "$*"; exit "$code"; }
ok()    { log "OK: $*"; }

# Structured log line for Cloud Logging — matches the alerting policy in RB-1394 §4.
emit_log() {
  local severity=$1; shift
  local msg=$*
  cat <<JSON
{"severity":"$severity","message":"$msg","drill":{"instance":"$DRILL_INSTANCE","pit":"$PIT","source":"$SOURCE_INSTANCE","db":"$DRILL_DB","startedAt":"$START_ISO"}}
JSON
}

# ---------------- preflight -------------
START_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
START_EPOCH=$(date +%s)
log "start  source=$SOURCE_INSTANCE  drill=$DRILL_INSTANCE  pit=$PIT  db=$DRILL_DB"

command -v gcloud >/dev/null   || fail 1 "gcloud not on PATH"
command -v psql   >/dev/null   || fail 1 "psql not on PATH"
command -v cloud-sql-proxy >/dev/null || command -v cloud_sql_proxy >/dev/null \
  || fail 1 "cloud-sql-proxy not on PATH"
PROXY_BIN=$(command -v cloud-sql-proxy 2>/dev/null || command -v cloud_sql_proxy)

# Resolve the DB password (secret manager in CI; env var locally)
if [[ -z "${DB_PASSWORD:-}" ]]; then
  if [[ -n "${DB_PASSWORD_SECRET:-}" ]]; then
    DB_PASSWORD=$(gcloud secrets versions access latest --secret="$DB_PASSWORD_SECRET" --project="$PROJECT")
  else
    fail 1 "neither DB_PASSWORD nor DB_PASSWORD_SECRET set"
  fi
fi

# ---------------- clone -----------------
log "cloning to PIT $PIT (expect ~10min on db-f1-micro)"
if ! gcloud sql instances clone "$SOURCE_INSTANCE" "$DRILL_INSTANCE" \
       --point-in-time="$PIT" \
       --project="$PROJECT" \
       --quiet 2>&1; then
  fail 2 "clone failed — check PITR window, quota, or tier restrictions"
fi
ok "clone complete"

# ---------------- sanity SQL -------------
CONN=$(gcloud sql instances describe "$DRILL_INSTANCE" --project="$PROJECT" --format='value(connectionName)')
log "starting auth proxy on :$PROXY_PORT  conn=$CONN"
"$PROXY_BIN" "$CONN" --port "$PROXY_PORT" >/tmp/restore-drill-proxy.log 2>&1 &
PROXY_PID=$!
trap '[[ -n "${PROXY_PID:-}" ]] && kill "$PROXY_PID" 2>/dev/null || true' EXIT
sleep 6  # let the proxy come up

cleanup_clone() {
  log "deleting drill instance $DRILL_INSTANCE"
  if ! gcloud sql instances delete "$DRILL_INSTANCE" --project="$PROJECT" --quiet 2>&1; then
    fail 4 "cleanup failed — drill instance $DRILL_INSTANCE left behind, delete manually"
  fi
  ok "drill instance deleted"
}

if ! PGPASSWORD="$DB_PASSWORD" psql \
       -h localhost -p "$PROXY_PORT" -U "$DB_USER" -d "$DRILL_DB" \
       -v ON_ERROR_STOP=1 -At >/tmp/restore-drill-sanity.txt 2>&1 <<'SQL'
SELECT 'caller_count: ' || COUNT(*) FROM "Caller";
SELECT 'latest_call: ' || COALESCE(MAX("createdAt")::text, 'NONE') FROM "Call";
SELECT 'most_recent_user: ' || COALESCE(MAX("createdAt")::text, 'NONE') FROM "User";
SQL
then
  cleanup_clone
  fail 3 "sanity SQL failed — $(tail -3 /tmp/restore-drill-sanity.txt | tr '\n' '|')"
fi

CALLER_COUNT=$(grep -oE 'caller_count: [0-9]+' /tmp/restore-drill-sanity.txt | grep -oE '[0-9]+$' || echo 0)
LATEST_CALL=$(grep -oE 'latest_call: \S+' /tmp/restore-drill-sanity.txt | sed -E 's/^latest_call: //')

if (( CALLER_COUNT < 1 )); then
  cleanup_clone
  fail 3 "sanity floor breached — Caller row count = $CALLER_COUNT (expected >= 1)"
fi
ok "sanity: $CALLER_COUNT callers, latest call $LATEST_CALL"

# ---------------- cleanup ----------------
kill "$PROXY_PID" 2>/dev/null || true
PROXY_PID=
cleanup_clone

# ---------------- success log -----------
DUR=$(( $(date +%s) - START_EPOCH ))
log "drill GREEN  duration=${DUR}s  callers=$CALLER_COUNT  latestCall=$LATEST_CALL"
emit_log INFO "restore drill green — callers=$CALLER_COUNT durationS=$DUR pit=$PIT"
