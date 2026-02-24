# Cloud Deployment: Data & Seeding Guide

**Last Updated**: 2026-02-14
**Status**: Live (market test)

This document covers the data architecture, seed process, and exact steps needed to bootstrap a fresh cloud instance. Read this before deploying.

---

## Architecture: Database is the Runtime Source of Truth

```
docs-archive/bdd-specs/*.spec.json  ──seed──►  Database  ◄──runtime──  Application
     (bootstrap material)                    (source of truth)         (reads DB only)
```

- **51 spec files** define parameters, analysis specs, scoring anchors, prompt slugs
- **3 contract files** define data contracts (curriculum progress, learner profile, content trust)
- After seeding, the application reads ONLY from the database — never from disk at runtime
- The `docs-archive/bdd-specs/` folder is NOT needed on the production server after initial seed
- All spec edits happen in DB via the admin UI or API

---

## What Gets Seeded

| Step | Script | Creates | Required? |
|------|--------|---------|-----------|
| 1 | `prisma migrate deploy` | Database tables (23 migrations) | YES |
| 2 | `seed-from-specs.ts` | Contracts → SystemSettings, Specs → Parameters + AnalysisSpecs + Anchors + PromptSlugs + BDDFeatureSets | YES |
| 3 | `seed-domains.ts` | 4 domains (Tutor, Support, Sales, Wellness) | YES |
| 4 | `seed-clean.ts` (transcripts) | Callers + Calls from `transcripts/` dir | NO (optional) |

### What seed-from-specs creates (Step 2)

From 51 `.spec.json` files:
- **Parameters** (~200+) — measurement dimensions (Big Five, VARK, style, supervision scores)
- **AnalysisSpecs** (~51) — the spec definitions with configs, triggers, actions
- **ScoringAnchors** — per-parameter scoring rubrics
- **PromptSlugs** — named prompt templates for composition
- **BDDFeatureSets** — the raw spec JSON stored for reference

From 3 `.contract.json` files:
- **SystemSettings** (key: `contract:CURRICULUM_PROGRESS_V1`) — curriculum data contract
- **SystemSettings** (key: `contract:LEARNER_PROFILE_V1`) — learner profile data contract
- **SystemSettings** (key: `contract:CONTENT_TRUST_V1`) — content trust data contract

### What seed-domains creates (Step 3)

| Domain | Slug | Default? |
|--------|------|----------|
| Tutor | `tutor` | Yes |
| Support | `support` | No |
| Sales | `sales` | No |
| Wellness | `wellness` | No |

---

## Minimum Viable Seed Sequence

```bash
# 1. Apply schema migrations
npx prisma migrate deploy

# 2. Seed specs + contracts (the big one)
npx tsx prisma/seed-clean.ts

# 3. Seed domains
npx tsx prisma/seed-domains.ts
```

That's it. Three commands. After this, the system is fully functional.

---

## Environment Variables

### Required (system will not start without these)

| Variable | Example | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/hf?schema=public` | PostgreSQL connection string |
| `HF_SUPERADMIN_TOKEN` | `openssl rand -hex 32` | Admin API access token |

### Required for AI features

| Variable | Example | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | `sk-...` | OpenAI API key (embeddings + completions) |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Anthropic API key (optional, for Claude) |

### Canonical Spec Slugs (all have sensible defaults)

These are env-overridable but you should never need to change them unless running multiple instances with different spec sets.

| Variable | Default | Description |
|----------|---------|-------------|
| `ONBOARDING_SPEC_SLUG` | `INIT-001` | Onboarding spec (personas, welcome flow) |
| `PIPELINE_SPEC_SLUG` | `PIPELINE-001` | Pipeline stage configuration |
| `PIPELINE_FALLBACK_SPEC_SLUG` | `GUARD-001` | Legacy pipeline fallback |
| `COMPOSE_SPEC_SLUG` | `system-compose-next-prompt` | Prompt composition spec |
| `VOICE_SPEC_SLUG_PATTERN` | `voice` | Voice/identity spec pattern match |
| `ONBOARDING_SLUG_PREFIX` | `init.` | Persona prompt slug prefix |

### Application

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Public-facing URL |
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | Environment (`production` on cloud) |
| `HF_OPS_ENABLED` | `false` | Enable filesystem operations |
| `HF_KB_PATH` | `../../knowledge` | Knowledge base directory |

### AI Model Overrides (optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_MODEL_ID` | `gpt-4o` | OpenAI model |
| `CLAUDE_MODEL_ID` | `claude-sonnet-4-20250514` | Claude model |
| `AI_DEFAULT_MAX_TOKENS` | `1024` | Default max tokens |
| `AI_DEFAULT_TEMPERATURE` | `0.7` | Default temperature |

---

## Docker Image: What's Included vs What's Not

The production Docker image (`Dockerfile`) produces a minimal Next.js standalone build.

### Included in the image

- `server.js` — compiled Next.js server
- `.next/static/` — static assets
- `public/` — public assets
- `prisma/schema.prisma` + `prisma/migrations/` — for `migrate deploy`

### NOT included in the image

- `docs-archive/bdd-specs/` — spec files (needed for seeding)
- `prisma/seed-from-specs.ts`, `prisma/seed-clean.ts`, `prisma/seed-domains.ts` — seed scripts
- `scripts/` — utility scripts
- `node_modules/` (full) — only standalone deps are included
- `tsx` — TypeScript executor (dev dependency)

### Consequence

**You cannot run `npm run db:seed` inside the production container.** Seeding must happen from a separate context that has access to the full codebase and dev dependencies.

---

## Cloud Seeding Options

### Option A: Seed from local machine (simplest for market test)

Connect your local machine to the remote database and run seeds locally.

```bash
# 1. SSH tunnel to remote PostgreSQL
ssh -L 5433:localhost:5432 hf@your-server.com

# 2. In another terminal, point to the tunnel
cd apps/admin
DATABASE_URL="postgresql://hf_user:PASSWORD@localhost:5433/hf?schema=public" \
  npx prisma migrate deploy

DATABASE_URL="postgresql://hf_user:PASSWORD@localhost:5433/hf?schema=public" \
  npx tsx prisma/seed-clean.ts

DATABASE_URL="postgresql://hf_user:PASSWORD@localhost:5433/hf?schema=public" \
  npx tsx prisma/seed-domains.ts
```

**Pros**: No Docker changes needed, works today
**Cons**: Requires SSH access and local dev environment

### Option B: Seed container in docker-compose (recommended for CI/CD)

Add a one-shot seed service to `docker-compose.yml` that uses the full builder image:

```yaml
services:
  seed:
    build:
      context: .
      dockerfile: Dockerfile.seed
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public
    depends_on:
      postgres:
        condition: service_healthy
    profiles:
      - seed  # only runs when explicitly called
```

Run with: `docker compose --profile seed run --rm seed`

### Option C: Multi-stage Dockerfile with seed target

Add a seed target to the existing Dockerfile (see "Dockerfile Changes" below).

---

## Verification Checklist

After seeding, verify the database is properly populated:

```bash
# Connect to the database and check counts
docker compose exec postgres psql -U hf_user hf -c "
  SELECT 'AnalysisSpec' as table_name, COUNT(*) as count FROM \"AnalysisSpec\"
  UNION ALL
  SELECT 'Parameter', COUNT(*) FROM \"Parameter\"
  UNION ALL
  SELECT 'PromptSlug', COUNT(*) FROM \"PromptSlug\"
  UNION ALL
  SELECT 'Domain', COUNT(*) FROM \"Domain\"
  UNION ALL
  SELECT 'SystemSetting', COUNT(*) FROM \"SystemSetting\" WHERE key LIKE 'contract:%'
  ORDER BY table_name;
"
```

Expected minimums:

| Table | Expected Count | What it means |
|-------|---------------|---------------|
| AnalysisSpec | ~51 | One per spec file |
| Parameter | ~200+ | All measurement parameters |
| PromptSlug | 30+ | Named prompt templates |
| Domain | 4 | Tutor, Support, Sales, Wellness |
| SystemSetting (contracts) | 3 | Curriculum, Learner Profile, Content Trust |

### API Health Check

```bash
# Basic health
curl https://your-server.com/api/health

# Onboarding spec loaded
curl https://your-server.com/api/onboarding
# Should return: { "ok": true, "source": "database", ... }

# Parameters loaded
curl https://your-server.com/api/parameters/display-config
# Should return grouped parameters
```

---

## Files That Matter

### Seed scripts (run once, then DB is authoritative)

| File | Purpose | When to run |
|------|---------|-------------|
| `prisma/seed-from-specs.ts` | Engine: reads spec files, creates all derived records | Called by seed-clean.ts |
| `prisma/seed-clean.ts` | Entry point: calls seedFromSpecs() + optional transcripts | `npm run db:seed` |
| `prisma/seed-domains.ts` | Creates base domains | After seed-clean.ts |
| `prisma/reset.ts` | Wipes all data (preserves schema) | Only for full reset |

### Spec files (bootstrap material, not needed at runtime)

| Path | Count | Content |
|------|-------|---------|
| `docs-archive/bdd-specs/*.spec.json` | 51 | BDD spec definitions |
| `docs-archive/bdd-specs/contracts/*.contract.json` | 3 | Data contracts |

### Config (runtime)

| File | Purpose |
|------|---------|
| `lib/config.ts` | Centralized env var access with defaults |
| `.env.example` | Template for all environment variables |

### Admin UI tools (alternative to CLI seeding)

| Route | Purpose |
|-------|---------|
| `/x/admin/spec-sync` | Import/sync specs from files to DB |
| `/api/x/seed-system` | Full system bootstrap via API |
| `/api/x/seed-domains` | Create domains via API |

---

## Deployment Sequence (Market Test)

```
1. Provision server + PostgreSQL
2. Configure .env (see Environment Variables above)
3. Deploy Docker image (docker compose up -d)
4. Run migrations (prisma migrate deploy)
5. Seed from local machine via SSH tunnel (Option A)
6. Verify (check counts + API health)
7. Create admin user
8. Ready for callers
```

---

## What Happens If Seeding Fails

| Symptom | Cause | Fix |
|---------|-------|-----|
| API returns 404 for `/api/onboarding` | INIT-001 spec not seeded | Run seed-clean.ts or import via `/x/admin/spec-sync` |
| Pipeline fails with "spec not found" | PIPELINE-001 not in DB | Run seed-clean.ts |
| "Contract not loaded" errors | Contracts not in SystemSettings | Run seed-clean.ts (seeds contracts first) |
| No parameters in data dictionary | Parameters not created from specs | Run seed-clean.ts |
| "No domains found" | Domains not seeded | Run seed-domains.ts |

---

## Post-Seed: How Data Evolves

After the initial seed, new data enters the system through:

1. **Callers** — created when phone calls come in via VAPI integration
2. **Calls** — created per conversation, with transcripts
3. **Pipeline runs** — EXTRACT/AGGREGATE/REWARD/ADAPT/COMPOSE stages process calls
4. **Personality profiles** — built from pipeline measurements over time
5. **Memories** — extracted from call transcripts
6. **Spec edits** — admins modify specs via UI (changes go to DB, not files)

No re-seeding is needed after initial setup unless you want to add new spec files.

---

## Live Infrastructure (3 Environments)

All 3 environments live in the same GCP project (`hf-admin-prod`, region `europe-west2`). Public URLs route through a **Cloudflare Tunnel** (`00d2c2cc-...`), NOT directly to Cloud Run.

| Env | Domain | Cloud Run Service | DB Secret | Seed Job | Migrate Job |
|-----|--------|-------------------|-----------|----------|-------------|
| **DEV** | `dev.humanfirstfoundation.com` | `hf-admin-dev` | `DATABASE_URL_DEV` | `hf-seed-dev` | `hf-migrate-dev` |
| **TEST** | `test.humanfirstfoundation.com` | `hf-admin-test` | `DATABASE_URL_TEST` | `hf-seed-test` | `hf-migrate-test` |
| **PROD** | `lab.humanfirstfoundation.com` | `hf-admin` | `DATABASE_URL` | `hf-seed` | `hf-migrate` |

### Shared Infrastructure

| Resource | Details |
|----------|---------|
| **Cloud SQL** | `hf-db` — PostgreSQL 16, db-f1-micro, private IP only (172.23.0.3). Separate databases per env. |
| **VPC Connector** | `hf-connector` — bridges Cloud Run → Cloud SQL |
| **Artifact Registry** | `europe-west2-docker.pkg.dev/hf-admin-prod/hf-docker/` |
| **Secrets Manager** | `DATABASE_URL`, `DATABASE_URL_DEV`, `DATABASE_URL_TEST`, `AUTH_SECRET`, `HF_SUPERADMIN_TOKEN` |
| **Cloudflare** | Zone `humanfirstfoundation.com`, Tunnel `00d2c2cc-...` routes all 3 domains |

### Environment-Specific Deploy Commands

```bash
# Deploy to a specific environment (interactive — asks which env)
# Use the /deploy slash command in Claude Code

# Manual: deploy to DEV
gcloud run deploy hf-admin-dev \
  --image=europe-west2-docker.pkg.dev/hf-admin-prod/hf-docker/hf-admin:latest \
  --region=europe-west2

# Manual: run migrations on TEST
gcloud run jobs execute hf-migrate-test --region=europe-west2 --wait

# Manual: seed PROD
gcloud run jobs execute hf-seed --region=europe-west2 --wait
```

### Environment Indicator

Each environment should set `NEXT_PUBLIC_APP_ENV` to show a colored stripe:
- `DEV` → blue stripe
- `TEST` → purple stripe
- `STG` → amber stripe
- `LIVE` → no stripe (production)

**GCP Project**: `hf-admin-prod`
**Estimated cost**: ~$17/mo per environment (Cloud SQL $10 + VPC connector $7)

---

## Day-to-Day Development Workflow

Local development is completely isolated from production. Nothing you do locally can affect live data.

### Local stack

```bash
# Start local PostgreSQL (docker-compose.yml)
docker compose up -d

# Dev server on :3000
cd apps/admin
npm run dev
```

- Local `.env` points to `localhost:5432` — your docker-compose Postgres
- Production uses Cloud SQL via private VPC — no overlap
- Use `prisma db push` locally for fast schema iteration
- Use `prisma migrate dev` when you want to create a migration for production

### Development → Production flow

```
Local dev → Push to branch → PR → CI tests pass → Merge to main
    → Build Docker image → Push to Artifact Registry
    → Run migrations (if schema changed)
    → Deploy to Cloud Run
    → Smoke test /api/health
```

---

## Deploying Changes to Production

### Quick deploy (no schema changes)

```bash
cd apps/admin

# 1. Build the runner image
docker build --platform linux/amd64 --target runner \
  -t europe-west2-docker.pkg.dev/hf-admin-prod/hf-docker/hf-admin:latest \
  -f Dockerfile .

# 2. Push to Artifact Registry
docker push europe-west2-docker.pkg.dev/hf-admin-prod/hf-docker/hf-admin:latest

# 3. Deploy to Cloud Run
gcloud run deploy hf-admin \
  --image=europe-west2-docker.pkg.dev/hf-admin-prod/hf-docker/hf-admin:latest \
  --region=europe-west2
```

Cloud Run performs a zero-downtime rolling update. The old container serves traffic until the new one passes health checks.

### Deploy with schema changes

When your branch includes new Prisma migrations, run migrations **before** deploying the new image (new code may depend on new columns/tables).

```bash
cd apps/admin

# 1. Build + push the migrate image (includes new migration files)
docker build --platform linux/amd64 --target migrate \
  -t europe-west2-docker.pkg.dev/hf-admin-prod/hf-docker/hf-migrate:latest \
  -f Dockerfile .
docker push europe-west2-docker.pkg.dev/hf-admin-prod/hf-docker/hf-migrate:latest

# 2. Run migrations
gcloud run jobs execute hf-migrate --region=europe-west2 --wait

# 3. Build + push + deploy the runner image (same as quick deploy)
docker build --platform linux/amd64 --target runner \
  -t europe-west2-docker.pkg.dev/hf-admin-prod/hf-docker/hf-admin:latest \
  -f Dockerfile .
docker push europe-west2-docker.pkg.dev/hf-admin-prod/hf-docker/hf-admin:latest
gcloud run deploy hf-admin \
  --image=europe-west2-docker.pkg.dev/hf-admin-prod/hf-docker/hf-admin:latest \
  --region=europe-west2
```

### Deploy with new specs

If you've added or changed spec JSON files in `docs-archive/bdd-specs/`:

```bash
cd apps/admin

# 1. Build + push the seed image
docker build --platform linux/amd64 --target seed \
  -t europe-west2-docker.pkg.dev/hf-admin-prod/hf-docker/hf-seed:latest \
  -f Dockerfile .
docker push europe-west2-docker.pkg.dev/hf-admin-prod/hf-docker/hf-seed:latest

# 2. Run seeding (upserts — safe for existing data)
gcloud run jobs execute hf-seed --region=europe-west2 --wait
```

### Order of operations

| Scenario | Steps |
|----------|-------|
| Code-only change | Build runner → Push → Deploy |
| Schema change | Build migrate → Push → Run migrate job → Build runner → Push → Deploy |
| New specs | Build seed → Push → Run seed job → Build runner → Push → Deploy |
| Schema + specs + code | Migrate → Seed → Deploy runner (in that order) |

---

## What Happens to Existing User Data

**User data is safe across all normal deployments.**

### Why deployments don't affect user data

| Operation | Effect on user data |
|-----------|-------------------|
| Deploy new runner image | None. Cloud Run swaps containers; DB is external (Cloud SQL) |
| `prisma migrate deploy` | Additive only — adds columns, tables, indexes. Never drops existing data unless the migration explicitly does |
| Re-seed specs (`seed-clean.ts`) | Upserts specs, contracts, and parameters only. Does NOT touch Caller, Call, CallerMemory, Observation, or Session tables |
| Cloud Run scales to 0 | None. DB persists independently. Next request spins up a new container |

### What WOULD affect user data (never do these accidentally)

| Action | Effect | When to use |
|--------|--------|-------------|
| `prisma migrate reset` | **Wipes entire database** | Never on production |
| `prisma db push --force-reset` | **Wipes entire database** | Never on production |
| Migration with `DROP TABLE` / `DROP COLUMN` | Loses that table/column's data | Only after careful review and data backup |
| `prisma/reset.ts` | Deletes all rows (preserves schema) | Only for full reset with intent |

### Data architecture separation

```
Seed data (safe to re-run):          User data (never overwritten):
├── AnalysisSpec                     ├── Caller
├── Parameter                        ├── Call
├── ScoringAnchor                    ├── CallerMemory
├── PromptSlug                       ├── Observation
├── BDDFeatureSet                    ├── Session
├── SystemSetting (contracts)        ├── PersonalityProfile
└── Domain                           └── User
```

---

## Rollback

### Roll back the application (no schema change to undo)

Cloud Run keeps previous revisions. To roll back:

```bash
# List recent revisions
gcloud run revisions list --service=hf-admin --region=europe-west2

# Route traffic back to previous revision
gcloud run services update-traffic hf-admin \
  --to-revisions=PREVIOUS_REVISION_NAME=100 \
  --region=europe-west2
```

### Roll back a migration

Prisma doesn't support automatic migration rollback. If a migration causes issues:

1. Write a new migration that reverses the change (`prisma migrate dev --name rollback_xyz`)
2. Deploy the rollback migration via `hf-migrate` job
3. Deploy the previous runner image

### Worst case: restore from backup

Cloud SQL has automated daily backups. To restore:

```bash
gcloud sql backups list --instance=hf-db
gcloud sql backups restore BACKUP_ID --restore-instance=hf-db
```

---

## Smoke Tests

After every deploy, verify the instance is healthy:

```bash
APP_URL="https://hf-admin-311250123759.europe-west2.run.app"

# Health check
curl -f "$APP_URL/api/health"

# Readiness (DB connected, specs loaded)
curl -f "$APP_URL/api/ready"

# System readiness (detailed)
curl -f "$APP_URL/api/system/readiness"
```

---

## Gotchas

| Issue | Detail |
|-------|--------|
| **Private IP only** | Cloud SQL has no public IP (GCP org policy). Cannot connect from local machine. Use Cloud Run Jobs for all DB operations |
| **AUTH_TRUST_HOST=true** | Required for Auth.js v5 on Cloud Run — without it, auth redirects fail |
| **Runner can't seed** | Production image is intentionally minimal. Use the `seed` Docker target or Cloud Run job |
| **db push vs migrate** | Local dev uses `prisma db push`. Production uses `prisma migrate deploy` (or `db push` via Cloud Run job if migrations are out of sync) |
| **Seed image needs tsconfig.json** | For `@/` path alias resolution in seed scripts |
