# 2026-06-07 — Env mapping rationalisation

## Decision

**Two databases, one Cloud Run service today.** Local-dev and cloud-staging are physically separated.

| Where | DB | Secret | Notes |
|---|---|---|---|
| VM `localhost:3000` (via SSH tunnel from Mac) | `hf_sandbox` | `DATABASE_URL_SANDBOX` (VM `.env.local`) | Disposable local-dev playground |
| Cloud Run `hf-admin-dev` (= `dev.humanfirstfoundation.com`) | `hf_staging` | `DATABASE_URL_STAGING` (Cloud Secret Manager, version 4 = with A3 pool params) | Staging — production-like; what we verify against before market test |
| Cloud Run `hf-admin-test` | not provisioned | — | Phase 5 (pilot) |
| Cloud Run `hf-admin` | not provisioned | — | Phase 6 (prod) |

## What changed today

1. `hf-admin-dev` Cloud Run service was re-bound from `DATABASE_URL_SANDBOX` → `DATABASE_URL_STAGING`. Revision `hf-admin-dev-00300-r8j`.
2. `DATABASE_URL_STAGING` version 4 added — appended `&connection_limit=5&pool_timeout=20` (audit-fix A3). Revision `hf-admin-dev-00301-dqj` picked it up.
3. Code references to `DATABASE_URL_DEV` updated to `DATABASE_URL_STAGING` in `apps/admin/scripts/deploy-gate.sh`, `.claude/skills/deploy-preflight/SKILL.md`, `.claude/commands/db-switch.md`, `.claude/commands/deploy.md`, `docs/CLOUD-DEPLOYMENT.md`, `docs/audit/track-a-deployment-handoff.md`.
4. `DATABASE_URL_DEV` secret deleted from Secret Manager.
5. `hf_dev` database drop deferred — separate explicit operator decision.

## Why

- Before: `hf-admin-dev` (cloud staging) was pointing at `hf_sandbox` (same DB as local dev). Every cloud deploy could clobber or be clobbered by local iteration. Bad for both.
- Before: codebase referenced `DATABASE_URL_DEV` as a stable name, but the deployed secret was actually `DATABASE_URL_SANDBOX` because the Phase-4 rename only happened halfway.
- After: a deploy to `hf-admin-dev` hits its own DB. Local dev keeps its own DB. Code references match what's deployed.

## Time-to-fix flow (canonical)

```
Mac edit → /vm-cp → VM npm run dev (hf_sandbox) → /vm-cppd or /deploy → hf-admin-dev Cloud Run (hf_staging) → manual smoke against dev.humanfirstfoundation.com
```

Once prod lands (Phase 6), append a third hop: deploy from staging-tagged commit to `hf-admin` Cloud Run → `hf_prod`.

## Rollback

Each step independently reversible:

1. Cloud Run binding: `gcloud run services update hf-admin-dev --update-secrets=DATABASE_URL=DATABASE_URL_SANDBOX:latest --region=europe-west2`
2. STAGING pool params: `gcloud secrets versions disable 4 --secret=DATABASE_URL_STAGING` (falls through to v3)
3. Code refs: `git revert` the rationalisation PR
4. Secret restore: Secret Manager soft-deletes secrets for 30 days; `gcloud secrets versions list DATABASE_URL_DEV` would still show them.
5. `hf_dev` DB drop: not done yet.

## References

- `docs/audit/MARKET-TEST-READINESS-20260607.md` — broader market-test prerequisites
- `docs/audit/track-a-deployment-handoff.md` — A3 + A7 wiring detail
- `.claude/commands/deploy.md` — `/deploy` skill, env table
