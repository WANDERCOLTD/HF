/**
 * #1341 (epic #1338 Slice 0) — operator-runnable proof script.
 *
 * Verifies the Session schema migration backfill against a live DB
 * (hf_sandbox / hf-dev). Reads a representative Caller's Calls and the
 * Session rows the migration backfilled, then asserts:
 *
 *   1. Every Call row with a non-null callerId has a non-null sessionId.
 *   2. Every Session row has a matching CallerSequenceCounter row at
 *      `nextSeq = MAX(sequenceNumber) + 1` per (callerId, kind).
 *   3. `@@unique([callerId, kind, sequenceNumber])` returns zero
 *      duplicates.
 *   4. NextAuth's `AuthSession` table exists and the old `Session`
 *      (pre-rename) does NOT exist as a separate table.
 *   5. No application path is writing to the new `Session` table outside
 *      of tests — checked by grep elsewhere; here we just confirm the
 *      row count matches the Call count.
 *
 * Run via:
 *   cd apps/admin && npx tsx scripts/proof-1341-schema.ts
 *
 * Exit codes:
 *   0  — all checks PASS
 *   1  — at least one check FAILED (report printed to stdout)
 *   2  — DB unreachable
 *
 * Idempotent + read-only.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

async function runChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Check 1 — every Call(callerId IS NOT NULL) has a sessionId.
  const orphanCalls = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM "Call"
    WHERE "callerId" IS NOT NULL AND "sessionId" IS NULL
  `;
  const orphanCount = Number(orphanCalls[0]?.count ?? BigInt(0));
  results.push({
    name: "Call.sessionId backfill",
    passed: orphanCount === 0,
    detail: orphanCount === 0
      ? "Every Call with a callerId has a sessionId."
      : `${orphanCount} Call rows still have sessionId IS NULL (Slice 4 cannot enforce NOT NULL until this is 0).`,
  });

  // Check 2 — Session count matches Call count (per non-null callerId).
  const sessionCount = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM "Session"
  `;
  const callCount = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM "Call" WHERE "callerId" IS NOT NULL
  `;
  const sessionN = Number(sessionCount[0]?.count ?? BigInt(0));
  const callN = Number(callCount[0]?.count ?? BigInt(0));
  results.push({
    name: "Session count == Call count",
    passed: sessionN === callN,
    detail: `Session rows: ${sessionN} | Call rows (callerId IS NOT NULL): ${callN}`,
  });

  // Check 3 — CallerSequenceCounter coverage.
  const counterMissing = await prisma.$queryRaw<
    { callerId: string; kind: string }[]
  >`
    SELECT s."callerId", s.kind::text AS kind
    FROM "Session" s
    LEFT JOIN "CallerSequenceCounter" c
      ON c."callerId" = s."callerId" AND c.kind = s.kind::text
    WHERE c."callerId" IS NULL
    GROUP BY s."callerId", s.kind
    LIMIT 10
  `;
  results.push({
    name: "CallerSequenceCounter coverage",
    passed: counterMissing.length === 0,
    detail: counterMissing.length === 0
      ? "Every (callerId, kind) present in Session also has a counter row."
      : `Missing counter rows for ${counterMissing.length}+ (callerId, kind) pairs. First example: ${JSON.stringify(counterMissing[0])}`,
  });

  // Check 4 — counter coherence (nextSeq > MAX(sequenceNumber)).
  const counterIncoherent = await prisma.$queryRaw<
    { callerId: string; kind: string; nextSeq: number; maxSeq: number }[]
  >`
    SELECT c."callerId", c.kind, c."nextSeq", agg.max_seq AS "maxSeq"
    FROM "CallerSequenceCounter" c
    JOIN (
      SELECT "callerId", kind::text AS kind, MAX("sequenceNumber") AS max_seq
      FROM "Session"
      GROUP BY "callerId", kind
    ) agg
      ON agg."callerId" = c."callerId" AND agg.kind = c.kind
    WHERE c."nextSeq" <= agg.max_seq
    LIMIT 10
  `;
  results.push({
    name: "CallerSequenceCounter.nextSeq > MAX(sequenceNumber)",
    passed: counterIncoherent.length === 0,
    detail: counterIncoherent.length === 0
      ? "Every counter's nextSeq is strictly greater than its (callerId, kind)'s max sequenceNumber."
      : `Found ${counterIncoherent.length} incoherent rows. First example: ${JSON.stringify(counterIncoherent[0])}`,
  });

  // Check 5 — @@unique([callerId, kind, sequenceNumber]) zero duplicates.
  const duplicates = await prisma.$queryRaw<
    { callerId: string; kind: string; sequenceNumber: number; count: bigint }[]
  >`
    SELECT "callerId", kind::text AS kind, "sequenceNumber",
           COUNT(*)::bigint AS count
    FROM "Session"
    GROUP BY "callerId", kind, "sequenceNumber"
    HAVING COUNT(*) > 1
    LIMIT 10
  `;
  results.push({
    name: "Session unique constraint",
    passed: duplicates.length === 0,
    detail: duplicates.length === 0
      ? "Zero (callerId, kind, sequenceNumber) duplicates."
      : `Found ${duplicates.length}+ duplicates. First: ${JSON.stringify(duplicates[0])}`,
  });

  // Check 6 — NextAuth rename: AuthSession exists, no orphan Session table
  // shape that looks like the pre-rename NextAuth columns.
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('AuthSession', 'Session')
    ORDER BY tablename
  `;
  const tableNames = tables.map((t) => t.tablename);
  const hasAuthSession = tableNames.includes("AuthSession");
  const hasSession = tableNames.includes("Session");
  // Both should exist; AuthSession = NextAuth (renamed); Session = learner.
  // The Session table's columns must NOT have `sessionToken` (the NextAuth
  // marker) — that's the proof we renamed correctly.
  const sessionColumns = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Session'
  `;
  const hasSessionToken = sessionColumns.some(
    (c) => c.column_name === "sessionToken",
  );
  results.push({
    name: "NextAuth rename: Session is learner table, not NextAuth",
    passed: hasAuthSession && hasSession && !hasSessionToken,
    detail: `AuthSession exists: ${hasAuthSession} | Session exists: ${hasSession} | Session has sessionToken (BAD if true): ${hasSessionToken}`,
  });

  // Check 7 — Session row has the new schema columns.
  const requiredColumns = [
    "callerId", "playbookId", "kind", "sequenceNumber",
    "learnerFacingNumber", "voiceConfigSnapshot",
    "countsTowardLearnerNumber", "countsTowardPipelineNumber", "skipStages",
    "usedPromptId", "producedComposedPromptId",
  ];
  const presentColumns = new Set(sessionColumns.map((c) => c.column_name));
  const missingColumns = requiredColumns.filter((c) => !presentColumns.has(c));
  results.push({
    name: "Session table has new-schema columns",
    passed: missingColumns.length === 0,
    detail: missingColumns.length === 0
      ? `All ${requiredColumns.length} required columns present.`
      : `Missing: ${missingColumns.join(", ")}`,
  });

  return results;
}

async function main(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error("[proof-1341] DB unreachable:", err);
    process.exit(2);
  }

  console.log("=== #1341 Slice 0 — Session schema proof ===\n");

  let results: CheckResult[];
  try {
    results = await runChecks();
  } catch (err) {
    console.error("[proof-1341] Check execution failed:", err);
    await prisma.$disconnect();
    process.exit(2);
  }

  let failed = 0;
  for (const r of results) {
    const tag = r.passed ? "PASS" : "FAIL";
    console.log(`[${tag}] ${r.name}`);
    console.log(`       ${r.detail}\n`);
    if (!r.passed) failed += 1;
  }

  console.log("--------------------------------------------");
  console.log(`Total: ${results.length} | Passed: ${results.length - failed} | Failed: ${failed}`);

  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main();
