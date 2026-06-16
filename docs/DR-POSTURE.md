# DR Posture

> Disaster recovery targets, scenario coverage, and known unmitigated risks for HF.
> Companion runbooks live in [`docs/runbooks/`](./runbooks/).
> Last verified: 2026-06-16.

## Targets (operator-locked)

| Target | Value | Source |
|---|---|---|
| **RPO** (data loss tolerance) | **5 minutes** | Cloud SQL PITR floor on `hf-db` (`europe-west2`, 7-day transaction log retention) |
| **RTO internal** (operational drill target) | **2 hours** | Measured ~30 min for `instances clone` on `db-f1-micro`; allows headroom for proxy-ready wait, smoke, schema check, human decision |
| **RTO external** (committed maximum if forced into an SLA) | **4 hours** | Conservative floor; do not commit to less without infra change |
| **Drill cadence** | **Monthly**, automated, 03:00 UTC on the 1st | Cloud Scheduler → `cloud-sql-restore-drill` Cloud Run Job |
| **Tabletop cadence** | **Annual**; output filed as `dr-gap`-tagged GitHub issue within 24h | Manual; see [`docs/runbooks/`](./runbooks/) post-tabletop |

## Scenario coverage

| # | Scenario | Mitigation | Runbook |
|---|---|---|---|
| 1 | Bad migration corrupts PROD data | PITR restore to pre-migration timestamp + forward-fix migration | `RB-1394-CLOUD-SQL-RESTORE.md` |
| 2 | Accidental `prisma db push --force-reset` on PROD | PITR restore | `RB-1394-CLOUD-SQL-RESTORE.md` |
| 3 | Broken Cloud Run revision in production | Traffic-split rollback (`gcloud run services update-traffic <svc> --to-revisions=PREV=100`) | TBD (DR-S3 #1757) |
| 4 | Secret leak (generic) | Rotate in source, bump Secret Manager version, redeploy Cloud Run service | TBD (DR-S3 #1757) |
| 5 | **Seed ran on PROD by accident** (highest blast radius) | PITR + delta-replay of writes between seed timestamp and recovery point | TBD (DR-S3 #1757 + DR-S6 tabletop scenario) |
| 6 | VAPI key rotation | Rotate in VAPI dashboard → bump `VAPI_API_KEY` Secret Manager version → **redeploy Cloud Run** (key baked into container env at revision creation; secret version bump alone is insufficient) | TBD (DR-S3 #1757) |
| 7 | Anthropic / OpenAI key rotation | Same shape as 6. **GDPR dimension:** call transcript content passes through these APIs; leaked key carries PII exposure | TBD (DR-S3 #1757) |
| 8 | Backup retention silent erosion | Cloud SQL transaction-log storage fills (counts against instance disk quota); GCP silently shrinks PITR window. Detection: monthly drill asserts `transactionLogRetentionDays == 7`. Recovery: investigate quota; expand instance disk | TBD (DR-S3 #1757) |

## Known unmitigated risks

### Single-region (`europe-west2`)

No cross-region replica. A region-level outage means accepting downtime until GCP restores the region (historically hours to days). **Cross-region trigger:** first paying customer with a contractual uptime commitment. Until then, this risk is explicitly accepted.

### GDPR §17 re-emergence after PITR

Once PROD has real users + right-to-be-forgotten (RTBF) requests fulfilled, a PITR restore re-introduces deleted PII rows. No deletion log exists today to replay deletions post-restore. Related: ADR [`2026-06-13-kms-envelope-encryption-prereq.md`](./decisions/2026-06-13-kms-envelope-encryption-prereq.md) (Accepted, not implemented). Must be addressed before PROD provisions and before first PROD RTBF request.

### Unguarded Cloud Run job invocation path

`gcloud run jobs execute hf-seed --region=europe-west2` has no env-target guard, unlike `/db-route` / `/db-switch`. A tired operator running this command from history against the wrong job binding could trigger scenario #5 above. This is the highest-blast-radius unguarded path in the stack and the explicit scenario for the DR-S6 tabletop.

### `RestoreDrillRun` audit surface missing

[`RB-1394-CLOUD-SQL-RESTORE.md`](./runbooks/RB-1394-CLOUD-SQL-RESTORE.md) §3 references a `RestoreDrillRun` table that does not exist in `prisma/schema.prisma`. Drill results currently flow to Cloud Logging only — no queryable in-app surface to check "did last month's drill pass?". DR-S4 (#1758) builds the model.

### Cross-environment restore drill (PROD → TEST)

Not exercised today. Catches IAM, VPC, and Secret-binding bugs that same-env drills miss. Committed-future obligation: add when PROD provisions.

## References

- [`docs/runbooks/RB-1394-CLOUD-SQL-RESTORE.md`](./runbooks/RB-1394-CLOUD-SQL-RESTORE.md) — clone-first restore procedure (the canonical recovery runbook)
- [`docs/runbooks/RB-1394-RESTORE-DRILL-DEPLOY.md`](./runbooks/RB-1394-RESTORE-DRILL-DEPLOY.md) — Cloud Run Job + Cloud Scheduler deployment
- [`docs/CLOUD-DEPLOYMENT.md`](./CLOUD-DEPLOYMENT.md) — infrastructure topology
- Epic [#1761](https://github.com/WANDERCOLTD/HF/issues/1761) — DR posture
- Sibling epic [#1723](https://github.com/WANDERCOLTD/HF/issues/1723) — release pipeline
