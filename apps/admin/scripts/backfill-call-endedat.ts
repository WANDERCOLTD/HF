/**
 * Backfill Call.endedAt for completed historical rows where it is NULL.
 *
 * Background: the VAPI webhook (`end-of-call-report`) and the bulk
 * transcripts-process path were not stamping `endedAt` at create time. The
 * composer's loaders (`callCount` + `recentCalls`) filter `endedAt: { not: null }`,
 * so every real VAPI call silently dropped out — leaving `callNumber` stuck
 * at 1 forever for those learners.
 *
 * Fix: for every Call with `endedAt IS NULL` AND a non-empty transcript
 * (i.e. a call that actually happened, not a pre-call placeholder), set
 * `endedAt = createdAt`. Onboarding-call placeholder rows (created BEFORE
 * the conversation, empty transcript) are correctly skipped.
 *
 * Idempotent: re-running after a clean backfill is a no-op.
 *
 * Run on VM:
 *   npx tsx scripts/backfill-call-endedat.ts            (dry-run, default)
 *   npx tsx scripts/backfill-call-endedat.ts --execute  (apply changes)
 */

import { prisma } from "@/lib/prisma";

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const dryRun = !execute;

  console.log(
    `\n=== Backfill Call.endedAt ===\n` +
    `  mode: ${dryRun ? "DRY-RUN (pass --execute to apply)" : "EXECUTE"}\n`,
  );

  // Filter: endedAt is null AND transcript is meaningful. "(no transcript)"
  // is the VAPI webhook placeholder when nothing was captured — those rows
  // represent a real call that completed but with no audio/text, so they
  // should still get endedAt. Empty string is the onboarding-call
  // placeholder (created BEFORE the call) — skip those.
  const totalNull = await prisma.call.count({
    where: {
      endedAt: null,
      transcript: { not: "" },
    },
  });
  console.log(`  calls with null endedAt + non-empty transcript: ${totalNull}`);

  if (totalNull === 0) {
    console.log("\nNothing to do.\n");
    return;
  }

  // Sample the affected rows for transparency.
  const sample = await prisma.call.findMany({
    where: { endedAt: null, transcript: { not: "" } },
    select: { id: true, source: true, createdAt: true, callerId: true },
    orderBy: { createdAt: "asc" },
    take: 5,
  });
  console.log(`  sample (first 5):`);
  for (const c of sample) {
    console.log(
      `    ${c.id.slice(0, 8)}…  source=${c.source}  created=${c.createdAt.toISOString()}  caller=${c.callerId?.slice(0, 8) ?? "(none)"}`,
    );
  }

  if (dryRun) {
    console.log(`\nWould set endedAt = createdAt on ${totalNull} call(s).\n`);
    console.log(`Run again with --execute to apply.\n`);
    return;
  }

  // Apply in a single raw UPDATE — much faster than per-row update for
  // potentially thousands of historical rows. The condition mirrors the
  // count above. Onboarding-call placeholders (empty transcript) are
  // untouched.
  const updated = await prisma.$executeRaw`
    UPDATE "Call"
    SET    "endedAt" = "createdAt"
    WHERE  "endedAt" IS NULL
      AND  "transcript" != ''
  `;

  console.log(`\n=== Done ===\n  rows updated: ${updated}\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
