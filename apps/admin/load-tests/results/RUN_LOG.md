# Load-test run log

One entry per run. Append-only.

| Date | Env | Profile | Verdict | Notes |
|------|-----|---------|---------|-------|
| 2026-05-25 12:30 | staging (dev., rev 274) | 01-baseline (10 VU × 5 min) | **FAIL** | health p95 149ms ✅ · webhook p95 216ms ✅ · **readiness p95 677ms (target <500ms), 28/1734 errors (1.6%)** ❌. Run: `results/run-1779708691.json`. Root cause: `/api/system/readiness` (a) used `new PrismaClient()` per-route + (b) ran 9 parallel `.count()` queries per request. |
| 2026-05-25 12:48 | staging (dev., rev 276 — #765 fix) | 01-baseline retry | **WORSE** | readiness p95 218ms ✅ but **95% 5xx after ~30s of traffic** ❌. Root cause: PR #765 added shared singleton but the route still called `prisma.$disconnect()` in finally{}, which now tore down the SHARED pool for every other concurrent request. Reverted via #766; rolled back traffic to rev 274. |
| 2026-05-25 13:48 | staging (dev., rev 279 — #767 forward fix) | 01-baseline retry | **PASS** | health p95 171ms ✅ · webhook p95 213ms ✅ · **readiness p95 151ms** (was 677ms, **-77%**) ✅ · **error rate 0% (0 of 6961)** ✅. Run: `results/run-1779713481.json`. Fix shipped: shared singleton + removed `$disconnect()` (the real bug) + 5s in-memory cache. Cache collapsed ~3 concurrent reqs/s to ~0.2 actual DB hits/s. |
| 2026-05-25 13:35 | staging (dev., rev 274 — accidental) | 01-baseline (traffic-pin mistake) | **FAIL** | After #767 deploy, traffic was still pinned to rev 274 from the earlier rollback's `update-traffic` — the fix never received traffic. http_req_failed 20.02%. Fixed by `gcloud run services update-traffic --to-latest`. **Lesson:** the lean staging-deploy workflow should `--to-latest` automatically; today it doesn't, so a pinned rollback persists silently through subsequent deploys. File follow-up against #748 composite. |
