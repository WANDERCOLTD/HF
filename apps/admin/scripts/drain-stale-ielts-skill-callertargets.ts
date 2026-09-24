/**
 * #2305 — Drain stale IELTS skill `CallerTarget.currentScore` rows.
 *
 * Per epic #2135's rule "NEVER land hardcoded or AI-guessed score
 * defaults" + tech-lead verdict on #2305:
 *
 *   For every CallerTarget row keyed on an IELTS skill parameterId
 *   AND currentScore IS NOT NULL:
 *     - If 0 matching CallScore rows for the same (callerId, parameterId)
 *       → currentScore is fabricated signal (pre-#2138 prosody-consumer
 *         write that bypassed the canonical aggregate-runner path).
 *       Action: set currentScore = NULL.
 *     - If >=1 matching CallScore row
 *       → legitimately scored. Leave untouched. Log as preserved.
 *
 * Idempotent. `--dry-run` is the default. `--apply` actually writes.
 *
 * The canonical CallerTarget writer is
 * `lib/pipeline/aggregate-runner.ts::accumulateSkillScores`. Pre-#2138
 * `lib/pipeline/prosody-consumer.ts:19-34,239` wrote currentScore directly
 * under IELTS skill IDs (the retired path that produced this debt). Per
 * the Lattice survey: `BehaviorTarget` has the
 * `no-bare-behavior-target-write.mjs` chokepoint but `CallerTarget` does
 * NOT have one — direct `prisma.callerTarget.update` is allowed here.
 *
 * Run command (operator, on hf-dev VM bound to hf_sandbox first):
 *   cd ~/HF/apps/admin
 *   npx tsx scripts/drain-stale-ielts-skill-callertargets.ts            # dry-run
 *   npx tsx scripts/drain-stale-ielts-skill-callertargets.ts --apply    # commit
 *
 * After hf_sandbox: re-point DATABASE_URL at hf_staging and re-run.
 * Verify Query 15 in `check-fk-consistency.ts` returns 0 violations
 * post-drain.
 *
 * Exit codes:
 *   0 — drain completed (dry-run or --apply)
 *   1 — database unreachable / fatal error
 */

import { prisma } from "@/lib/prisma";

const IELTS_SKILL_PARAMETER_IDS = [
  "skill_fluency_and_coherence_fc",
  "skill_lexical_resource_lr",
  "skill_grammatical_range_and_accuracy_gra",
  "skill_pronunciation_p",
] as const;

interface DrainArgs {
  apply: boolean;
}

function parseArgs(argv: string[]): DrainArgs {
  const apply = argv.includes("--apply");
  return { apply };
}

async function drain(args: DrainArgs): Promise<void> {
  const mode = args.apply ? "APPLY" : "DRY-RUN";
  console.log(
    `\n=== #2305 drain — stale IELTS skill CallerTarget rows (${mode}) ===\n`,
  );
  if (!args.apply) {
    console.log(
      "  Mode: dry-run (no writes). Pass --apply to actually NULL rows.\n",
    );
  }

  // Fetch every non-null IELTS skill CallerTarget row.
  const candidates = await prisma.callerTarget.findMany({
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
      caller: { select: { name: true } },
    },
  });

  console.log(`Candidates scanned: ${candidates.length}\n`);

  let drained = 0;
  let preserved = 0;
  const drainedRows: Array<{
    id: string;
    callerId: string;
    callerName: string | null;
    parameterId: string;
    currentScore: number | null;
  }> = [];
  const preservedRows: Array<{
    id: string;
    callerName: string | null;
    parameterId: string;
    matchingCallScores: number;
  }> = [];

  for (const row of candidates) {
    const matchingScoreCount = await prisma.callScore.count({
      where: { callerId: row.callerId, parameterId: row.parameterId },
    });

    if (matchingScoreCount === 0) {
      // STALE — no CallScore backs this currentScore. Drain.
      drainedRows.push({
        id: row.id,
        callerId: row.callerId,
        callerName: row.caller?.name ?? null,
        parameterId: row.parameterId,
        currentScore: row.currentScore,
      });

      if (args.apply) {
        // Direct prisma.callerTarget.update is allowed — CallerTarget has no
        // chokepoint helper today (sibling BehaviorTarget does; CallerTarget
        // does not — confirmed via Lattice survey 2026-06-23). Set null on
        // currentScore; leave the rest of the row untouched (targetValue,
        // confidence, decayHalfLife, etc. are operator-set or
        // resolver-derived, not part of this drain).
        await prisma.callerTarget.update({
          where: { id: row.id },
          data: { currentScore: null, lastScoredAt: null },
        });
      }

      drained++;
      console.log(
        `  ${args.apply ? "DRAINED" : "WOULD-DRAIN"} ${row.id} ` +
          `callerName=${row.caller?.name ?? "?"} ` +
          `parameterId=${row.parameterId} ` +
          `currentScore=${row.currentScore} (no CallScore backs this row)`,
      );
    } else {
      // Legitimately scored. Leave untouched.
      preservedRows.push({
        id: row.id,
        callerName: row.caller?.name ?? null,
        parameterId: row.parameterId,
        matchingCallScores: matchingScoreCount,
      });
      preserved++;
      console.log(
        `  PRESERVED ${row.id} ` +
          `callerName=${row.caller?.name ?? "?"} ` +
          `parameterId=${row.parameterId} ` +
          `currentScore=${row.currentScore} (${matchingScoreCount} CallScore rows back this — legitimately scored)`,
      );
    }
  }

  console.log("");
  console.log("=== Summary ===\n");
  console.log(`  Total scanned:                  ${candidates.length}`);
  console.log(`  Drained stale rows:             ${drained}${args.apply ? "" : " (would-drain — dry-run)"}`);
  console.log(`  Preserved legitimately-scored:  ${preserved}`);
  console.log("");

  if (!args.apply && drained > 0) {
    console.log(
      `Re-run with --apply to commit the ${drained} stale-row NULL update.\n`,
    );
  }
  if (args.apply) {
    console.log(
      "Drain complete. Re-run Query 15 in `npm run check:fk` to verify 0 violations.\n",
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  try {
    await drain(args);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[drain-stale-ielts-skill-callertargets] FAILED: ${message}\n` +
        "  Likely cause: database unreachable. Confirm DATABASE_URL is set and the bound DB is reachable.",
    );
    process.exit(1);
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

void main();
