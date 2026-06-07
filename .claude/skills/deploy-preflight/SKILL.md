---
name: deploy-preflight
description: Pre-deployment validation — checks types, lint, tests, uncommitted changes, and migration status. Use before deploying to any environment. Auto-triggers when user mentions deploying or pushing to cloud.
allowed-tools: Bash, Read, Grep, Glob
model: haiku
context: fork
---

# Deploy Preflight Check

Run these checks in order, stop on first failure:

## 1. Uncommitted changes
```bash
cd /Users/paulwander/projects/HF && git status --porcelain
```
If dirty: WARN — "Uncommitted changes won't be deployed"

## 2. Branch check
```bash
git branch --show-current
```
If not `main`: WARN — "Not on main branch"

## 3. Type check
```bash
cd apps/admin && npx tsc --noEmit 2>&1 | tail -20
```

## 4. Lint
```bash
cd apps/admin && npm run lint 2>&1 | tail -20
```

## 5. Unit tests
```bash
cd apps/admin && npm run test 2>&1 | tail -20
```

## 6. Migration status (against TARGET env's Cloud SQL — NOT local .env)

**⚠️ Running `npx prisma migrate status` with the local `DATABASE_URL` is a known trap.** Local `.env` points at the VM dev DB (or nothing) and returns false PASS while Cloud SQL is behind. Incident: 2026-04-15 — `ContentSource.extractorVersion does not exist` on dev because guard checked wrong DB.

Ask the user which env they're preflighting (STAGING / PILOT / PROD — legacy names DEV / TEST also accepted) and pick the matching secret: `DATABASE_URL_STAGING`, `DATABASE_URL_PILOT`, or `DATABASE_URL_PROD`. The old `DATABASE_URL_DEV` secret was renamed to `_STAGING` in the 2026-06-07 cutover. Then:

```bash
(
  export DATABASE_URL="$(gcloud secrets versions access latest \
    --secret=$DB_SECRET --project=hf-admin-prod)"
  cd apps/admin && npx prisma migrate status 2>&1
)
```

If the secret fetch fails: report WARN with "guard could not run against $ENV — migrations unverified". Never silently fall back to local `DATABASE_URL`.

## Report
Output a table:
| Check | Status |
|-------|--------|
| Clean working tree | PASS/WARN |
| On main branch | PASS/WARN |
| TypeScript | PASS/FAIL |
| Lint | PASS/FAIL |
| Tests | PASS/FAIL |
| Migrations | PASS/WARN |

If any FAIL: "BLOCKED — fix before deploying"
If only WARN: "READY with warnings"
If all PASS: "READY TO DEPLOY"
