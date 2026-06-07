# Market-Test Readiness Assessment (2026-06-07)

## TL;DR — Not ready as-is. Three operator-action items must land first.

| Block | Why it bites during market test | Owner |
|---|---|---|
| **A3** — DATABASE_URL `?connection_limit=5&pool_timeout=20` per env | Cloud SQL pool starves around ~30 concurrent calls. First peak hour will surface `P1001 connection pool timeout` and 5xx cascade. | platform-on-call |
| **B3** — Cloud Run `--concurrency=20 --max-instances=10 --min-instances=1` on `hf-admin-*` | Without caps, traffic spike auto-scales instances faster than Cloud SQL can absorb. Also bounds runaway Anthropic spend during burst. | platform-on-call |
| **A7 wiring** — Cloud Scheduler job hitting `/api/cron/cleanup-usage-events` daily | UsageEvent grows ~30M rows/year/10K learners. Without pruning, the metering dashboard slows then breaks within weeks; partial-index B11 work falls on top. | platform-on-call |

Code for all three exists (A3 = env change, B3 = gcloud flag, A7 endpoint shipped in #1277). Exact gcloud commands are in `docs/audit/track-a-deployment-handoff.md`. Estimated ~30 minutes of operator time total.

## Ready to ship as-is

Audit findings that this session closed in code:

- **STUDENT scope** (#1240) — all 25 audited caller-data leaks blocked at edge + per-route. Verified live on sandbox: 14/14 scope tests pass.
- **Caller-detail page perf** (#1277/A1) — payload capped to 25 calls + 200 targets; composedPrompt scoped to returned window. ~250KB drop per active-learner page load.
- **ComposedPrompt race** (#1277/A2) — create-then-supersede now atomic. "Two active rows" race eliminated.
- **CallerAttribute hot path** (#1277/A8) — partial index on `(callerId, key) WHERE validUntil IS NULL`. Live tip reads no longer scan tombstones.
- **UsageEvent prune endpoint** (#1277/A7) — `POST /api/cron/cleanup-usage-events` exists, dual-auth (ADMIN session OR x-internal-secret). Needs Cloud Scheduler wiring (A7-wiring above).
- **Caller.phone unique** (#1289/B5) — partial unique index prevents duplicate learners from retried VAPI webhooks. 11 sandbox dupes nulled.
- **CI safety net** (#1242 + #1272 + #1289/B8) — Prisma generate before tsc, ratchet relock, 10 stale unit tests unblocked, FK consistency check now runs on every PR.
- **Domain migration backfill** (#1281/B0 part 1) — fresh-DB migrations stop tripping on Domain. Still informational due to wider db-push debt.

## Should ship before market test (high-risk, code change needed)

| # | Story | Effort | Why it matters at market test |
|---|---|---|---|
| **C5** | Voice-path composed-prompt first-line eval (#1207 regression net) | 1d | #1207 fixed a real regression where every call opened with "Welcome back. Let's revise…". Without an eval, the next analogous regression goes silently into market-test users. Highest single-user-experience risk. |
| **B11** | Cron pruners for AppLog (90d), CallMessage (180d), PipelineStep (90d) | 1d | AppLog projects to ~36M rows / ~35GB at 10K learners × 12 months. Mirrors A7 pattern — three HTTP endpoints + Scheduler jobs. Without these, table sizes will become a 90-day problem. |
| **B6** | ESLint rule `hf-auth/no-unscoped-caller-param` | 3h | Regression catcher for A5/B7. Five engineers shipping in parallel during market test = high chance a new route forgets the scope check. ESLint kills it at PR time. |
| **B4** | Postgres advisory lock on CallerAttribute lo-mastery upsert | 3h | Concurrency audit Rank 2: classic read-modify-write race on `lo_mastery:` keys. Two calls landing within the same second for the same learner can clobber each other's mastery delta. Bite probability scales with peak concurrency. |

## Can wait until post-market-test (volume optimization)

These pay off at scale but don't break during a market test:

| Bucket | Items |
|---|---|
| AI cost (eventually $19k/yr saving) | C1–C4: pipeline.measure rubric eval → pipeline.score_agent eval → cross-model harness → demote Sonnet to Haiku. C4 alone is the saving; C1–C3 are the gates. |
| Pipeline prompt cache | A4 — multi-day prompt-builder refactor. 40–60% pipeline cost savings but high implementation risk. Only worth it when AI spend is actually material. |
| Data — long arc | C9 (move Call.transcript to GCS blob), C10 (CallerAttribute tombstone compaction). Both meaningful at scale, neither urgent. |
| CI strict gates | B0-followup (~80-table db-push backfill), B10 (make migrate non-optional in deploy-release), B9 (cross-env _prisma_migrations diff). Quality-of-life, not market-test blockers. |
| Audit observability | B12 (cache-tier rows in cost-config.ts), B13 (cache_hit_ratio dashboard) — improves cost-visibility but no current incident. |
| Other | B1 (split caller-detail god-endpoint), B2 (paginate /courses/[id]/learners). UI perf improvements; A1 covers the immediate hot-path. |

## Recommended sprint to clear market-test blockers

| Day | Work |
|---|---|
| Day 1 AM | Operator: A3 (DATABASE_URL params) + B3 (Cloud Run flags). 30 min combined. Verify with a 30-concurrent-call sim. |
| Day 1 PM | Operator: A7 wiring (Cloud Scheduler job). 15 min. Verify by manual trigger. |
| Day 2 | Engineer: B11 (three cron pruners + three Scheduler jobs). 1 day. |
| Day 3 | Engineer: C5 (voice-opening eval). 1 day. |
| Day 4 AM | Engineer: B6 (ESLint rule). 3h. |
| Day 4 PM | Engineer: B4 (advisory lock). 3h. |
| Day 5 | Run a 50-concurrent-call sandbox sim. Verify no `P1001`, no duplicate Caller rows, no doubled lo_mastery deltas, no AppLog runaway. Smoke-test STUDENT routes for 403/200 boundaries. Greenlight. |

After Day 5, market test can open with confidence the audit-cited failure modes are blocked. Track-C optimization happens after first real users provide baseline metrics.

## What this assessment is NOT

- Not a security review beyond the STUDENT scope class. RBAC for OPERATOR/EDUCATOR/ADMIN is well-tested via the existing `route-auth-coverage.test.ts`; no new findings from this audit.
- Not a UX/UI readiness assessment. The audit focused on backend correctness, cost, and concurrency.
- Not a stress test. The sandbox sim on Day 5 is the closest we get without real users.
- Not legal/compliance — separate to the GDPR/AUP work tracked under #1244.
