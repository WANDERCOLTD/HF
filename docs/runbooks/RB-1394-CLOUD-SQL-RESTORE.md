# Runbook RB-1394 — Cloud SQL Restore (PITR + Drill)

**Owner:** operator (you) · **Created:** 2026-06-09 · **Issue:** [#1394](https://github.com/WANDERCOLTD/HF/issues/1394)

## Why this runbook exists

Phase 1 of the HF hardening program ([ADR 2026-06-09](../decisions/2026-06-09-tenancy-isolation-model.md))
requires **tested-restore** discipline. Until this runbook ran in anger at least once, our
backups were a rumour: 14 daily snapshots existed, but nobody had ever proven they restore
to a working state. This runbook is the *proof*, run monthly by the drill (§3), and the
*real* recovery procedure when a restore is needed (§2).

## 1. Current backup state (verified 2026-06-09)

```
Instance:    hf-db (single, shared)
Project:     hf-admin-prod
Region:      europe-west2
Tier:        db-f1-micro
Edition:     ENTERPRISE  ← required for functional PITR
Databases:   postgres, hf_sandbox, hf_staging   (no prod DB yet)
```

`gcloud sql instances describe hf-db`:

| Setting | Value |
|---|---|
| `backupConfiguration.enabled` | `true` |
| `backupConfiguration.startTime` | `02:00` UTC |
| `backupRetentionSettings.retainedBackups` | 14 |
| `pointInTimeRecoveryEnabled` | `true` |
| `replicationLogArchivingEnabled` | `true` |
| `transactionLogRetentionDays` | 7 |
| `transactionalLogStorageState` | `CLOUD_STORAGE` |

**RPO** (Recovery Point Objective): up to ~7 days via PITR; ~24h via snapshot.
**RTO** (Recovery Time Objective): ~10–20 min via `instances clone`; longer via in-place restore.

## 2. Real restore — "we need to recover production NOW"

**Scope landmine first.** `hf-db` is a *single instance* hosting multiple databases.
**Restoring `hf-db` in place wipes every database on it.** If you only need to recover
one database, **always clone first, dump the database you need, then drop the clone.**

### 2a. Clone to a PIT timestamp (preferred — non-destructive)

```bash
# Pick the timestamp you need (UTC, RFC3339). Must be within the last 7 days.
PIT="2026-06-09T13:45:00.000Z"
SRC="hf-db"
DST="hf-db-restore-$(date +%Y%m%d-%H%M)"

gcloud sql instances clone "$SRC" "$DST" \
  --point-in-time="$PIT" \
  --project=hf-admin-prod

# Optional: clone to a different project for isolation
#   --destination-project=hf-admin-disaster-recovery
```

The clone takes ~10 minutes (db-f1-micro). The new instance is fully isolated.

### 2b. Extract the database you need

```bash
# Cloud SQL Auth Proxy: avoids public IP exposure
gcloud sql instances describe "$DST" --format='value(connectionName)' > /tmp/conn
./cloud-sql-proxy "$(cat /tmp/conn)" --port 5433 &

# Dump the database (use the right name: hf_sandbox or hf_staging)
DB_NAME=hf_staging
PGPASSWORD="<from secret manager>" pg_dump \
  -h localhost -p 5433 -U postgres -d "$DB_NAME" \
  -Fc -f "/tmp/$DB_NAME.dump"
```

### 2c. Restore the dump into the target DB

⚠️ **CONFIRM the target before running.** A typo here can clobber live data.

```bash
# Target: a fresh DB on the same instance, or another instance
PGPASSWORD="<from secret manager>" pg_restore \
  -h localhost -p 5432 -U postgres -d "$DB_NAME_TARGET" \
  --clean --if-exists "/tmp/$DB_NAME.dump"
```

### 2d. Cleanup the clone

```bash
gcloud sql instances delete "$DST" --project=hf-admin-prod --quiet
```

### 2e. Snapshot-based restore (fallback, lower RPO precision)

If PITR isn't available or you need a specific daily snapshot:

```bash
gcloud sql backups list --instance=hf-db --limit=20
gcloud sql instances clone hf-db "hf-db-restore-$(date +%Y%m%d)" \
  --source-backup-id=<BACKUP_ID> \
  --project=hf-admin-prod
```

## 3. Monthly tested-restore drill

The drill proves the restore path keeps working. It runs **monthly** as a Cloud Run Job
on the 1st at 03:00 UTC (after the daily backup window). The script is
[`apps/admin/scripts/cloud-sql-restore-drill.sh`](../../apps/admin/scripts/cloud-sql-restore-drill.sh).

### What it does

1. Picks a PIT timestamp (latest available).
2. Clones `hf-db` → `hf-db-drill-YYYYMM` to PIT.
3. Connects via Cloud SQL Auth Proxy.
4. Runs sanity queries on `hf_sandbox`:
   - `SELECT COUNT(*) FROM "Caller"` must return ≥ 1
   - `SELECT MAX("createdAt") FROM "Call"` must be within 30 days of PIT
5. Records the result (timestamp, PIT used, durations, row counts) in an audit log entry.
6. Deletes the drill instance.
7. Posts result to Cloud Logging with severity:
   - `INFO` on success → no alert
   - `ERROR` on failure → alerts via the monitoring policy in §4

### Manual invocation (for first-time validation)

```bash
cd apps/admin
PROJECT=hf-admin-prod \
SOURCE_INSTANCE=hf-db \
DRILL_DB=hf_sandbox \
./scripts/cloud-sql-restore-drill.sh
```

Expect ~15 minutes wall-clock end-to-end.

### Audit log

The drill writes to `RestoreDrillRun` (new table; migration ships with this story).
A simple Prisma view in the admin UI (also new) shows the trailing 12 months.

## 4. Monitoring & alerting

Cloud Monitoring policies (provisioned by the operator — see §5):

| Policy | Condition | Severity | Routing |
|---|---|---|---|
| `cloud-sql-backup-missed` | No `SUCCESSFUL` automated backup in 26h | WARNING | email |
| `restore-drill-failed` | Cloud Logging `severity=ERROR resource.type=cloud_run_job log_name=…cloud-sql-restore-drill` | CRITICAL | pager |
| `instance-pitr-disabled` | `pointInTimeRecoveryEnabled` changes to `false` | CRITICAL | pager |

## 5. Provisioning the drill (one-time, operator)

See [RB-1394-DEPLOY.md](./RB-1394-RESTORE-DRILL-DEPLOY.md) for the gcloud commands to
deploy the Cloud Run Job + Cloud Scheduler trigger + Cloud Monitoring policies.

## When this runbook itself gets stale

Anyone running a real restore who finds a step missing / wrong: update this file in the
same PR as the recovery. The runbook is the artifact of every actual restore.
