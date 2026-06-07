# Audit Sprint — Session Closeout (2026-06-07)

## What shipped

| PR | Merge | Concern |
|---|---|---|
| [#1240](https://github.com/WANDERCOLTD/HF/pull/1240) | `242fc3f9` | A5 + B7 — closed all 25 audited STUDENT caller-scope leaks (edge middleware + per-route checks). Verified live on hf_sandbox: 14/14 scope tests pass. |
| [#1242](https://github.com/WANDERCOLTD/HF/pull/1242) | `e19316e1` | CI infrastructure fix — added `npx prisma generate` step before tsc, locked ratchet at the post-fix baseline (205 / 0 / 4403 / 37). Unblocked every subsequent PR. |
| [#1272](https://github.com/WANDERCOLTD/HF/pull/1272) | `abcc144a` | Unblocked 10 pre-existing unit test failures (`vapi-provider*`, `calls-create*`, `callers-calls-module-resolver*`) — fixture updates only, no prod change. Full unit suite went 5837/11/16 → 5848/0/16. Also bumped ratchet to 207/0/4405 absorbing drift from unrelated main merges. |
| [#1277](https://github.com/WANDERCOLTD/HF/pull/1277) | `13157630` | Audit Track A — caller-detail payload caps (A1), ComposedPrompt create+supersede transaction (A2), `/api/cron/cleanup-usage-events` endpoint (A7), partial index on `CallerAttribute` live tip (A8), + operator handoff doc covering A3/A7, + B0 investigation findings. |

Five merges in one session, all green CI at merge time, total impact on the audit-fix plan:

- **All of Track A except A4 implemented** (A1, A2, A5, A7, A8 in code; A3 + A7-cron-wiring in operator handoff; A6 evolved into B0 investigation).
- **B7 implemented** as part of #1240.
- **B0 (Domain backfill) investigation complete** — ready to implement, ~2h estimated.

## Parked / deferred

### A4 — pipeline prompt caching (parked indefinitely)
The audit projected 40–60% pipeline-burst cost savings, but the real fix requires restructuring every stage's prompt builder (~7 of them) so the shared transcript prefix sits at identical byte position in the system message with a `cache_control` marker. Multi-day refactor with measurable behavioural regression risk. Worth doing as a deliberate epic when AI spend justifies the cost; not a one-shot fix.

### B0 — CI migrate `continue-on-error` removal (ready to implement)
Findings in `docs/audit/b0-domain-migration-investigation.md`. Smallest possible: one new migration `20260212_backfill_create_domain` (idempotent `CREATE TABLE IF NOT EXISTS` + 5 indexes) positioned before the FK in `20260213_expand_user_roles`. Safe on existing envs (no-op via IF NOT EXISTS), unblocks fresh CI DB. ~2h with `prisma db pull` verification.

### Operator follow-ups from #1277 (gcloud action, not in PR)
1. **A3** — append `?connection_limit=5&pool_timeout=20` to `DATABASE_URL` for hf-admin-dev / hf-admin-test / hf-admin.
2. **A7** — Cloud Scheduler job per env hitting `/api/cron/cleanup-usage-events` daily at 03:00 UTC.

Details + exact gcloud commands: `docs/audit/track-a-deployment-handoff.md`.

### Track B remainder (still groomed-ready)
B1 (caller-detail tab-loaded slices), B2 (paginate `/courses/[id]/learners`), B3 (Cloud Run concurrency caps), B4 (Postgres advisory lock on `CallerAttribute` lo-mastery upsert), B5 (`@@unique` on `Caller.phone`), B6 (ESLint rule `hf-auth/no-unscoped-caller-param`), B8–B13. Estimated ~5–6 dev days as one focused sprint.

### Track C remainder (eval + capability)
C1–C3 (`pipeline.measure` / `pipeline.score_agent` rubric evals + cross-model harness) are the critical gate for **C4 (Sonnet → Haiku demotion, ~$19k/yr saving at 1k calls/day)**. C5–C10 follow. No dependency between C1–C2 → can start immediately.

## Recommended first move next session

**B0 implementation** is the highest-leverage 2h on the board:
1. `prisma db pull` against hf_sandbox to reconcile the recommended Domain shape with what's actually in the table.
2. Write `prisma/migrations/20260212_backfill_create_domain/migration.sql` per the investigation doc.
3. Test on a fresh local Postgres: `prisma migrate deploy` from scratch → confirm exit 0 + schema matches `db pull` output.
4. Test on a hf_sandbox clone: confirm idempotent (gains one `_prisma_migrations` row, no errors).
5. Remove `continue-on-error: true` from `.github/workflows/test.yml` line 188 (the `Run Prisma migrations` step).

After B0 lands, every CI run sees a real migrate result, the integration tests get a real schema, and the next 3 PRs in Track B (B5, B8, B9) can stack cleanly without inheriting the migrate-step warning that's been swallowed for ~weeks.

## Process notes from this session

- **The CI ratchet was failing for a reason no human had diagnosed.** PR #1242 fixed it (stale prisma client = 205 phantom tsc errors → 0). Worth checking once a quarter whether the ratchet baseline matches reality before adding new debt.
- **Quarantined tests aren't always dead.** PR #1272's "10 pre-existing failures" weren't pre-existing — they were fixture rot from #922 / G6 / #1177. 30 min of grep + fixture edits cleared them all.
- **Edge middleware + a JWT claim is the cleanest STUDENT-scope enforcement.** A5's `learnerCallerId` stamping is zero-DB at request time and kills 20 leak routes in one regex. Worth the pattern for other "subset-of-X" scoping in the future.
- **Always run the live test against sandbox before claiming "shipped."** 14/14 sandbox scope tests caught real configuration issues the unit tests can't (JWT salt naming, NextAuth cookie precedence, etc.) before they shipped to dev users.
