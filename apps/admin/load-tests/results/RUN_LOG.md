# Load-test run log

One entry per run. Append-only.

| Date | Env | Profile | Verdict | Notes |
|------|-----|---------|---------|-------|
| 2026-05-25 12:30 | staging (dev.) | 01-baseline (10 VU × 5 min) | **FAIL** | health ✅ p95 149ms · webhook ✅ p95 216ms · **readiness ❌ p95 677ms (target <500ms), 28/1734 errors (1.6%)**. Run JSON: `results/run-1779708691.json`. Root cause investigation: `/api/system/readiness` queries CompiledAnalysisSet + AnalysisSpec + Parameter + RunConfig + Caller counts; likely candidates are slow DB queries or pool exhaustion from #191's 23 routes. Next: re-run with RATE_LIMIT_DISABLED off — if errors persist, file follow-up against #191. Staging RATE_LIMIT_DISABLED restored after run. |
