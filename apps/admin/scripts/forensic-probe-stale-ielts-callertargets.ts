/**
 * #2305 — Forensic probe for stale IELTS skill CallerTarget rows.
 *
 * READ-ONLY. Samples 5 of the non-null IELTS skill CallerTarget rows on
 * the connected DB and prints, per row:
 *   - caller name + id
 *   - parameterId
 *   - currentScore + lastScoredAt + updatedAt + createdAt
 *   - CallScore count for this exact (callerId, parameterId)
 *   - CallScore count for ANY parameterId on this caller (sanity context)
 *
 * Aggregate: of all non-null IELTS skill CallerTarget rows, how many
 * have at least one matching CallScore (legitimately scored) vs zero
 * (stale — the #2305 fingerprint).
 *
 * Tech-lead verdict (READY TO BUILD,
 * https://github.com/WANDERCOLTD/HF/issues/2305#issuecomment-4788268055):
 * the sole canonical writer of `CallerTarget.currentScore` is
 * `lib/pipeline/aggregate-runner.ts::accumulateSkillScores`. Pre-#2138
 * `lib/pipeline/prosody-consumer.ts` (retired) wrote currentScore
 * directly under IELTS skill IDs without writing a paired CallScore —
 * that path is the suspected origin of the stale rows.
 *
 * Run command (operator, on hf-dev VM bound to hf_sandbox):
 *   cd ~/HF/apps/admin
 *   npx tsx scripts/forensic-probe-stale-ielts-callertargets.ts
 *
 * To run against hf_staging, point DATABASE_URL at the staging secret
 * before invocation.
 *
 * Exit codes:
 *   0 — probe ran successfully (the row counts are the report; non-zero
 *       stale counts are NOT a failure here — they're the finding)
 *   1 — database unreachable / probe itself errored
 */

import { prisma } from "@/lib/prisma";

const IELTS_SKILL_PARAMETER_IDS = [
  "skill_fluency_and_coherence_fc",
  "skill_lexical_resource_lr",
  "skill_grammatical_range_and_accuracy_gra",
  "skill_pronunciation_p",
] as const;

interface SampleRow {
  callerTargetId: string;
  callerId: string;
  callerName: string | null;
  parameterId: string;
  currentScore: number | null;
  lastScoredAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
}

async function probe(): Promise<void> {
  console.log(
    "\n=== #2305 forensic probe — stale IELTS skill CallerTarget rows ===\n",
  );

  // Aggregate counts first — overall picture before sampling.
  const totalIeltsRows = await prisma.callerTarget.count({
    where: {
      parameterId: { in: [...IELTS_SKILL_PARAMETER_IDS] },
      currentScore: { not: null },
    },
  });

  console.log(`Total non-null IELTS skill CallerTarget rows: ${totalIeltsRows}`);

  if (totalIeltsRows === 0) {
    console.log(
      "\n  ✓ No non-null IELTS skill CallerTarget rows on this DB. Nothing to investigate.\n",
    );
    return;
  }

  // For each non-null row, determine whether there's a matching CallScore.
  // Group classification:
  //   - "legitimate": >= 1 CallScore row with same (callerId, parameterId)
  //   - "stale":      0 CallScore rows with same (callerId, parameterId)
  const allRows = await prisma.callerTarget.findMany({
    where: {
      parameterId: { in: [...IELTS_SKILL_PARAMETER_IDS] },
      currentScore: { not: null },
    },
    select: {
      id: true,
      callerId: true,
      parameterId: true,
      currentScore: true,
      lastScoredAt: true,
      updatedAt: true,
      createdAt: true,
      caller: { select: { name: true } },
    },
  });

  let legitimateCount = 0;
  let staleCount = 0;
  for (const row of allRows) {
    const scoreCount = await prisma.callScore.count({
      where: { callerId: row.callerId, parameterId: row.parameterId },
    });
    if (scoreCount > 0) {
      legitimateCount++;
    } else {
      staleCount++;
    }
  }

  console.log(`  legitimately scored (>=1 CallScore match): ${legitimateCount}`);
  console.log(`  stale (0 CallScore match):                  ${staleCount}`);
  console.log("");

  // Sample 5 STALE rows for the per-row detail report (the #2305 fingerprint).
  // If there are fewer than 5 stale rows, fall through to legitimate rows so
  // the operator still sees concrete examples.
  const sampleCount = Math.min(5, allRows.length);
  const samples: SampleRow[] = [];

  // Prefer stale rows for the sample (they're what the story is about).
  for (const row of allRows) {
    if (samples.length >= sampleCount) break;
    const scoreCount = await prisma.callScore.count({
      where: { callerId: row.callerId, parameterId: row.parameterId },
    });
    if (scoreCount === 0) {
      samples.push({
        callerTargetId: row.id,
        callerId: row.callerId,
        callerName: row.caller?.name ?? null,
        parameterId: row.parameterId,
        currentScore: row.currentScore,
        lastScoredAt: row.lastScoredAt,
        updatedAt: row.updatedAt,
        createdAt: row.createdAt,
      });
    }
  }
  // Top up with legitimate rows if needed.
  if (samples.length < sampleCount) {
    for (const row of allRows) {
      if (samples.length >= sampleCount) break;
      const already = samples.find((s) => s.callerTargetId === row.id);
      if (already) continue;
      samples.push({
        callerTargetId: row.id,
        callerId: row.callerId,
        callerName: row.caller?.name ?? null,
        parameterId: row.parameterId,
        currentScore: row.currentScore,
        lastScoredAt: row.lastScoredAt,
        updatedAt: row.updatedAt,
        createdAt: row.createdAt,
      });
    }
  }

  console.log(`=== Per-row sample (n=${samples.length}, stale-first) ===\n`);
  for (const s of samples) {
    const matchingScores = await prisma.callScore.count({
      where: { callerId: s.callerId, parameterId: s.parameterId },
    });
    const anyScores = await prisma.callScore.count({
      where: { callerId: s.callerId },
    });
    const verdict = matchingScores === 0 ? "STALE" : "legitimate";
    console.log(`  • [${verdict}] callerName=${s.callerName ?? "?"}`);
    console.log(`      callerId           = ${s.callerId}`);
    console.log(`      callerTargetId     = ${s.callerTargetId}`);
    console.log(`      parameterId        = ${s.parameterId}`);
    console.log(`      currentScore       = ${s.currentScore}`);
    console.log(`      lastScoredAt       = ${s.lastScoredAt?.toISOString() ?? "null"}`);
    console.log(`      createdAt          = ${s.createdAt.toISOString()}`);
    console.log(`      updatedAt          = ${s.updatedAt.toISOString()}`);
    console.log(`      matchingCallScores = ${matchingScores}`);
    console.log(`      anyCallerScores    = ${anyScores}`);
    console.log("");
  }

  console.log("=== Summary ===\n");
  console.log(`  Total non-null IELTS skill CallerTarget rows: ${totalIeltsRows}`);
  console.log(`    legitimately scored: ${legitimateCount}`);
  console.log(`    stale (drain target): ${staleCount}`);
  console.log("");
  console.log(
    "Next step: paste these counts into the PR body and run the drain script in --dry-run mode.",
  );
  console.log(
    "  npx tsx scripts/drain-stale-ielts-skill-callertargets.ts          # dry-run (default)",
  );
  console.log(
    "  npx tsx scripts/drain-stale-ielts-skill-callertargets.ts --apply  # actually NULL",
  );
  console.log("");
}

async function main(): Promise<void> {
  try {
    await probe();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[forensic-probe] FAILED: ${message}\n` +
        "  Likely cause: database unreachable. Confirm DATABASE_URL is set and the bound DB is reachable.",
    );
    process.exit(1);
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

void main();
