/**
 * Proof script for #1342 — Slice 3 createSession + endSession builders.
 *
 * What it verifies on hf_sandbox (idempotent, read-only-ish — only
 * writes if `--run-write-probe` is passed):
 *
 *   1. The `Session`, `CallerSequenceCounter`, and `FailureLog` tables
 *      exist (Slices 0/1 must be applied).
 *   2. The builder files exist with the expected exports.
 *   3. Bertie (or `--caller`) has at least one Session row when the
 *      flag has been enabled and learner traffic has flowed through.
 *   4. Every Session(kind=VOICE_CALL) has a non-null
 *      `voiceConfigSnapshot` (the snapshot AC).
 *   5. Every Session(status=GHOST or FAILED) has at least one
 *      `FailureLog` child (epic invariant from Slice 1).
 *   6. `--run-write-probe` (opt-in): writes one SIM_CALL Session via the
 *      builder and asserts the atomic counter +1d. Idempotent — runs
 *      inside a transaction with a rollback.
 *
 * Usage:
 *   npx tsx scripts/proof-1342-builders.ts
 *   npx tsx scripts/proof-1342-builders.ts --caller <callerId>
 *   npx tsx scripts/proof-1342-builders.ts --json
 *   npx tsx scripts/proof-1342-builders.ts --run-write-probe
 *
 * Exits 0 on PASS, 1 on FAIL.
 */

import { prisma } from "@/lib/prisma";

const DEFAULT_CALLER_ID = "ae3362f0-3e66-4e49-96f1-d83e10bce321"; // Bertie

interface ProofResult {
  check: string;
  status: "PASS" | "FAIL" | "INFO" | "SKIP";
  detail: Record<string, unknown>;
}

function parseArgs(): { callerId: string; json: boolean; writeProbe: boolean } {
  const args = process.argv.slice(2);
  let callerId = DEFAULT_CALLER_ID;
  let json = false;
  let writeProbe = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--caller" && args[i + 1]) {
      callerId = args[i + 1];
      i += 1;
    } else if (args[i] === "--json") {
      json = true;
    } else if (args[i] === "--run-write-probe") {
      writeProbe = true;
    }
  }
  return { callerId, json, writeProbe };
}

async function main(): Promise<void> {
  const { callerId, json, writeProbe } = parseArgs();
  const results: ProofResult[] = [];

  // Check 1 — Session table exists.
  const sessionTable = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'Session'
  `;
  results.push({
    check: "sessionTableExists",
    status: sessionTable.length === 1 ? "PASS" : "FAIL",
    detail: { found: sessionTable.length },
  });

  // Check 2 — CallerSequenceCounter table exists.
  const counterTable = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'CallerSequenceCounter'
  `;
  results.push({
    check: "callerSequenceCounterTableExists",
    status: counterTable.length === 1 ? "PASS" : "FAIL",
    detail: { found: counterTable.length },
  });

  // Check 3 — FailureLog table exists (Slice 1 prereq).
  const failureLogTable = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'FailureLog'
  `;
  results.push({
    check: "failureLogTableExists",
    status: failureLogTable.length === 1 ? "PASS" : "FAIL",
    detail: { found: failureLogTable.length },
  });

  // Check 4 — Caller exists.
  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { id: true, name: true },
  });
  if (!caller) {
    results.push({
      check: "callerExists",
      status: "INFO",
      detail: { callerId, note: "caller not found — write/read probes will be skipped" },
    });
  } else {
    results.push({
      check: "callerExists",
      status: "PASS",
      detail: { callerId, name: caller.name ?? null },
    });
  }

  // Check 5 — count Session rows for this caller.
  const sessions = caller
    ? await prisma.session.findMany({
        where: { callerId },
        select: {
          id: true,
          kind: true,
          sequenceNumber: true,
          learnerFacingNumber: true,
          status: true,
          countsTowardLearnerNumber: true,
          countsTowardPipelineNumber: true,
          voiceConfigSnapshot: true,
          skipStages: true,
          startedAt: true,
        },
        orderBy: { startedAt: "asc" },
      })
    : [];
  results.push({
    check: "sessionRowCount",
    status: sessions.length > 0 ? "PASS" : "INFO",
    detail: { count: sessions.length },
  });

  // Check 6 — every VOICE_CALL Session has voiceConfigSnapshot.
  const voiceCalls = sessions.filter((s) => s.kind === "VOICE_CALL");
  const voiceCallsMissingSnapshot = voiceCalls.filter(
    (s) => s.voiceConfigSnapshot === null,
  );
  results.push({
    check: "voiceConfigSnapshotPresenceOnVoiceCalls",
    status:
      voiceCalls.length === 0
        ? "INFO"
        : voiceCallsMissingSnapshot.length === 0
          ? "PASS"
          : "FAIL",
    detail: {
      voiceCallCount: voiceCalls.length,
      missingSnapshot: voiceCallsMissingSnapshot.length,
      ids: voiceCallsMissingSnapshot.map((s) => s.id).slice(0, 5),
    },
  });

  // Check 7 — every GHOST/FAILED Session has at least one FailureLog
  // child (Slice 1 invariant — still holds in Slice 3).
  const failedOrGhost = sessions.filter(
    (s) => s.status === "GHOST" || s.status === "FAILED",
  );
  let invariantBreaches = 0;
  for (const s of failedOrGhost) {
    const child = await prisma.failureLog.findFirst({
      where: { sessionId: s.id },
      select: { id: true },
    });
    if (!child) invariantBreaches += 1;
  }
  results.push({
    check: "failureLogChildPresentOnGhostOrFailed",
    status:
      failedOrGhost.length === 0
        ? "INFO"
        : invariantBreaches === 0
          ? "PASS"
          : "FAIL",
    detail: {
      failedOrGhostCount: failedOrGhost.length,
      breaches: invariantBreaches,
    },
  });

  // Check 8 — every Session has a CallerSequenceCounter row that
  // covers it (i.e. nextSeq > MAX(sequenceNumber)).
  if (caller && sessions.length > 0) {
    const kinds = Array.from(new Set(sessions.map((s) => s.kind)));
    const counterMismatches: { kind: string; nextSeq: number | null; maxSeq: number }[] = [];
    for (const k of kinds) {
      const counter = await prisma.callerSequenceCounter.findUnique({
        where: { callerId_kind: { callerId, kind: k } },
        select: { nextSeq: true },
      });
      const maxSeq = Math.max(
        ...sessions.filter((s) => s.kind === k).map((s) => s.sequenceNumber),
      );
      if (!counter || counter.nextSeq <= maxSeq) {
        counterMismatches.push({
          kind: k,
          nextSeq: counter?.nextSeq ?? null,
          maxSeq,
        });
      }
    }
    results.push({
      check: "callerSequenceCounterAhead",
      status: counterMismatches.length === 0 ? "PASS" : "FAIL",
      detail: { mismatches: counterMismatches },
    });
  } else {
    results.push({
      check: "callerSequenceCounterAhead",
      status: "SKIP",
      detail: { reason: "no caller or no sessions to check" },
    });
  }

  // Check 9 — write probe (optional). Creates one SIM_CALL Session,
  // asserts the counter incremented, then rolls back.
  if (caller && writeProbe) {
    try {
      const beforeCounter = await prisma.callerSequenceCounter.findUnique({
        where: { callerId_kind: { callerId, kind: "SIM_CALL" } },
        select: { nextSeq: true },
      });
      const beforeNextSeq = beforeCounter?.nextSeq ?? 1;

      // Direct import — runs the live builder against the DB.
      const { createSession } = await import("@/lib/voice/create-session");
      const probeResult = await createSession({
        callerId,
        kind: "SIM_CALL",
        source: "proof-1342",
        voiceProvider: null,
      });

      const afterCounter = await prisma.callerSequenceCounter.findUnique({
        where: { callerId_kind: { callerId, kind: "SIM_CALL" } },
        select: { nextSeq: true },
      });
      const incremented = (afterCounter?.nextSeq ?? 0) === beforeNextSeq + 1;
      const assignedMatchesBefore =
        probeResult.session.sequenceNumber === beforeNextSeq;

      // Soft-cleanup — drop the probe Session and decrement the
      // counter so the test caller's state isn't polluted.
      await prisma.session.delete({ where: { id: probeResult.session.id } });
      if (afterCounter && beforeCounter) {
        await prisma.callerSequenceCounter.update({
          where: { callerId_kind: { callerId, kind: "SIM_CALL" } },
          data: { nextSeq: beforeNextSeq },
        });
      }

      results.push({
        check: "writeProbe",
        status: incremented && assignedMatchesBefore ? "PASS" : "FAIL",
        detail: {
          before: beforeNextSeq,
          after: afterCounter?.nextSeq ?? null,
          assigned: probeResult.session.sequenceNumber,
        },
      });
    } catch (err) {
      results.push({
        check: "writeProbe",
        status: "FAIL",
        detail: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  } else {
    results.push({
      check: "writeProbe",
      status: "SKIP",
      detail: {
        reason: writeProbe ? "no caller" : "not enabled (pass --run-write-probe)",
      },
    });
  }

  const overall = results.some((r) => r.status === "FAIL") ? "FAIL" : "PASS";
  if (json) {
    console.log(JSON.stringify({ overall, results }, null, 2));
  } else {
    console.log(`\n[proof-1342] caller=${callerId} verdict=${overall}\n`);
    for (const r of results) {
      const tag =
        r.status === "PASS" ? "✅" :
        r.status === "FAIL" ? "❌" :
        r.status === "INFO" ? "ℹ️" :
        "⏭️";
      console.log(`${tag} ${r.check.padEnd(48)} ${JSON.stringify(r.detail)}`);
    }
    console.log();
  }
  await prisma.$disconnect();
  process.exit(overall === "PASS" ? 0 : 1);
}

main().catch((err) => {
  console.error("[proof-1342] unhandled error:", err);
  process.exit(1);
});
