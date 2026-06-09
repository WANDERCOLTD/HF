# Runbook RB-1394 — Provision the monthly restore drill

**Owner:** operator (you) · **Created:** 2026-06-09 · **Source PR:** #1394 · **Companion:** [RB-1394-CLOUD-SQL-RESTORE.md](./RB-1394-CLOUD-SQL-RESTORE.md)

## Why this runbook exists

The drill script (`apps/admin/scripts/cloud-sql-restore-drill.sh`) is committed to the
repo but the **Cloud Run Job + Scheduler + Monitoring policies are shared infrastructure**.
Creating those is intentionally a manual operator step — they live in your GCP project,
not the repo. This runbook is the one-time provisioning recipe + the periodic re-deploy
recipe if the script changes.

## 0. Prereqs

- `gcloud auth login` as a user with `roles/cloudsql.admin`, `roles/run.admin`,
  `roles/iam.serviceAccountAdmin`, `roles/monitoring.alertPolicyEditor` on `hf-admin-prod`.
- The DB superuser password stored in Secret Manager as `cloud-sql-drill-db-password`.

```bash
# One-time: create the secret (skip if already present)
echo -n "<paste DB password>" | gcloud secrets create cloud-sql-drill-db-password \
  --data-file=- --project=hf-admin-prod --replication-policy=user-managed --locations=europe-west2
```

## 1. Service account for the drill

```bash
SA=cloud-sql-restore-drill
gcloud iam service-accounts create "$SA" \
  --display-name="Cloud SQL restore drill" \
  --project=hf-admin-prod

SA_EMAIL="${SA}@hf-admin-prod.iam.gserviceaccount.com"

# Only the rights the drill actually needs
for ROLE in \
  roles/cloudsql.editor \
  roles/cloudsql.client \
  roles/logging.logWriter \
  roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding hf-admin-prod \
    --member="serviceAccount:${SA_EMAIL}" --role="$ROLE" --condition=None
done

# Allow access to the drill password secret
gcloud secrets add-iam-policy-binding cloud-sql-drill-db-password \
  --member="serviceAccount:${SA_EMAIL}" \
  --role=roles/secretmanager.secretAccessor \
  --project=hf-admin-prod
```

## 2. Image for the drill (builds the drill script + cloud-sql-proxy + psql into a small image)

Minimal Dockerfile (commit if/when this story expands — currently inline):

```dockerfile
FROM google/cloud-sdk:slim
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client \
    && curl -fsSL https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.13.0/cloud-sql-proxy.linux.amd64 \
       -o /usr/local/bin/cloud-sql-proxy \
    && chmod +x /usr/local/bin/cloud-sql-proxy \
    && rm -rf /var/lib/apt/lists/*
COPY cloud-sql-restore-drill.sh /usr/local/bin/cloud-sql-restore-drill.sh
RUN chmod +x /usr/local/bin/cloud-sql-restore-drill.sh
ENTRYPOINT ["/usr/local/bin/cloud-sql-restore-drill.sh"]
```

Build & push:

```bash
cd apps/admin/scripts
cp cloud-sql-restore-drill.sh /tmp/build/   # or use docker -f path
gcloud builds submit /tmp/build \
  --tag=europe-west2-docker.pkg.dev/hf-admin-prod/hf/cloud-sql-restore-drill:latest \
  --project=hf-admin-prod
```

## 3. Cloud Run Job

```bash
gcloud run jobs create cloud-sql-restore-drill \
  --image=europe-west2-docker.pkg.dev/hf-admin-prod/hf/cloud-sql-restore-drill:latest \
  --region=europe-west2 \
  --service-account="${SA_EMAIL}" \
  --max-retries=0 \
  --task-timeout=30m \
  --memory=512Mi \
  --set-env-vars=PROJECT=hf-admin-prod,SOURCE_INSTANCE=hf-db,DRILL_DB=hf_sandbox,DB_USER=postgres,DB_PASSWORD_SECRET=cloud-sql-drill-db-password \
  --project=hf-admin-prod

# Manual test (do this once before scheduling)
gcloud run jobs execute cloud-sql-restore-drill --region=europe-west2 --wait --project=hf-admin-prod
```

## 4. Cloud Scheduler (monthly, 1st @ 03:00 UTC)

```bash
SCHED_SA=cloud-sql-restore-drill-scheduler
gcloud iam service-accounts create "$SCHED_SA" \
  --display-name="Cloud SQL restore drill — scheduler" \
  --project=hf-admin-prod
SCHED_SA_EMAIL="${SCHED_SA}@hf-admin-prod.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding hf-admin-prod \
  --member="serviceAccount:${SCHED_SA_EMAIL}" \
  --role=roles/run.invoker --condition=None

gcloud scheduler jobs create http cloud-sql-restore-drill-monthly \
  --schedule="0 3 1 * *" \
  --time-zone=UTC \
  --location=europe-west2 \
  --uri="https://europe-west2-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/hf-admin-prod/jobs/cloud-sql-restore-drill:run" \
  --http-method=POST \
  --oauth-service-account-email="${SCHED_SA_EMAIL}" \
  --project=hf-admin-prod
```

## 5. Monitoring policies

```bash
# Backup-missed policy (no SUCCESSFUL backup in 26h)
gcloud monitoring policies create \
  --notification-channels=<your channel id> \
  --display-name="cloud-sql-backup-missed" \
  --condition-display-name="hf-db missing daily backup" \
  --condition-threshold-filter='resource.type="cloudsql_database" resource.label.database_id="hf-admin-prod:hf-db" metric.type="cloudsql.googleapis.com/database/backup/successful_count"' \
  --condition-threshold-comparison=COMPARISON_LT \
  --condition-threshold-value=1 \
  --condition-threshold-duration=93600s

# Restore-drill failure policy (matches the structured ERROR log line)
gcloud logging metrics create cloud_sql_restore_drill_error \
  --description="Restore drill emitted severity=ERROR" \
  --log-filter='resource.type="cloud_run_job" resource.labels.job_name="cloud-sql-restore-drill" severity=ERROR' \
  --project=hf-admin-prod

# Then create an alert policy on that metric (Cloud Console is easier than gcloud here).
```

## 6. Verify

```bash
# Last 3 drill executions (status + duration)
gcloud run jobs executions list \
  --job=cloud-sql-restore-drill --region=europe-west2 \
  --project=hf-admin-prod --limit=3

# Drill log lines for the last execution
gcloud logging read 'resource.type="cloud_run_job" resource.labels.job_name="cloud-sql-restore-drill"' \
  --limit=20 --project=hf-admin-prod --freshness=2h
```

## When to re-run this runbook

- The drill script changes → rebuild the image (§2), re-deploy via `gcloud run jobs update`.
- A new env is provisioned (prod Cloud Run lands) → add another `DRILL_DB` value or a parallel job.
- The shared-instance assumption breaks (HF moves to per-env Cloud SQL) → revise the drill scope and update [RB-1394-CLOUD-SQL-RESTORE.md](./RB-1394-CLOUD-SQL-RESTORE.md) §1.
