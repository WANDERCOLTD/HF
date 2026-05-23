/**
 * Backfill Call.callSequence for rows where it is NULL.
 *
 * Background: VAPI webhook and the bulk transcripts-process path were not
 * stamping callSequence at create time, so many historic Call rows have it
 * null. The prompt timeline renders "Call N" from callSequence — null rows
 * show as "—" or shuffle.
 *
 * Fix: for every callerId with at least one null callSequence, sort their
 * calls by createdAt and assign 1..N in chronological order. Existing
 * non-null sequences win — if some calls are already numbered, the
 * untouched ones are folded in around them by createdAt order, taking
 * the next free integer.
 *
 * Idempotent: re-running after a clean backfill is a no-op (everyone
 * has a sequence already).
 *
 * Run on VM:
 *   npx tsx scripts/backfill-call-sequence.ts            (dry-run, default)
 *   npx tsx scripts/backfill-call-sequence.ts --execute  (apply changes)
 */

import { prisma } from "@/lib/prisma";

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const dryRun = !execute;

  console.log(
    `\n=== Backfill Call.callSequence ===\n` +
    `  mode: ${dryRun ? "DRY-RUN (pass --execute to apply)" : "EXECUTE"}\n`,
  );

  const totalNull = await prisma.call.count({
    where: { callSequence: null, callerId: { not: null } },
  });
  console.log(`  calls with null callSequence + callerId: ${totalNull}`);

  if (totalNull === 0) {
    console.log("\nNothing to do.\n");
    return;
  }

  // Find every caller that has at least one null-callSequence call. We
  // re-sequence ALL of that caller's calls (not just the null ones) so the
  // numbering stays monotonic in createdAt order.
  const affected = await prisma.call.findMany({
    where: { callSequence: null, callerId: { not: null } },
    select: { callerId: true },
    distinct: ["callerId"],
  });
  const callerIds = affected.map((c) => c.callerId!).filter((id): id is string => Boolean(id));
  console.log(`  affected callers: ${callerIds.length}\n`);

  let totalUpdated = 0;
  let totalSkipped = 0;
  let callersProcessed = 0;

  for (const callerId of callerIds) {
    const calls = await prisma.call.findMany({
      where: { callerId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, callSequence: true, createdAt: true },
    });

    // Walk in chronological order. For each call, assign the next free
    // integer. If a call already has a sequence, keep it and skip; the
    // counter advances to one above its value to avoid collisions.
    let counter = 0;
    const updates: Array<{ id: string; seq: number }> = [];
    for (const call of calls) {
      if (call.callSequence != null) {
        counter = Math.max(counter, call.callSequence);
        continue;
      }
      counter += 1;
      updates.push({ id: call.id, seq: counter });
    }

    if (updates.length === 0) {
      totalSkipped += 1;
      continue;
    }

    if (dryRun) {
      console.log(`  caller ${callerId}: would update ${updates.length} call(s)`);
    } else {
      // Sequential update — small N per caller, no need for batch.
      for (const u of updates) {
        await prisma.call.update({
          where: { id: u.id },
          data: { callSequence: u.seq },
        });
      }
      console.log(`  caller ${callerId}: updated ${updates.length} call(s)`);
    }
    totalUpdated += updates.length;
    callersProcessed += 1;
  }

  console.log(
    `\n=== ${dryRun ? "Dry-run" : "Done"} ===\n` +
    `  callers processed: ${callersProcessed}\n` +
    `  callers already complete: ${totalSkipped}\n` +
    `  total updates ${dryRun ? "needed" : "applied"}: ${totalUpdated}\n`,
  );

  if (dryRun) {
    console.log(`Run again with --execute to apply.\n`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
