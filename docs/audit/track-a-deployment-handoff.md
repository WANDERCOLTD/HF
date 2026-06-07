# Audit-fix Track A — operator handoff

Status: code lands via PR. Two items below require **gcloud / Cloud Console action** to fully ship — they are not in the merge.

## Shipped in the PR (no operator action needed)

| # | Change | Files |
|---|---|---|
| A1 | Caller-detail route capped: `calls` 50 → 25; new `take: 200` on uncapped `callerTarget`; `composedPrompt` lookup scoped to the returned-call window | `app/api/callers/[callerId]/route.ts` |
| A2 | ComposedPrompt demote-then-create wrapped in `$transaction` so two concurrent recomposes can't both stamp `status: "active"` | `lib/prompt/composition/persist.ts` |
| A7 | New `POST /api/cron/cleanup-usage-events` endpoint wires the existing-but-unused `cleanupOldUsageData()` to a HTTP trigger (dual auth: ADMIN session OR `x-internal-secret`) | `app/api/cron/cleanup-usage-events/route.ts` |
| A8 | Partial index `CallerAttribute_active_idx ON (callerId, key) WHERE validUntil IS NULL` | `prisma/migrations/20260607114630_a8_caller_attribute_active_index/migration.sql` |
| B0 (investigation) | Findings doc for the Domain migration backfill — not yet implemented | `docs/audit/b0-domain-migration-investigation.md` |

## Operator actions still needed

### A3 — `DATABASE_URL` connection pool parameters

The audit's concurrency stress test predicted the Cloud SQL pool dies at ~30 concurrent calls because Prisma defaults to one connection per Node instance, then multiplies by N Cloud Run instances, and Cloud SQL caps total connections. Adding `?connection_limit=5&pool_timeout=20` to `DATABASE_URL` makes the pool behaviour explicit and survivable.

**For each env**, append the params to the existing `DATABASE_URL` secret value. Append, do not replace — the existing user / password / host / db is correct, you're just adding query params.

```bash
# DEV — hf-admin-dev → hf_sandbox
gcloud secrets versions access latest --secret=DATABASE_URL_STAGING   # read current
# Then create a new version with the params appended:
# postgresql://<user>:<pw>@<host>:5432/hf_sandbox?schema=public&connection_limit=5&pool_timeout=20
echo -n 'postgresql://<paste-current>?schema=public&connection_limit=5&pool_timeout=20' \
  | gcloud secrets versions add DATABASE_URL_STAGING --data-file=-

# Repeat for hf-admin-test (hf_staging) and hf-admin (hf_prod):
#   gcloud secrets versions add DATABASE_URL_TEST --data-file=- < ...
#   gcloud secrets versions add DATABASE_URL_PROD --data-file=- < ...
```

Cloud Run picks up secret changes on next deploy. Force a deploy with `gcloud run services update-traffic <service> --to-latest --region europe-west2` if needed.

### A7 — Cloud Scheduler job for the cleanup endpoint

The endpoint exists after this PR merges. Schedule it once daily at 03:00 UTC against each environment that should keep its UsageEvent volume in check:

```bash
# Replace <ENV-URL> with dev.humanfirstfoundation.com / test.humanfirstfoundation.com /
# lab.humanfirstfoundation.com per the env.
# Replace <SECRET> with `gcloud secrets versions access latest --secret=INTERNAL_API_SECRET`.

gcloud scheduler jobs create http hf-cleanup-usage-events-dev \
  --location=europe-west2 \
  --schedule='0 3 * * *' \
  --time-zone='UTC' \
  --uri='https://dev.humanfirstfoundation.com/api/cron/cleanup-usage-events' \
  --http-method=POST \
  --headers="x-internal-secret=<SECRET>,Content-Type=application/json" \
  --message-body='{}' \
  --attempt-deadline='5m' \
  --max-retry-attempts=2
```

Verify with a manual trigger:

```bash
gcloud scheduler jobs run hf-cleanup-usage-events-dev --location=europe-west2
gcloud scheduler jobs describe hf-cleanup-usage-events-dev --location=europe-west2
```

The endpoint returns `{ ok: true, summary: { eventsDeleted, hourlyRollupsDeleted } }` — surfaced in Cloud Scheduler's job logs and `/api/metering/events` shortly after.

## Verification after operator action

| Action | Verify |
|---|---|
| A3 in dev | New `DATABASE_URL` version is `enabled`; `hf-admin-dev` deploy succeeds; concurrent-call sim (`scripts/sim-drive-call.ts` × 30) no longer trips `P1001 connection pool timeout` |
| A3 in test/prod | Same checks, plus monitor Cloud SQL connection count for ~1 day post-deploy |
| A7 in dev | After first scheduled run: `SELECT COUNT(*) FROM "UsageEvent" WHERE "createdAt" < NOW() - INTERVAL '30 days'` returns 0; the response body's `eventsDeleted` matches the prior count |
| A7 in test/prod | Same; if 30d feels too aggressive, pass `eventRetentionDays` in the body via Cloud Scheduler `--message-body` |

## Rollback

| Action | Rollback |
|---|---|
| A3 | Revert `DATABASE_URL` to its previous version: `gcloud secrets versions disable <new-version> --secret=DATABASE_URL_STAGING` |
| A7 | `gcloud scheduler jobs delete hf-cleanup-usage-events-dev --location=europe-west2`. The endpoint code stays — no schema or behaviour change to undo. |

## Owner / paging

- **A3**: hf-platform on-call. Cloud SQL connection issues page on the existing `cloudsql.connections` alert.
- **A7**: no paging — failure is benign (just no cleanup that day). Monitor weekly via the Cloud Scheduler job dashboard.
