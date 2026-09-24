# HF Release Process

> The runbook for shipping code from your Mac → SAND (VM) → DEV → TEST → PROD.
> Companion doc: [`CLOUD-DEPLOYMENT.md`](./CLOUD-DEPLOYMENT.md) (infra topology).
> DR posture: [`DR-POSTURE.md`](./DR-POSTURE.md).
> Last verified: 2026-06-16 (stub — sections marked `// TODO` are tracked under [#1729](https://github.com/WANDERCOLTD/HF/issues/1729)).

## 1. Environments

| Env | Cloud Run | Cloud SQL DB | Stability | Who writes |
|---|---|---|---|---|
| **SAND** | n/a (VM `hf-dev`) | `hf_sandbox` | Throwaway | Paul + Boaz (interactive) via `/vm-cp` / `/vm-cpp` |
| **DEV** | `hf-admin-dev` (`dev.humanfirstfoundation.com`) | `hf_staging` (post-2026-06-18 pivot — pre-pivot was `hf_sandbox`) | Semi-stable | Manual `gh workflow run deploy-staging-quick.yml` (~5-7 min); auto-deploy on `main` push is a stub that fails every run (#1725 follow-on) |
| **TEST** | `hf-admin-test` (`test.humanfirstfoundation.com`) | `hf_test` | Most stable | Release-tag promotion only |
| **PROD** | `hf-admin` (`lab.humanfirstfoundation.com`) | `hf_prod` | Live | Release-tag promotion (post-TEST smoke) |

**Locked decisions reference:** epic [#1723](https://github.com/WANDERCOLTD/HF/issues/1723) §"Decisions locked (A–L)". The names `SAND/DEV/TEST/PROD` are canonical per locked decision L; legacy `STAGING/PILOT` vocab is being swept per S1b ([#1769](https://github.com/WANDERCOLTD/HF/issues/1769)).

## 2. The flow

```
feature branch → PR → main → DEV (auto) → release/* branch → TEST → promote → PROD
       ↑                                          ↑
       all normal work                            QA / UAT sign-off
```

- **Branches:** `feat/<#>-slug` / `fix/<#>-slug` / `chore/<slug>` — mandatory per CLAUDE.md.
- **DEV is intended to auto-deploy** from `main` on every merge (target shipped in [#1725](https://github.com/WANDERCOLTD/HF/issues/1725)) — however the `deploy.yml` workflow is currently a non-functional stub (placeholder DB secret + placeholder URL; fails on every push to `main`). **Until repaired, ship to DEV via `gh workflow run deploy-staging-quick.yml`** (~5-7 min, lean runner-only image with GHA cache).
- **TEST is promoted** by cutting a `release/<date>` branch. Same image source as DEV; rebuilt with `NEXT_PUBLIC_APP_ENV=TEST`.
- **PROD is promoted** by merging the `release/*` branch + tagging. Same image SHA path; rebuilt with `NEXT_PUBLIC_APP_ENV=PROD`.

## 3. Branching

| Type | Branch | When |
|---|---|---|
| Feature | `feat/<#>-<slug>` | New capability or enhancement |
| Bug fix | `fix/<#>-<slug>` | Repair to existing behaviour |
| Chore | `chore/<slug>` | Tooling, docs, deps, refactors with no behaviour change |
| Release | `release/<YYYY-MM-DD>` | Cut from `main` when ready to promote to TEST |
| Hotfix | `hotfix/<#>-<slug>` | Branched from PROD tag — see §7 |

Branch protection on `main` (per S7 [#1731](https://github.com/WANDERCOLTD/HF/issues/1731)): PR + CI green + linear history required for all actors EXCEPT `hf-vm-bot` (the VM's GitHub identity, used by `/vm-cp`).

## 4. Standing data

Two layers, per locked decision E:

| Layer | What | Lives in | Re-applied |
|---|---|---|---|
| **Seed** | Pipeline specs, RBAC roles, default voices, demo-course skeletons (idempotent upserts) | `apps/admin/prisma/seed-full.ts` + `docs-archive/bdd-specs/*.json` | Every CI deploy via `hf-seed-<env>` Cloud Run Job |
| **Fixtures** | Named demo cohort (Bertie, IELTS callers, pinned ComposedPrompts) | `apps/admin/prisma/fixtures/test-env.ts` + `shared-dev.ts` (per S4 [#1727](https://github.com/WANDERCOLTD/HF/issues/1727)) | `npm run fixtures:load <env>` — idempotent, on demand |

Rule: **TEST's DB is never hand-edited.** Demo data lives in fixtures-as-code. To change demo state: PR the fixture file, merge, next TEST promotion picks it up. Reset TEST to known baseline in <2 min via `npm run fixtures:load test-env`.

## 5. Migrations + backfills

Every schema-changing PR must include both:

1. **Prisma migration** under `apps/admin/prisma/migrations/<ts>_<name>/migration.sql`
2. **Paired backfill script** under `apps/admin/scripts/backfills/<ts>_<name>.ts` if the migration changes meaning of existing rows OR adds a NOT NULL without a SQL DEFAULT.

Enforced by S5 [#1728](https://github.com/WANDERCOLTD/HF/issues/1728) — `scripts/check-migration-has-backfill.ts` runs at PR time; blocks PRs without paired backfill unless tagged `--no-backfill-needed: <justification>`.

Backfill scripts must support `--dry-run` and log row counts. Idempotency via `BackfillLog` Prisma model (S5 ships).

The release pipeline runs against TEST/PROD:
```
1. prisma migrate deploy           (DDL only, idempotent)
2. scripts/backfills/<latest>.ts --dry-run --env=test
3. scripts/backfills/<latest>.ts --env=test    (if dry-run clean)
```

## 6. TEST is polyfunctional

TEST absorbs many roles on demand. Reset to fixtures between roles when needed (`npm run fixtures:load test-env`).

| Role | Triggered by | Mechanism |
|---|---|---|
| **Release-candidate gate** | Every promotion from DEV | `release/*` branch → `deploy-release.yml` |
| **UAT** | External stakeholder testing | TEST URL shared; fixtures load known cohort |
| **Demo** | Sales / marketing calls | Same as UAT — pre-loaded Bertie + IELTS cohort |
| **Emergency hotfix smoke** | PROD incident | `hotfix/<#>` → `release/hotfix-<date>` → TEST 5–10 min smoke → PROD |
| **PROD-shape verification** | Migration rehearsal | `/snapshot prod→test` one-shot; reset via fixtures runner after |

## 7. Emergency hotfix lane

When PROD is on fire:

```
1. Rollback FIRST (60 sec):
   gcloud run services update-traffic hf-admin --to-revisions=PREV=100 --region=europe-west2

2. Investigate AFTER bleed stops.

3. Hotfix branch off live PROD tag:
   git checkout -b hotfix/<#>-<slug> <prod-tag>

4. PR → squash → tag v<date>-hotfix.N

5. Deploy to TEST first (5–10 min smoke).

6. Promote to PROD.

7. Cherry-pick fix back to main last.
```

Rules:
- **Hotfix still goes through TEST** — never skip (5–10 min cost is < the cost of breaking PROD again)
- **Hotfix branches off the live tag**, not main, so unfinished main work doesn't leak in
- Cherry-pick to main last so main stays the source of truth for the next normal release
- Cloud Run keeps the previous revision warm — rollback is one command (cited above)

## 8. When to add more envs

The 4-env shape (SAND/DEV/TEST/PROD) handles most needs. Add others when these specific triggers fire:

| Env | Trigger | Cost |
|---|---|---|
| **INTEGRATION** | Branch conflicts on `main` ≥1/week; feature flags can't isolate work | ~$15/mo + ~1 day setup |
| **STAGING** | Paying customer with SLA; UAT can no longer share TEST; PROD migration rehearsal required | ~$30/mo + ~1 day setup |
| **DEMO** (dedicated) | Sales / marketing demos collide with TEST testing | ~$15/mo + ~half day |
| **US PROD** (region split) | US data residency requirement (first US customer asks) | ~$50/mo + ~2 days |

The architecture supports adding envs cleanly — `Dockerfile` `--build-arg NEXT_PUBLIC_APP_ENV` is parameterised; Cloud SQL needs a new DB; Cloud Run needs a new service.

## 9. How a bug becomes a release

For team intake via the GitHub issue templates (per [#1765](https://github.com/WANDERCOLTD/HF/issues/1765)):

```
1. File via github.com/WANDERCOLTD/HF/issues/new → choose template (bug / feature / incident)
2. Issue lands with severity + env labels
3. (Project board auto-routes to Triage column — pending project-board scope grant)
4. Branch created via `feat/<#>-<slug>` or `fix/<#>-<slug>`
5. PR opened — issue moves to "In Review"
6. PR merged → DEV auto-deploys → issue moves to "In DEV"
7. Cut release/* → TEST promotion → "In TEST"
8. Tag v<date> + PROD promotion → "Done"
```

`sev-1` and `sev-2` issues take the **emergency hotfix lane** (§7) — same column traversal but compressed cadence.

// TODO(#1729): Project board column auto-moves require operator to grant `read:project` scope to `gh`. Pending.

## 10. Observability

| Surface | Purpose | Configured in |
|---|---|---|
| `/api/health` | Per-env liveness probe | Cloud Monitoring uptime checks (S11 [#1764](https://github.com/WANDERCOLTD/HF/issues/1764)) |
| `/api/ready` | Per-env readiness check | Same |
| `AppLog` table | Operator-action audit + voice diagnostics | Built-in; see CLAUDE.md "VOICE_DIAG_VERBOSE" |
| Cloud Logging | Build / migrate / seed / deploy / drill traces | Default GCP |

Alert channel: operator email on 2 consecutive uptime failures (Cloud Monitoring free tier).

## 11. Glossary

- **SAND** — VM `hf-dev`, `hf_sandbox` DB. Operators iterate here.
- **DEV** — Cloud Run `hf-admin-dev` at `dev.humanfirstfoundation.com`, `hf_staging` DB (post-2026-06-18 pivot). Fast-fix path: `gh workflow run deploy-staging-quick.yml` (~5-7 min). Auto-deploy from `main` is a stub today (see §2).
- **TEST** — Cloud Run `hf-admin-test`, `hf_test` DB. Release-promotion only.
- **PROD** — Cloud Run `hf-admin`, `hf_prod` DB. Live.
- **Promotion** — `release/<date>` branch cut from main + tag triggers TEST/PROD deploy of the same source SHA.
- **Fixtures** — codified demo cohort under `apps/admin/prisma/fixtures/*.ts`; reset-on-demand.
- **`hf-vm-bot`** — machine GitHub user used by `/vm-cp` to bypass branch protection on `main`.
- **Hotfix lane** — emergency path from live PROD tag through TEST → PROD (never PROD-direct).

## References

- Epic [#1723](https://github.com/WANDERCOLTD/HF/issues/1723) — release pipeline (this doc's parent)
- Epic [#1761](https://github.com/WANDERCOLTD/HF/issues/1761) — DR posture
- [`docs/CLOUD-DEPLOYMENT.md`](./CLOUD-DEPLOYMENT.md) — infra topology + service inventory
- [`docs/DR-POSTURE.md`](./DR-POSTURE.md) — RPO/RTO + 8-scenario coverage
- [`docs/runbooks/`](./runbooks/) — DR scenario runbooks + the PITR procedure
- [`.claude/rules/ci-docs-parity.md`](../.claude/rules/ci-docs-parity.md) — the gate that keeps this doc fresh
