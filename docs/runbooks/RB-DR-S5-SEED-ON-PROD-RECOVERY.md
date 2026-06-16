# Runbook RB-DR-S5 — Seed ran on PROD by accident → PITR + delta-replay

**Owner:** operator (you) · **Created:** 2026-06-16 · **Last verified:** 2026-06-16 (write-only — never executed in anger) · **Scenario:** 5 of 8 in [`docs/DR-POSTURE.md`](../DR-POSTURE.md) — **highest blast radius**

## When to use this

Someone ran `gcloud run jobs execute hf-seed --region=europe-west2 --wait` against the **PROD** seed job by accident. Or the staging seed job's `DATABASE_URL_STAGING` was misbound and pointed at the PROD database.

**Why this is the worst-blast-radius scenario in HF today:**
- The seed scripts UPSERT — they don't wipe — but they DO mutate existing rows when properties differ from spec defaults (e.g., voice config, parameter weights, default playbook config)
- The `gcloud run jobs execute` command has **no env-target guard** (unlike `/db-route` / `/db-switch`)
- A tired operator running this from command history is the most-feasible production-disaster path

## Detection (you may not know this happened immediately)

**Symptoms:**
- Operators report demo callers showing wrong voice / wrong playbook config
- ComposedPrompt content reverted to a stale seed shape
- New spec rows appeared in PROD that match the demo cohort (Bertie, IELTS)
- `AppLog` shows entries with `subject: 'seed.*'` near a recent timestamp

**Confirm:**
```bash
# 1. Did any seed job execution complete in the suspect window?
gcloud run jobs executions list --job=hf-seed-prod --region=europe-west2 --limit=5 \
  --format='table(name,startTime,status.completionTime,status.conditions[0].type)'

# 2. If yes, read the log to see what profile ran and against which DB
gcloud run jobs executions logs read <execution-name> --region=europe-west2 \
  | head -50
# Look for: SEED_PROFILE=<...> and the first line of seed-full.ts output
```

## Decision tree

```
Did the seed job execution complete or fail mid-run?
├─ Failed mid-run → partial mutation. Same procedure but smaller blast.
└─ Completed
   │
   What's the elapsed time since seed completion?
   ├─ < 5 min  AND  zero user writes since  → §A: simple PITR restore
   ├─ < 1 hour AND  trace-able user writes  → §B: PITR + delta-replay
   └─ > 1 hour OR untrace-able writes       → §C: damage-control + assess
```

## §A — Simple PITR (rare — only if you caught it within minutes)

```bash
# 1. Identify exact seed start time from the Cloud Run job execution
SEED_START="<from Cloud Run execution startTime>"      # RFC3339 UTC
PIT_BEFORE=$(date -u -d "$SEED_START - 1 minute" +"%Y-%m-%dT%H:%M:%SZ")

# 2. Stop traffic to the affected service (prevent new user writes)
gcloud run services update-traffic hf-admin --region=europe-west2 --to-revisions=PREV=0
# (this is aggressive — you're taking PROD offline. Acceptable for §A given the < 5 min window)

# 3. Clone hf-db to pre-seed PIT (see RB-1394-CLOUD-SQL-RESTORE.md §2a)
gcloud sql instances clone hf-db "hf-db-pre-seed-$(date +%Y%m%d-%H%M)" \
  --point-in-time="$PIT_BEFORE" --project=hf-admin-prod

# 4. Verify the clone (see RB-1394 §2b) — no seed traces in AppLog after PIT
# 5. Dump + restore the clone over hf_prod (see RB-1394 §2c, §2d)
# 6. Bring traffic back online
gcloud run services update-traffic hf-admin --region=europe-west2 --to-revisions=LATEST=100
```

## §B — PITR + delta-replay (most likely path)

This is what the **DR-S6 tabletop exercise** rehearses. The hard part: identifying and re-applying user writes that landed between the seed timestamp and recovery.

```bash
SEED_START="<from execution startTime>"
PIT_BEFORE=$(date -u -d "$SEED_START - 1 minute" +"%Y-%m-%dT%H:%M:%SZ")

# 1. Identify tables the seed touches (read seed-full.ts step list).
#    For PROD-relevant SEED_PROFILE=core: spec rows, RunConfig, default voices.
#    For SEED_PROFILE=demo or full: also Caller, Playbook, ComposedPrompt, demo logins.

# 2. Quantify the delta — for each touched table, count rows with createdAt/updatedAt > $SEED_START
PGPASSWORD="<...>" psql -h proxy -d hf_prod -c "
SELECT 'Call' AS table, COUNT(*) FROM \"Call\" WHERE \"updatedAt\" > '$SEED_START'
UNION ALL SELECT 'CallerAttribute', COUNT(*) FROM \"CallerAttribute\" WHERE \"validFrom\" > '$SEED_START'
UNION ALL SELECT 'ComposedPrompt', COUNT(*) FROM \"ComposedPrompt\" WHERE \"createdAt\" > '$SEED_START'
-- add more tables as relevant
;"

# 3. For each table with user writes: export the affected rows BEFORE restoring
#    (this is the "save the irreplaceable" step)
PGPASSWORD="<...>" psql -h proxy -d hf_prod -c "
\\COPY (SELECT * FROM \"Call\" WHERE \"createdAt\" > '$SEED_START') TO '/tmp/calls_after_seed.csv' WITH CSV HEADER
"
# Repeat for each affected table.

# 4. Clone hf-db to PIT_BEFORE; verify clone; dump; restore over live hf_prod
#    (see RB-DR-S1 §A steps 2–7)

# 5. Re-insert the saved user writes
#    CAUTION: foreign-key order matters. Insert in this order generally:
#    Caller → Call → CallerAttribute → ComposedPrompt → BehaviorMeasurement
PGPASSWORD="<...>" psql -h proxy -d hf_prod -c "
\\COPY \"Call\" FROM '/tmp/calls_after_seed.csv' WITH CSV HEADER
"
# Repeat per table.

# 6. Verify each replayed row resolves its foreign keys
PGPASSWORD="<...>" psql -h proxy -d hf_prod -c "
SELECT c.id FROM \"Call\" c LEFT JOIN \"Caller\" ca ON c.\"callerId\" = ca.id
WHERE c.\"createdAt\" > '$SEED_START' AND ca.id IS NULL;
"
# Expect: 0 rows. Any result means a Call lost its Caller link → escalate to §C.
```

## §C — Damage control (> 1 hour or untraceable writes)

If the seed has been live for hours and you can't enumerate user writes:

1. **Stop further damage:** disable the PROD seed job binding immediately.
   ```bash
   # Rotate DATABASE_URL_PROD to a value the seed job can't reach
   # (or delete the IAM role allowing job execution against the PROD job)
   ```
2. **Document the corrupt window** in a `dr-gap` issue. Affected user-visible columns + estimated impact.
3. **Communicate to affected users.** GDPR / data-accuracy obligation if user-visible content reverted.
4. **Decide:** restore from PITR and accept all user writes from the window are lost, OR live with the seed-mutated state and forward-fix specific rows.
5. **This decision is a stakeholder conversation, not a technical one.** Document the reasoning in the post-incident report.

## Pre-incident prevention (open work)

Today the `gcloud run jobs execute hf-seed-prod` path has no env-target guard. Mitigations to consider (file as `sev-2` or fold into DR-S3 #1757 once a hardening story is filed):

1. **Wrap the PROD seed job invocation** in a script that checks an env-confirmation flag (e.g., requires `--target=PROD --i-mean-production-really`).
2. **Make the seed-clean.ts script self-aware:** if `NODE_ENV=production` AND `FORCE_PROD_SEED` is not set, exit 1 with a loud message.
3. **Tighten IAM on the PROD seed job:** require a separate role assertion to execute, so a routine GCP login can't fire it.
4. **The `/db-route` + `/db-switch` refusals are for the Cloud Run service DATABASE_URL bindings — they do NOT cover direct `gcloud run jobs execute` invocation.** Document this gap in `docs/DR-POSTURE.md` (already flagged 2026-06-16).

## Verification (after recovery)

```bash
# No seed entries in AppLog after the recovery PIT
PGPASSWORD="<...>" psql -h proxy -d hf_prod -c "
SELECT subject, timestamp FROM \"AppLog\"
WHERE subject LIKE 'seed.%' AND timestamp > '$PIT_BEFORE'
ORDER BY timestamp DESC LIMIT 10;
"

# Spec row checksums match pre-seed state
# (you'll need to define what "pre-seed state" looks like — captured by the regular monthly drill)

# A representative user's data is intact — login + load /x/callers → click a known active caller
```

## Post-incident (within 24h)

1. **File `dr-gap` issue** with the full timeline, blast-radius assessment, and recovery decision.
2. **File a hardening story** for one of the pre-incident prevention items above.
3. **Run the DR-S6 tabletop** with the actual incident as the scenario — this is your most-valuable rehearsal data.
4. **Bump `Last verified` date** on this runbook.

## Related

- [`docs/DR-POSTURE.md`](../DR-POSTURE.md) — scenario index + the unguarded `gcloud run jobs execute` documented risk
- [`docs/runbooks/RB-1394-CLOUD-SQL-RESTORE.md`](./RB-1394-CLOUD-SQL-RESTORE.md) — PITR fundamentals this builds on
- [`RB-DR-S1-BAD-MIGRATION-PITR.md`](./RB-DR-S1-BAD-MIGRATION-PITR.md) — sibling scenario; same PITR mechanics, smaller blast
- Future DR-S6 tabletop exercise (#1760) — this scenario is the chosen target
