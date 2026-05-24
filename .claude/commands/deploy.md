---
description: Deploy to Cloud Run — environment-aware (dev, test, prod)
---

Interactive deployment guide for GCP Cloud Run. Supports 3 environments.

> **Manual-only deploy.** All environments (DEV, TEST, PROD) deploy manually via `/deploy`. Pushing to `main` does NOT trigger a deploy — `deploy-dev.yml` / `deploy-test.yml` / `deploy-prod.yml` only run on `workflow_dispatch`. This is deliberate: VM dev iteration (`/vm-cp`, `/vm-cpp`) should not cascade to Cloud Run.

## CRITICAL: Environment Selection

**ALWAYS ask which environment FIRST.** Never assume. Use AskUserQuestion:

**Question:** "Which environment are you deploying to?"
**Header:** "Environment"
**multiSelect:** false

Options:
1. **STAGING (Recommended)** — dev.humanfirstfoundation.com — daily-driver cloud env, will move to staging.humanfirstfoundation.com in #726 Phase 4
2. **PILOT** — *not yet provisioned* — see #726 Phase 5 (target: pilot.humanfirstfoundation.com)
3. **PROD** — *not yet provisioned* — see #726 Phase 6 (target: app.humanfirstfoundation.com)

> **Transition state (#726):** The cloud "DEV" env was conceptually renamed to STAGING but the underlying Cloud Run service, jobs, and secret are still named with `-dev` suffix until Phase 4 cuts over. Until then, `/deploy STAGING` actually targets `hf-admin-dev`.

## Environment Map (current — transitional)

| Env (conceptual) | Domain | Service | Seed Job | Migrate Job | DB Secret | Seed Profile | `_APP_ENV` |
|------------------|--------|---------|----------|-------------|-----------|--------------|------------|
| STAGING | dev.humanfirstfoundation.com | `hf-admin-dev` *(renames to `hf-admin-staging` in Phase 4)* | `hf-seed-dev` | `hf-migrate-dev` | `DATABASE_URL_DEV` *(renames to `DATABASE_URL_STAGING` in Phase 4)* | `full` | `STAGING` (legacy `DEV` still works) |
| PILOT | (provision in Phase 5) | `hf-admin-pilot` | `hf-seed-pilot` | `hf-migrate-pilot` | `DATABASE_URL_PILOT` | `blank-ielts` | `PILOT` |
| PROD | (provision in Phase 6) | `hf-admin-prod` | `hf-seed-prod` | `hf-migrate-prod` | `DATABASE_URL_PROD` | `core` | `PROD` |

All environments:
- **GCP Project**: `hf-admin-prod`
- **Region**: `europe-west2`
- **Artifact Registry**: `europe-west2-docker.pkg.dev/hf-admin-prod/hf-docker/`

## MANDATORY: Deploy Gate (run BEFORE asking deploy action)

**⚠️ CRITICAL: After the user picks an environment, run the full deploy-gate script against that env BEFORE offering any deploy action.** One single command replaces what used to be four separate manual guards. It exists because last night (2026-04-15) a missing migration shipped to dev undetected — the previous inline migration-status check had escape hatches that let broken deploys through.

```bash
cd apps/admin && npm run deploy:gate <env>
# where <env> is: dev | test | prod
```

What the gate runs (in order, fail-fast):

1. **`npx tsc --noEmit`** — catches TypeScript errors before Cloud Build wastes a round-trip
2. **`npm run lint`** — catches style + unused-import errors
3. **`npm run test`** — unit tests (vitest)
4. **Migration diff against target Cloud SQL** — fetches the matching secret from Secret Manager (`DATABASE_URL_DEV` / `_TEST` / `""`) in a subshell, runs `prisma migrate status` against the real target DB. Never falls back to local `.env`. Parses output; pending migrations or drift → FAIL.
5. **Smoke-env against the current live URL** — hits `/api/health`, `/api/ready`, `/api/system/readiness`, `/api/system/ini`. Any non-2xx or schema-drift error → FAIL. This is the safety net that catches "column does not exist" errors from mismatched deploys.

**If deploy-gate exits non-zero: STOP.** Print the gate output to the user and refuse to proceed. Do NOT offer Quick deploy, Full deploy, or any other option until the gates are green.

If the migration gate (gate 4) specifically fails with "pending migrations" or "drift detected": force the user into **Full deploy**. Do NOT offer Quick deploy as an option. Message:
> ⚠️ Pending migrations detected on `$ENV`. Quick deploy is disabled — you must run Full deploy so the migrate job applies them. This guard exists because code-only deploys against an un-migrated DB cause runtime Prisma errors (`column does not exist`) that aren't caught by simple health checks.

**Never skip the gate**, even if the user insists it's "just a code change". The only legitimate bypass is to fix the failing gate first — if gate 4 fails, run Full deploy to apply the migration, then re-run `/deploy` which will show a clean gate.

**If gcloud cannot reach Secret Manager** (auth/permissions), the gate fails on gate 4. Do NOT fall back to local `.env`. Tell the user the gate could not run and ask them to grant Secret Manager access or run the gate on the VM.

### Why a script, not inline bash

Previously this check was 20 lines of inline shell in the skill, and kept getting skipped or half-run when the skill was interrupted. The script is committed at `apps/admin/scripts/deploy-gate.sh` so CI, cron, and humans can all run the exact same gates. If the script is ever modified, that change shows up in git diff and can be reviewed.

After environment selection and the migration guard, ask the deploy action:

**Question:** "What deploy action do you need?"
**Header:** "Deploy"
**multiSelect:** false

Options:
1. **Pre-flight check** — Build, env vars, schema, Docker, auth coverage — verify readiness
2. **Quick deploy** — Code-only change, no schema or spec changes
3. **Full deploy** — Schema + specs + code (migrate → seed → deploy)
4. **Rollback** — Revert to a previous Cloud Run revision
5. **Seed only** — Re-run seed job with a chosen profile (no code deploy)

Based on the user's choice, walk them through the exact commands step by step. Always confirm before executing any command.

**Note:** If the user picks "Quick deploy" or "Full deploy", automatically run smoke tests after. "Check status" is still available via "Other".

## IMPORTANT: No local Docker — builds run on VM

Docker is NOT available locally or on the VM. ALL image builds MUST use **Cloud Build** with the permanent configs in `apps/admin/`:

- `cloudbuild-all.yaml` — **Full deploy**: builds migrate + seed + runner in one submission (shared Kaniko cache, seed + runner parallel after migrate warms deps)
- `cloudbuild-runner.yaml` — **Quick deploy**: runner image only (same shared cache)
- `cloudbuild-seed.yaml` — seed image only (legacy, prefer cloudbuild-all.yaml)
- `cloudbuild-migrate.yaml` — migrate image only (legacy, prefer cloudbuild-all.yaml)

All configs use a **shared Kaniko cache repo** (`hf-shared-cache`) — the `deps` layer (npm ci) is cached for 30 days and shared across all targets. Code-only changes skip npm ci entirely.

## PERFORMANCE: Run Cloud Build from VM (not local)

**Always run `gcloud builds submit` via SSH on hf-dev**, not locally. The VM is already on GCP so Cloud Build gets the source instantly (no ~30MB upload over the internet).

Pattern for all image builds:
```bash
gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap -- bash -c '
  cd ~/HF/apps/admin && gcloud builds submit --config <CONFIG>.yaml \
    --project hf-admin-prod --region europe-west2 \
    --substitutions=<SUBS> .
'
```

**Before building, ensure the VM has the latest code** — run `git pull` on the VM first (or use `/vm-pull`). The VM must be in sync with what you're deploying.

The remaining `gcloud run deploy`, `gcloud run jobs execute`, smoke tests, and Cloudflare purge can still run locally — they don't upload source.

## Pre-flight Check Steps (option 1)

### 1. Build
```bash
cd apps/admin && npm run build
```
Report: PASS or list of build errors.

### 2. Prisma Schema
```bash
cd apps/admin && npx prisma validate
```
Report: PASS or validation errors.

### 3. Migration Status
```bash
cd apps/admin && npx prisma migrate status
```
Report: any pending migrations.

### 4. Seed Scripts
Verify seed files exist: `prisma/seed-full.ts` (orchestrator), `prisma/seed-clean.ts`.

### 5. Docker
Check Dockerfile exists and has the 3 targets: `runner`, `seed`, `migrate`.

### 6. Auth Coverage
```bash
cd apps/admin && npm run test -- tests/lib/route-auth-coverage.test.ts
```
All routes must be protected before deploying.

Report: `Deploy Check: READY (6/6)` or list blockers with fix instructions.

## Quick Deploy Steps (option 2)

Use `$SERVICE` from the environment map (e.g. `hf-admin-dev` for DEV).

### 1. Version bump + commit + push
```bash
cd apps/admin && npx tsx scripts/bump-version.ts
```
Stage and commit the version bump, then push.

### 2. Build runner image via Cloud Build (on VM)

First ensure VM has latest code, then build:
```bash
gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap -- bash -c '
  cd ~/HF && git pull --rebase &&
  cd apps/admin && gcloud builds submit --config cloudbuild-runner.yaml \
    --project hf-admin-prod --region europe-west2 \
    --substitutions=_TAG=latest,_APP_ENV=$APP_ENV .
'
```

Set `$APP_ENV` from the `_APP_ENV` column in the Environment Map (STAGING→`STAGING`, PILOT→`PILOT`, PROD→`PROD`). Legacy `DEV`/`TEST`/`LIVE` values are still accepted by the runtime for one transition release.

### 3. Deploy to target environment
```bash
gcloud run deploy $SERVICE \
  --image=europe-west2-docker.pkg.dev/hf-admin-prod/hf-docker/hf-admin:latest \
  --region=europe-west2 --project=hf-admin-prod \
  --no-cpu-throttling
```

### 4. Seed after deploy (optional)

Ask the user whether to seed after deploying:

**Question:** "Seed the database after deploy?"
**Header:** "Seed"
**multiSelect:** false

Options:
1. **Skip** — Deploy code only, leave data as-is
2. **demo** — Clean demo data (golden school + demo course + demo logins, no e2e junk)
3. **full** — Everything including e2e fixtures (DEV/TEST only)
4. **core** — Specs + contracts only (safe for PROD)
5. **blank-ielts** — Specs + "IELTS Prep Lab" institution only (no courses, no callers) — partner-test bootstrap

If the user picks a seed profile, rebuild the seed image and run the seed job:

```bash
# Build seed image (on VM — uses shared cache, deps already cached from runner build)
gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap -- "cd ~/HF/apps/admin && gcloud builds submit --config cloudbuild-seed.yaml --project hf-admin-prod --region europe-west2 --substitutions=_TAG=latest ."

# Execute seed job
gcloud run jobs update $SEED_JOB \
  --set-env-vars=SEED_PROFILE=$SELECTED_PROFILE \
  --region=europe-west2 --project=hf-admin-prod
gcloud run jobs execute $SEED_JOB --region=europe-west2 --project=hf-admin-prod --wait
```

**Guard:** If the user picks `full` for PROD or `core` for DEV, warn them — it's likely not what they want.

## Full Deploy Steps (option 3)

### 1. Version bump + commit + push

Same as Quick Deploy step 1.

### 2. Build ALL images in one submission (on VM)

**⚠️ Always rebuild before running migrate/seed jobs.** The `:latest` tags may be stale. `cloudbuild-all.yaml` builds migrate first (warms deps cache), then seed + runner in parallel — one source upload, one npm ci.

```bash
gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap -- "cd ~/HF && git pull --rebase && cd apps/admin && gcloud builds submit --config cloudbuild-all.yaml --project hf-admin-prod --region europe-west2 --substitutions=_TAG=latest,_APP_ENV=\$APP_ENV ."
```

Set `$APP_ENV` from the `_APP_ENV` column in the Environment Map (STAGING→`STAGING`, PILOT→`PILOT`, PROD→`PROD`). Legacy `DEV`/`TEST`/`LIVE` values are still accepted by the runtime for one transition release.

### 3. Run migrate job
```bash
gcloud run jobs execute $MIGRATE_JOB --region=europe-west2 --project=hf-admin-prod --wait
```

### 4. Run seed job
```bash
gcloud run jobs update $SEED_JOB \
  --set-env-vars=SEED_PROFILE=$SEED_PROFILE \
  --region=europe-west2 --project=hf-admin-prod
gcloud run jobs execute $SEED_JOB --region=europe-west2 --project=hf-admin-prod --wait
```

### 5. Deploy runner to Cloud Run
```bash
gcloud run deploy $SERVICE \
  --image=europe-west2-docker.pkg.dev/hf-admin-prod/hf-docker/hf-admin:latest \
  --region=europe-west2 --project=hf-admin-prod \
  --no-cpu-throttling
```

## Seed Only Steps (option 5)

Re-run the seed job against an environment without deploying code. Useful for resetting demo data or syncing DEV with the VM's dataset.

### 1. Pick seed profile

**Question:** "Which seed profile?"
**Header:** "Seed Profile"
**multiSelect:** false

Options:
1. **demo** — Golden school + demo course + demo logins (no e2e junk) — matches VM `SEED_PROFILE=demo`
2. **full** — Everything including e2e fixtures
3. **core** — Specs + contracts only
4. **golden** — Specs + 1 clean institution (Abacus Academy)
5. **blank-ielts** — Specs + IELTS Prep Lab institution only (no courses, no callers)

**Guard:** Block `full` or `demo` for PROD. Block `core` for DEV (likely not what you want — warn and confirm).

### 2. Rebuild seed image (on VM)

The `:latest` seed image may be stale. Always rebuild before running:

```bash
gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap -- "cd ~/HF && git pull --rebase && cd apps/admin && gcloud builds submit --config cloudbuild-seed.yaml --project hf-admin-prod --region europe-west2 --substitutions=_TAG=latest ."
```

### 3. Run seed job

```bash
gcloud run jobs update $SEED_JOB \
  --set-env-vars=SEED_PROFILE=$SELECTED_PROFILE \
  --region=europe-west2 --project=hf-admin-prod
gcloud run jobs execute $SEED_JOB --region=europe-west2 --project=hf-admin-prod --wait
```

### 4. Smoke test

Run the same smoke tests as after a deploy to verify the seeded data didn't break anything.

## Rollback Steps (option 4)

```bash
gcloud run revisions list --service=$SERVICE --region=europe-west2 --project=hf-admin-prod
# Then ask user which revision to roll back to
gcloud run services update-traffic $SERVICE \
  --to-revisions=REVISION_NAME=100 \
  --region=europe-west2 --project=hf-admin-prod
```

## Smoke Test Steps (auto after deploy)

Use the **direct Cloud Run URL** (bypasses Cloudflare):

| Env | Direct URL |
|-----|-----------|
| STAGING | `https://hf-admin-dev-nqep3i44ra-nw.a.run.app` *(infra renames in Phase 4)* |
| PILOT | `https://hf-admin-pilot-nqep3i44ra-nw.a.run.app` *(after Phase 5)* |
| PROD | `https://hf-admin-prod-nqep3i44ra-nw.a.run.app` *(after Phase 6)* |

```bash
APP_URL="<direct URL from table above>"
curl -f "$APP_URL/api/health"
curl -f "$APP_URL/api/ready"
curl -f "$APP_URL/api/system/readiness"
```

## Cloudflare Cache Purge (auto after deploy)

After every successful deploy, purge the Cloudflare cache so users see the new version immediately:

```bash
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/a75655f1818c73eaaecc232b1076dbf3/purge_cache" \
  -H "X-Auth-Email: paul@thewanders.com" \
  -H "X-Auth-Key: 1422f925b4284c70c43a15fca3e08d10fdc9b" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}'
```

## Check Status Steps (via "Other")

```bash
# All Cloud Run services
gcloud run services list --project=hf-admin-prod --region=europe-west2

# Specific service revisions
gcloud run revisions list --service=$SERVICE --region=europe-west2 --project=hf-admin-prod --limit=5

# Deploy drift — what's waiting to go out
git log --oneline deploy-latest..HEAD 2>/dev/null || echo "No deploy-latest tag found"
```

## Deploy Tagging

After every successful deploy, tag the commit:

```bash
# Move the rolling tag to current commit
git tag -f deploy-$ENV-latest   # e.g. deploy-dev-latest
git push origin deploy-$ENV-latest --force

# Also create a timestamped tag for history
git tag deploy-$ENV-$(date +%Y%m%d-%H%M%S)
git push origin deploy-$ENV-$(date +%Y%m%d-%H%M%S)
```

## Safety Rules

- ALWAYS ask which environment FIRST — never assume
- ALWAYS run the pending-migration guard (`npx prisma migrate status`) after env selection, BEFORE offering Quick/Full — block Quick if anything is pending
- ALWAYS run `git pull origin main` FIRST before any deploy step
- ALWAYS check for uncommitted changes (`git status`) — warn if dirty
- ALWAYS confirm with the user before running any command
- ALWAYS purge Cloudflare cache after deploy
- NEVER run `prisma migrate reset` or `prisma db push --force-reset` against any environment
- After every deploy, run smoke tests automatically
- After every successful deploy, run deploy tagging
- If any step fails, stop and diagnose — don't continue
- For PROD deploys, add an extra confirmation: "You are deploying to PRODUCTION (app.humanfirstfoundation.com). Are you sure?"
- Cloud Build uses Kaniko layer caching (30-day TTL). First build after a cache miss is slow; subsequent code-only builds skip npm ci. If a deploy uses stale cached layers, clear the cache repos in Artifact Registry.
