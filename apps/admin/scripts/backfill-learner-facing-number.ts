#!/usr/bin/env npx tsx
/**
 * #1344 (epic #1338) Slice 4 — backfill `Session.learnerFacingNumber`
 * + `Session.countsTowardLearnerNumber` per the class rules in the
 * epic body.
 *
 * Class rules (epic §"Two counters with explicit rules"):
 *
 *   | Session class                                | counts? |
 *   |----------------------------------------------|---------|
 *   | VOICE_CALL completed, duration ≥ 30s         | yes     |
 *   | VOICE_CALL completed, duration < 30s         | no      |
 *   | VOICE_CALL aborted / dropped / ghost / fail  | no      |
 *   | SIM_CALL completed                           | no      |
 *   | SIM_CALL drop                                | no      |
 *   | ENROLLMENT / ASSESSMENT / TEXT_CHAT          | no      |
 *   | Session(status=GHOST)                        | no      |
 *   | Session(status=FAILED)                       | no      |
 *
 * Algorithm — per caller:
 *   1. Walk every Session in `startedAt ASC` order.
 *   2. Apply the class rules to compute `countsTowardLearnerNumber`.
 *   3. Maintain a per-caller running counter; assign to qualifying
 *      Sessions only.
 *   4. Write `Session.learnerFacingNumber` + `Session.countsTowardLearnerNumber`
 *      via a single transactional `UPDATE` per caller.
 *   5. Sanity-assert post-write: no gaps per caller
 *      (`MAX(learnerFacingNumber) == COUNT(*) WHERE countsTowardLearnerNumber = true`).
 *
 * Idempotent — re-running yields the same shape. The class rules are
 * deterministic given (kind, status, durationSeconds).
 *
 * Run order:
 *   1. Apply `20260609131210_1344_drop_legacy_call_counters` migration
 *      (DROP COLUMN Call.callSequence + ComposedPrompt.triggerCallId).
 *   2. Run THIS script.
 *   3. Run `scripts/proof-1344-cutover.ts` to verify.
 *
 * Usage:
 *   npx tsx scripts/backfill-learner-facing-number.ts            # full backfill
 *   npx tsx scripts/backfill-learner-facing-number.ts --caller <id>  # one caller
 *   npx tsx scripts/backfill-learner-facing-number.ts --dry      # plan only
 */

import { PrismaClient } from "@prisma/client";
import { DEFAULT_MIN_LEARNER_DURATION_SECONDS } from "@/lib/voice/session-rules";

const prisma = new PrismaClient();

interface SessionRow {
  id: string;
  callerId: string;
  kind: string;
  status: string;
  startedAt: Date;
  endedAt: Date | null;
  countsTowardLearnerNumber: boolean;
  learnerFacingNumber: number | null;
}

interface ClassRuleInputs {
  kind: string;
  status: string;
  durationSeconds: number | null;
}

/**
 * Compute whether a Session should count toward the per-Caller
 * learner-facing call number, per the class-rules table from epic
 * #1338. Mirrors `lib/voice/session-rules.ts::finaliseCounterFlags`,
 * with the addition that backfill knows the final `status` (so we
 * collapse GHOST/FAILED to false directly).
 */
function shouldCountTowardLearnerNumber(args: ClassRuleInputs): boolean {
  if (args.status === "GHOST" || args.status === "FAILED") return false;
  if (args.kind !== "VOICE_CALL") return false; // SIM is a harness; chat/intake/assessment are not learner calls
  if (args.status === "ACTIVE" || args.status === "STARTED") return false; // not completed yet
  if (args.durationSeconds !== null && args.durationSeconds < DEFAULT_MIN_LEARNER_DURATION_SECONDS) {
    return false;
  }
  return true;
}

interface BackfillSummary {
  callersTouched: number;
  sessionsUpdated: number;
  sessionsCounted: number;
  sessionsNotCounted: number;
  gapsDetected: number;
}

async function backfillForCaller(
  callerId: string,
  dryRun: boolean,
): Promise<{ updated: number; counted: number; notCounted: number; gap: boolean }> {
  const sessions: SessionRow[] = await prisma.session.findMany({
    where: { callerId },
    orderBy: { startedAt: "asc" },
    select: {
      id: true,
      callerId: true,
      kind: true,
      status: true,
      startedAt: true,
      endedAt: true,
      countsTowardLearnerNumber: true,
      learnerFacingNumber: true,
    },
  });

  let counter = 0;
  const writes: Array<{
    id: string;
    countsTowardLearnerNumber: boolean;
    learnerFacingNumber: number | null;
  }> = [];

  for (const s of sessions) {
    const durationSeconds =
      s.endedAt && s.startedAt
        ? Math.max(0, (s.endedAt.getTime() - s.startedAt.getTime()) / 1000)
        : null;
    const counts = shouldCountTowardLearnerNumber({
      kind: s.kind,
      status: s.status,
      durationSeconds,
    });
    let lfn: number | null = null;
    if (counts) {
      counter += 1;
      lfn = counter;
    }
    if (s.countsTowardLearnerNumber !== counts || s.learnerFacingNumber !== lfn) {
      writes.push({ id: s.id, countsTowardLearnerNumber: counts, learnerFacingNumber: lfn });
    }
  }

  // Sanity: the running counter == count of qualifying writes.
  const countedWrites = writes.filter((w) => w.countsTowardLearnerNumber).length;
  const finalCounter = counter;
  const notCounted = writes.length - countedWrites;

  if (!dryRun && writes.length > 0) {
    await prisma.$transaction(
      writes.map((w) =>
        prisma.session.update({
          where: { id: w.id },
          data: {
            countsTowardLearnerNumber: w.countsTowardLearnerNumber,
            learnerFacingNumber: w.learnerFacingNumber,
          },
        }),
      ),
    );
  }

  // Verify post-state: MAX(learnerFacingNumber) == COUNT(qualifying).
  let gap = false;
  if (!dryRun) {
    const verify = await prisma.session.aggregate({
      where: { callerId, countsTowardLearnerNumber: true },
      _max: { learnerFacingNumber: true },
      _count: { _all: true },
    });
    const maxLfn = verify._max.learnerFacingNumber ?? 0;
    const qualifyingCount = verify._count._all;
    if (maxLfn !== qualifyingCount) {
      gap = true;
      console.warn(
        `[backfill] caller=${callerId.slice(0, 8)} GAP DETECTED — MAX(lfn)=${maxLfn} but qualifying count=${qualifyingCount}`,
      );
    }
  }

  return {
    updated: writes.length,
    counted: dryRun ? countedWrites : finalCounter,
    notCounted,
    gap,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry");
  const callerIdx = args.indexOf("--caller");
  const onlyCaller = callerIdx >= 0 && args[callerIdx + 1] ? args[callerIdx + 1] : null;

  const startedAt = Date.now();
  const summary: BackfillSummary = {
    callersTouched: 0,
    sessionsUpdated: 0,
    sessionsCounted: 0,
    sessionsNotCounted: 0,
    gapsDetected: 0,
  };

  const callerIds: string[] = onlyCaller
    ? [onlyCaller]
    : (
        await prisma.session.findMany({
          distinct: ["callerId"],
          select: { callerId: true },
        })
      ).map((r) => r.callerId);

  console.log(
    `[backfill] starting${dryRun ? " (DRY RUN)" : ""} — ${callerIds.length} caller(s) to process`,
  );

  for (const callerId of callerIds) {
    const result = await backfillForCaller(callerId, dryRun);
    summary.callersTouched += 1;
    summary.sessionsUpdated += result.updated;
    summary.sessionsCounted += result.counted;
    summary.sessionsNotCounted += result.notCounted;
    if (result.gap) summary.gapsDetected += 1;
    if (result.updated > 0) {
      console.log(
        `[backfill] caller=${callerId.slice(0, 8)} updated=${result.updated} counted=${result.counted} not-counted=${result.notCounted}`,
      );
    }
  }

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log(
    `\n[backfill] DONE${dryRun ? " (DRY RUN)" : ""} in ${elapsed}s — ` +
      `callers=${summary.callersTouched} sessions-updated=${summary.sessionsUpdated} ` +
      `counted=${summary.sessionsCounted} not-counted=${summary.sessionsNotCounted} ` +
      `gaps=${summary.gapsDetected}`,
  );
  if (summary.gapsDetected > 0) {
    console.error(
      "[backfill] ❌ At least one caller has gaps. Run `scripts/proof-1344-cutover.ts` for the diagnostic.",
    );
    process.exit(1);
  }
  console.log("[backfill] ✓ all callers gap-free");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[backfill] fatal error:", err);
  prisma.$disconnect().finally(() => process.exit(1));
});
