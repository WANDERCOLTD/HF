-- #974 — Composite indexes for market-test hot paths.
--
-- Audit identified 4 critical hot-path queries on the platform that currently
-- use single-column index scans + merge joins. Under 100+ concurrent caller
-- load during the market test, this would compound. Each composite below
-- collapses a multi-column filter to a single index seek.
--
-- All operations are additive CREATE INDEX statements. No destructive
-- operations. No data migration. Safe on a non-empty database.
--
-- Postgres builds indexes with an exclusive lock by default — for tables
-- with 100k+ rows, expect ~10-30s blocking during the build. For staging
-- this is acceptable; for prod, consider CREATE INDEX CONCURRENTLY in a
-- custom migration (Prisma does not generate CONCURRENTLY by default).
--
-- After deploy, run `ANALYZE <table>` if the query planner doesn't pick up
-- the new indexes immediately (rare, but possible if pg_stat_user_tables
-- shows stale statistics).
--
-- Verified hot paths:
--   - CallScore composite — caller detail learning-trajectory, cohort-learning,
--     AGGREGATE pipeline stage
--   - CallerAttribute composite — cohort-learning (3× per query), survey,
--     export
--   - CallerModuleProgress composite — learning-trajectory ORDER BY
--     updatedAt DESC
--   - Caller composite — operator dashboards / admin views
--   - Call composite — paged reverse-chronological call history under load
--
-- Redundant single-column index removals (CallScore.parameterId,
-- CallerAttribute.key, CallerAttribute.scope) are intentionally OUT OF SCOPE
-- of this migration. Handle as a cleanup migration after EXPLAIN-verification
-- shows the composites are actually being chosen by the planner on staging.

-- CallScore.@@index([callerId, parameterId])
-- Single biggest market-test perf win. Fires on every caller detail load +
-- every AGGREGATE pipeline stage + every cohort-learning query.
CREATE INDEX "CallScore_callerId_parameterId_idx" ON "CallScore"("callerId", "parameterId");

-- CallerAttribute.@@index([callerId, scope, key])
-- Cohort-learning fires this 3× per query (pre-survey + post-survey +
-- competency bands). Leading callerId + scope as second column lets the
-- (callerId, scope) prefix lookup (CHECKPOINT enumerations) use this index
-- too.
CREATE INDEX "CallerAttribute_callerId_scope_key_idx" ON "CallerAttribute"("callerId", "scope", "key");

-- CallerModuleProgress.@@index([callerId, updatedAt])
-- Learning trajectory orders by updatedAt DESC; current single-column
-- callerId index requires a sort step under load. Composite serves the
-- ORDER BY directly.
CREATE INDEX "CallerModuleProgress_callerId_updatedAt_idx" ON "CallerModuleProgress"("callerId", "updatedAt");

-- Caller.@@index([domainId, role])
-- Operator dashboards filter by (domain, role); avoids merge join between
-- two single-column scans.
CREATE INDEX "Caller_domainId_role_idx" ON "Caller"("domainId", "role");

-- Call.@@index([callerId, createdAt])
-- Paged call history is reverse-chronological per caller. Composite serves
-- the ORDER BY without a sort step.
CREATE INDEX "Call_callerId_createdAt_idx" ON "Call"("callerId", "createdAt");
