# Runbook RB-DR-S1 — Bad migration corrupts data → PITR restore

**Owner:** operator (you) · **Created:** 2026-06-16 · **Last verified:** 2026-06-16 (write-only — never executed in anger) · **Scenario:** 1 of 8 in [`docs/DR-POSTURE.md`](../DR-POSTURE.md)

## When to use this

A Prisma migration deployed to PROD (or DEV/TEST during validation) and **data is now wrong**: a backfill flipped values, a column got nullified incorrectly, a cascade deleted more than expected, an `ALTER TABLE` rewrote rows in a way the seed couldn't replay.

**Symptoms that point here, not elsewhere:**
- The 5xx rate is **not** elevated (Cloud Run revision is healthy) → not Scenario 3
- No seed job ran near the failure timestamp → not Scenario 5
- The schema change applied successfully (`prisma migrate status` shows the migration in the applied list)
- A `SELECT COUNT(*) FROM "AffectedTable"` returns wrong numbers OR `SELECT … LIMIT 10` shows garbled values

## Decision tree

```
Is the migration COMMITTED but not yet applied to PROD?
├─ YES  → revert the commit, write a new forward-fix migration. No PITR needed.
└─ NO (already applied)
   │
   Did users write rows AFTER the migration ran?
   ├─ NO  (within minutes, low traffic) → §A: clone-and-promote (clean restore)
   └─ YES → §B: clone + delta-replay (preserves user writes; complex)
```

## §A — Clean restore (no user writes after migration)

Use when traffic is low and you can confirm `SELECT … FROM <table> WHERE "updatedAt" > '<migration timestamp>'` returns zero or near-zero rows.

```bash
# 1. Identify the exact migration timestamp from Cloud Build / Cloud Run logs
#    OR from the migrations table:
#    SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;
MIGRATION_TS="2026-06-16T14:32:00.000Z"     # ← edit
PIT_BEFORE="2026-06-16T14:31:00.000Z"        # 1 minute before — gives clean cutpoint

# 2. Clone hf-db to the pre-migration point in time
SRC="hf-db"
DST="hf-db-rollback-$(date +%Y%m%d-%H%M)"
gcloud sql instances clone "$SRC" "$DST" \
  --point-in-time="$PIT_BEFORE" \
  --project=hf-admin-prod

# 3. Wait for clone to be RUNNABLE (~10 min)
gcloud sql instances describe "$DST" --format='value(state)' \
  | grep -E "RUNNABLE" || echo "still creating..."

# 4. Verify the clone has pre-migration shape:
#    `_prisma_migrations` table should NOT contain the offending migration row.
./cloud-sql-proxy "$(gcloud sql instances describe "$DST" --format='value(connectionName)')" --port 5433 &
PGPASSWORD="<from Secret Manager>" psql -h localhost -p 5433 -U postgres -d hf_prod \
  -c "SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;"
# Expect: the bad migration is ABSENT.

# 5. Dump the database from the clone
PGPASSWORD="<...>" pg_dump -h localhost -p 5433 -U postgres -d hf_prod \
  -Fc -f /tmp/hf_prod_clean.dump

# 6. Restore into the LIVE hf-db (separate proxy on a different port)
./cloud-sql-proxy "$(gcloud sql instances describe hf-db --format='value(connectionName)')" --port 5432 &
PGPASSWORD="<...>" pg_restore -h localhost -p 5432 -U postgres -d hf_prod \
  --clean --if-exists /tmp/hf_prod_clean.dump

# 7. Drop the clone
gcloud sql instances delete "$DST" --project=hf-admin-prod --quiet

# 8. Write a forward-fix migration that does the migration's INTENT correctly
#    (do NOT just re-apply the broken one — it'll re-corrupt)
```

## §B — Clone + delta-replay (user writes preserved)

Use when traffic was active during the corruption window and you can't afford to lose user writes.

This procedure is **complex** and requires per-table reasoning. Document each step in the post-incident ticket.

```bash
# 1. Identify all tables affected by the bad migration (read the migration SQL).
#    For each affected table:
#    - Are there UPDATE/DELETE statements? Those mutated rows can't be cleanly recovered.
#    - Are there ALTER COLUMN (NOT NULL with default)? Those rewrote ALL rows.

# 2. Clone to pre-migration PIT as in §A step 1–4.

# 3. For each table NOT affected by destructive ops, replay user writes:
#    Export rows with createdAt > MIGRATION_TS from the LIVE (corrupted) DB:
PGPASSWORD="<...>" psql -h localhost -p 5432 -U postgres -d hf_prod \
  -c "\COPY (SELECT * FROM \"Call\" WHERE \"createdAt\" > '$MIGRATION_TS') TO '/tmp/calls_after.csv' WITH CSV HEADER"

#    Restore the CLEAN dump as in §A step 5–6.
#    Then re-insert the post-migration rows into the now-clean DB:
PGPASSWORD="<...>" psql -h localhost -p 5432 -U postgres -d hf_prod \
  -c "\COPY \"Call\" FROM '/tmp/calls_after.csv' WITH CSV HEADER"

# 4. For tables WITH destructive ops in the migration: user writes between migration
#    and now MAY be lost. Quantify the loss; document; communicate to affected users.
```

## Verification (after restore — before declaring done)

```bash
# Migration history must NOT show the bad migration
PGPASSWORD="<...>" psql -h localhost -p 5432 -U postgres -d hf_prod \
  -c "SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;"

# Sentinel row count: pick a table the bad migration affected, compare to known-good baseline
PGPASSWORD="<...>" psql -h localhost -p 5432 -U postgres -d hf_prod \
  -c "SELECT COUNT(*) FROM \"AffectedTable\";"

# `/api/health` returns 200
curl -sf "$(gcloud run services describe hf-admin --region=europe-west2 --format='value(status.url)')/api/health"

# A representative learner-scoped query returns expected data
# (run a known curl probe against /api/callers/<id>)
```

## Post-incident (within 24h)

1. **File `dr-gap` issue** describing: which table was affected, how long the corruption was live, what the forward-fix migration was, whether any user writes were lost.
2. **Update this runbook** with anything you learned (PR alongside the fix). Bump `Last verified` date.
3. **Add a guard** if the migration shape was preventable: e.g., a Prisma migration linting rule, a destructive-op detector, an integration test.

## Related

- [`docs/runbooks/RB-1394-CLOUD-SQL-RESTORE.md`](./RB-1394-CLOUD-SQL-RESTORE.md) — the canonical PITR procedure this runbook builds on
- [`docs/DR-POSTURE.md`](../DR-POSTURE.md) — RPO/RTO targets and scenario index
- [`apps/admin/scripts/check-migration-has-backfill.ts`](../../apps/admin/scripts/check-migration-has-backfill.ts) — the PR-time gate that prevents most cases that lead here (S5 #1728, when shipped)
