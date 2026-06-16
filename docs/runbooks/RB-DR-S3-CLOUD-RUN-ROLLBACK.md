# Runbook RB-DR-S3 — Broken Cloud Run revision → traffic-split rollback

**Owner:** operator (you) · **Created:** 2026-06-16 · **Last verified:** 2026-06-16 (write-only — never executed in anger) · **Scenario:** 3 of 8 in [`docs/DR-POSTURE.md`](../DR-POSTURE.md)

## When to use this

A Cloud Run revision deployed and **traffic is now hitting broken code**: 5xx rate spiked, a critical page returns 500, the wizard refuses to advance, a route is missing or returning the wrong shape.

**Symptoms that point here, not elsewhere:**
- `gcloud run revisions list --service=<svc>` shows the latest revision serving 100% traffic
- `gcloud run revisions logs read <latest-revision>` shows errors immediately on request
- DB looks fine (`SELECT 1` works; data shape is correct) → not Scenario 1
- No seed ran near deploy → not Scenario 5

**Time budget: 60 seconds to rollback, < 5 min to verify.** This is the fastest of the 8 runbooks.

## Decision tree

```
Did the bad deploy include a schema migration?
├─ NO  → §A: traffic-split rollback (image only). Done in 60s.
└─ YES → §B: traffic-split rollback + assess migration safety
         Migrations are forward-only — the rollback REVISION may not work
         against the NEW schema. If it doesn't, this becomes Scenario 1.
```

## §A — Image-only rollback (most common path)

```bash
SVC="hf-admin"                # or hf-admin-dev / hf-admin-test
REGION="europe-west2"

# 1. List recent revisions, find the last-known-good
gcloud run revisions list --service="$SVC" --region="$REGION" --limit=10 \
  --format='table(metadata.name,status.conditions[0].lastTransitionTime,spec.containers[0].image)'

# 2. Pin traffic to the previous revision (60s)
PREV_REVISION="<paste-from-step-1>"
gcloud run services update-traffic "$SVC" \
  --region="$REGION" \
  --to-revisions="$PREV_REVISION=100"

# 3. Verify
curl -sf "https://<env>.humanfirstfoundation.com/api/health" | jq .
curl -sf "https://<env>.humanfirstfoundation.com/api/ready" | jq .
```

If `/api/health` returns 200, you're back to a known-good state. **Do not redeploy until you've identified the cause.**

## §B — Rollback when the bad deploy included a migration

```bash
# Check what migrations ran in the bad deploy:
gcloud run jobs executions list --job=hf-migrate-<env> --region="$REGION" --limit=3 \
  --format='value(name,startTime,status.completionTime)'

# Read the most recent migrate-job log to see which migrations applied:
gcloud run jobs executions logs read <latest-execution> --region="$REGION" | grep "Applying migration"
```

**Decision:**
- **Migration is additive only** (new table, new nullable column, new index) → the previous revision still works against the new schema. Run §A as normal. Roll forward later.
- **Migration is destructive** (dropped column, dropped table, NOT NULL added, type narrowed) → previous revision will break against the new schema. This is now also Scenario 1 (data corruption). Run §A to stop the bleeding, then jump to [`RB-DR-S1-BAD-MIGRATION-PITR.md`](./RB-DR-S1-BAD-MIGRATION-PITR.md) §A.

## Verification (after rollback)

```bash
# Traffic is now on the rolled-back revision
gcloud run services describe "$SVC" --region="$REGION" \
  --format='value(status.traffic)'
# Expect: 100% on the previous revision

# Health endpoints
curl -sf "https://<env>.humanfirstfoundation.com/api/health" | jq .
curl -sf "https://<env>.humanfirstfoundation.com/api/ready" | jq .

# A representative end-user surface still works
# (login → load /x/callers → click a caller → load tab)
```

## Post-incident (within 24h)

1. **File `dr-gap` issue** describing: which revision was bad, what error class, how long traffic was on it (compute from revision deploy time → rollback time).
2. **Verify the bad image is NOT auto-redeployed.** Cloud Run can re-route to a revision if `--no-traffic` is misread. Confirm the bad revision shows `0%` in `gcloud run services describe`.
3. **Forward-fix the underlying bug** in a new PR. The fix must include a test that would have caught this; otherwise the gh-pr-create gate will block (per `.claude/rules/verify-before-fix.md`).
4. **Update this runbook** if you learned anything (PR alongside the fix). Bump `Last verified` date.

## Related

- [`docs/DR-POSTURE.md`](../DR-POSTURE.md) — scenario index + targets
- [`docs/CLOUD-DEPLOYMENT.md`](../CLOUD-DEPLOYMENT.md) — Cloud Run service inventory
- [`RB-DR-S1-BAD-MIGRATION-PITR.md`](./RB-DR-S1-BAD-MIGRATION-PITR.md) — when rollback alone isn't enough
