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
# `gcloud sql instances clone` waits synchronously but caps at ~10 min, while
# db-f1-micro clones routinely take 30+ min. CLOUDSDK_CORE_OPERATION_TIMEOUT
# does NOT apply to `gcloud sql`. Solution: submit --async, then use the
# purpose-built `gcloud sql operations wait` which has a `--timeout` knob and
# clean exit-code semantics (0 = success, non-zero = error). 60-minute ceiling
# is well above observed clone times.
# (#1394 spike + #1412 follow-up — the prior --format='value(error.errors[0]...)'
# parse returned a tab when fields were empty, which `[ -n "$ERR" ]` saw as
# non-empty and triggered a false failure. operations wait avoids the parsing
# trap entirely.)
CLONE_TIMEOUT=3600

log "cloning to PIT $PIT (async; will wait up to $((CLONE_TIMEOUT / 60))min for op)"
OP_ID=$(gcloud sql instances clone "$SOURCE_INSTANCE" "$DRILL_INSTANCE" \
          --point-in-time="$PIT" --project="$PROJECT" --async \
          --format='value(name)' 2>&1) || fail 2 "clone submit failed: $OP_ID"
log "clone op submitted: $OP_ID"

if ! gcloud sql operations wait "$OP_ID" --project="$PROJECT" --timeout="$CLONE_TIMEOUT" 2>&1; then
  fail 2 "clone op failed or exceeded ${CLONE_TIMEOUT}s — gcloud sql operations describe $OP_ID --project=$PROJECT"
fi
ok "clone complete"

# ---------------- sanity SQL -------------
CONN=$(gcloud sql instances describe "$DRILL_INSTANCE" --project="$PROJECT" --format='value(connectionName)')
log "starting auth proxy on :$PROXY_PORT  conn=$CONN"
# --private-ip: hf-db is a private-IP instance; clones inherit. Public IP is
# off (verified `gcloud sql instances describe hf-db` 2026-06-09). Without
# this flag the proxy errors "instance does not have IP of type 'PUBLIC'".
# The Cloud Run Job must also have a VPC connector with egress to reach the
# private IP — see RB-1394-DEPLOY.md § 3.
"$PROXY_BIN" "$CONN" --port "$PROXY_PORT" --private-ip >/tmp/restore-drill-proxy.log 2>&1 &
PROXY_PID=$!
trap '[[ -n "${PROXY_PID:-}" ]] && kill "$PROXY_PID" 2>/dev/null || true' EXIT
# Wait for the proxy + cloned DB to actually accept connections, not just
# "be running." On a cold Cloud Run container against a freshly-cloned
# db-f1-micro, the Cloud SQL backend itself can need 10-20s to accept
# connections after the proxy starts. A naive `sleep 6` produced
# "server closed the connection unexpectedly" mid-handshake (#1394, observed
# 2026-06-09 — final exit(3) bug after PR #1415).
log "waiting for proxy + cloned DB to accept connections (max 60s)"
PROXY_READY=0
for try in $(seq 1 12); do
  # Probe against $DRILL_DB, not the hardcoded `postgres` maintenance DB.
  # The drill SA's password (extracted from DATABASE_URL_SANDBOX) belongs
  # to `hf_user`, which has access to `hf_sandbox` and `hf_staging` but NOT
  # to the `postgres` maintenance DB. Hardcoding `postgres` here produced
  # auth failures during the 2026-06-09 #1394 deploy: proxy connected
  # ("Accepted connection") but Postgres rejected the user, psql disconnected,
  # readiness loop timed out. Use the DB we're actually going to query.
  if PGPASSWORD="$DB_PASSWORD" psql -h localhost -p "$PROXY_PORT" \
       -U "$DB_USER" -d "$DRILL_DB" -c 'SELECT 1' >/dev/null 2>&1; then
    PROXY_READY=1
    ok "proxy + DB ready after ~$((try * 5))s"
    break
  fi
  sleep 5
done
if [[ "$PROXY_READY" != "1" ]]; then
  cat /tmp/restore-drill-proxy.log 2>/dev/null | tail -5
  fail 3 "proxy + DB did not accept connections within 60s"
fi

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
