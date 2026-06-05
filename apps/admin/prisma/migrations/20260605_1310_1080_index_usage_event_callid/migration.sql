-- AnyVoice #1080: add @@index([callId]) on UsageEvent so the admin
-- telemetry panel's per-call drill-down doesn't table-scan.
--
-- IMPORTANT — production deploy:
-- UsageEvent is potentially large. Prisma's `migrate deploy` runs this
-- under an ACCESS EXCLUSIVE lock by default. For production, run the
-- equivalent CONCURRENTLY statement manually then mark this migration
-- applied with `prisma migrate resolve --applied`:
--
--   psql -c 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "UsageEvent_callId_idx" ON "UsageEvent"("callId");'
--   npx prisma migrate resolve --applied 20260605_1310_1080_index_usage_event_callid
--
-- Dev / staging is fine with the lock — tables are tiny.

CREATE INDEX IF NOT EXISTS "UsageEvent_callId_idx" ON "UsageEvent"("callId");
