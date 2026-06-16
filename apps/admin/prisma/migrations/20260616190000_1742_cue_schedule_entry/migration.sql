-- #1742 — CueScheduleEntry: restart-safe cue scheduling for
-- `VoiceProvider.sayMessage()`.
--
-- The `lib/voice/cue-scheduler.ts` drain loop scans this table on a
-- short interval and dispatches due rows. DB-backed (not in-memory)
-- so cues scheduled before a server restart survive the restart.
--
-- See docs/decisions/2026-06-16-voice-say-message-primitive.md.

CREATE TABLE IF NOT EXISTS "CueScheduleEntry" (
  "id"             TEXT NOT NULL,
  "externalCallId" TEXT NOT NULL,
  "callId"         TEXT,
  "scheduledFor"   TIMESTAMP(3) NOT NULL,
  "content"        TEXT NOT NULL,
  "options"        JSONB,
  "firedAt"        TIMESTAMP(3),
  "cancelledAt"    TIMESTAMP(3),
  "status"         TEXT NOT NULL DEFAULT 'pending',
  "traceId"        TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CueScheduleEntry_pkey" PRIMARY KEY ("id")
);

-- Cancel-on-call-delete is SetNull (mirrors Prisma `onDelete: SetNull`).
ALTER TABLE "CueScheduleEntry"
  ADD CONSTRAINT "CueScheduleEntry_callId_fkey"
  FOREIGN KEY ("callId") REFERENCES "Call"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Hot lookups: scheduler tick + per-call cancellation.
CREATE INDEX IF NOT EXISTS "CueScheduleEntry_externalCallId_status_idx"
  ON "CueScheduleEntry"("externalCallId", "status");
CREATE INDEX IF NOT EXISTS "CueScheduleEntry_scheduledFor_status_idx"
  ON "CueScheduleEntry"("scheduledFor", "status");
CREATE INDEX IF NOT EXISTS "CueScheduleEntry_callId_idx"
  ON "CueScheduleEntry"("callId");
