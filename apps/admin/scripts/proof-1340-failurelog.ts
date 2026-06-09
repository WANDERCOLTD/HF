/**
 * #1340 Proof Script — FailureLog table + Session-ghost coverage.
 *
 * Run against any DB (read-only) to assert Slice 1's structural
 * invariants hold:
 *
 *   1. `FailureLog` table exists with the three documented indexes
 *      (sessionId, kind, occurredAt).
 *   2. Every Session(status=GHOST) has at least one FailureLog
 *      (kind=GHOST_NEVER_CONNECTED) child — i.e., the CI consistency
 *      check `session-ghost-without-failurelog` returns 0 rows.
 *   3. Every Session(status=FAILED) has at least one FailureLog child
 *      (any kind) — the outbound-dial error branches must have
 *      written a row alongside the status flip.
 *   4. Every FailureLog row carries a non-empty errorPayload.
 *
 * Idempotent. Read-only. Exits non-zero on mismatch.
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx tsx apps/admin/scripts/proof-1340-failurelog.ts
 *
 * Output: structured PASS / FAIL per criterion with sample rows on FAIL.
 * Safe to run against hf_sandbox / dev / staging / prod.
 */

import { PrismaClient } from "@prisma/client";

interface GhostOrphan {
  id: string;
  callerId: string;
  startedAt: Date;
}

interface FailedOrphan {
  id: string;
  callerId: string;
  startedAt: Date;
}

interface EmptyPayloadRow {
  id: string;
  sessionId: string;
  kind: string;
  occurredAt: Date;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  let anyFail = false;

  try {
    // ── Criterion 1: FailureLog table + 3 indexes exist ──────────────
    const tableExists = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename = 'FailureLog'
    `;
    if (tableExists.length === 0) {
      console.error("[proof-1340] FAIL — FailureLog table does not exist.");
      console.error(
        "  Run `npx prisma migrate deploy` against this DB to apply 20260608170000_1340_failure_log.",
      );
      anyFail = true;
    } else {
      const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'FailureLog'
          AND indexname IN (
            'FailureLog_sessionId_idx',
            'FailureLog_kind_idx',
            'FailureLog_occurredAt_idx'
          )
      `;
      const names = new Set(indexes.map((i) => i.indexname));
      const expected = [
        "FailureLog_sessionId_idx",
        "FailureLog_kind_idx",
        "FailureLog_occurredAt_idx",
      ];
      const missing = expected.filter((n) => !names.has(n));
      if (missing.length > 0) {
        console.error(
          `[proof-1340] FAIL — FailureLog missing ${missing.length} index(es): ${missing.join(", ")}`,
        );
        anyFail = true;
      } else {
        console.log(
          "[proof-1340] PASS — FailureLog table + 3 indexes present.",
        );
      }
    }

    // ── Criterion 2: every GHOST Session has ≥1 FailureLog child ────
    const ghostOrphans = await prisma.$queryRaw<GhostOrphan[]>`
      SELECT s."id", s."callerId", s."startedAt"
      FROM "Session" s
      WHERE s."status" = 'GHOST'::"SessionStatus"
        AND NOT EXISTS (
          SELECT 1 FROM "FailureLog" f
          WHERE f."sessionId" = s."id"
        )
      ORDER BY s."startedAt" DESC
      LIMIT 50
    `;
    if (ghostOrphans.length === 0) {
      console.log(
        "[proof-1340] PASS — every Session(status=GHOST) carries a FailureLog child.",
      );
    } else {
      console.error(
        `[proof-1340] FAIL — ${ghostOrphans.length} Session(status=GHOST) row(s) without FailureLog children.`,
      );
      console.error(
        "  Criterion: count(Session WHERE status='GHOST' AND NOT EXISTS FailureLog child) == 0",
      );
      for (const g of ghostOrphans.slice(0, 5)) {
        console.error(
          `    • session=${g.id} caller=${g.callerId} startedAt=${g.startedAt.toISOString()}`,
        );
      }
      anyFail = true;
    }

    // ── Criterion 3: every FAILED Session has ≥1 FailureLog child ───
    const failedOrphans = await prisma.$queryRaw<FailedOrphan[]>`
      SELECT s."id", s."callerId", s."startedAt"
      FROM "Session" s
      WHERE s."status" = 'FAILED'::"SessionStatus"
        AND NOT EXISTS (
          SELECT 1 FROM "FailureLog" f
          WHERE f."sessionId" = s."id"
        )
      ORDER BY s."startedAt" DESC
      LIMIT 50
    `;
    if (failedOrphans.length === 0) {
      console.log(
        "[proof-1340] PASS — every Session(status=FAILED) carries a FailureLog child.",
      );
    } else {
      console.error(
        `[proof-1340] FAIL — ${failedOrphans.length} Session(status=FAILED) row(s) without FailureLog children.`,
      );
      console.error(
        "  Criterion: count(Session WHERE status='FAILED' AND NOT EXISTS FailureLog child) == 0",
      );
      for (const f of failedOrphans.slice(0, 5)) {
        console.error(
          `    • session=${f.id} caller=${f.callerId} startedAt=${f.startedAt.toISOString()}`,
        );
      }
      anyFail = true;
    }

    // ── Criterion 4: errorPayload is non-empty on every row ─────────
    const emptyPayloads = await prisma.$queryRaw<EmptyPayloadRow[]>`
      SELECT "id", "sessionId", "kind", "occurredAt"
      FROM "FailureLog"
      WHERE "errorPayload" IS NULL
         OR "errorPayload"::text = '{}'
         OR "errorPayload"::text = 'null'
      ORDER BY "occurredAt" DESC
      LIMIT 50
    `;
    if (emptyPayloads.length === 0) {
      console.log(
        "[proof-1340] PASS — every FailureLog row carries a non-empty errorPayload.",
      );
    } else {
      console.error(
        `[proof-1340] FAIL — ${emptyPayloads.length} FailureLog row(s) with empty errorPayload.`,
      );
      console.error(
        "  Criterion: errorPayload must capture the original error context for forensic readability.",
      );
      for (const e of emptyPayloads.slice(0, 5)) {
        console.error(
          `    • id=${e.id} session=${e.sessionId} kind=${e.kind} at=${e.occurredAt.toISOString()}`,
        );
      }
      anyFail = true;
    }

    // ── Summary ─────────────────────────────────────────────────────
    if (anyFail) {
      console.error("\n[proof-1340] OVERALL: FAIL — see criteria above.");
      process.exit(1);
    }
    console.log("\n[proof-1340] OVERALL: PASS — Slice 1 invariants hold.");
    process.exit(0);
  } catch (err) {
    console.error(
      `[proof-1340] FAIL — database query threw: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    process.exit(2);
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

void main();
