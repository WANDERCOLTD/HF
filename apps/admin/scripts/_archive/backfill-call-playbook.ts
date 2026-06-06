/**
 * Backfill playbookId on Call records that have it null.
 *
 * Resolves the caller's default enrollment via resolvePlaybookId() and stamps
 * the result. Groups by callerId so each caller is resolved once.
 *
 * Run on VM:
 *   npx tsx scripts/backfill-call-playbook.ts            (dry-run, default)
 *   npx tsx scripts/backfill-call-playbook.ts --execute  (apply changes)
 *
 * Source filter (default): sim, ai-simulation, import, VAPI, playground-upload
 *   --source-all   Skip the filter; backfill every null-playbookId call
 */

import { prisma } from "@/lib/prisma";
import { resolvePlaybookId } from "@/lib/enrollment/resolve-playbook";

const DEFAULT_SOURCES = [
  "sim",
  "ai-simulation",
  "import",
  "VAPI",
  "playground-upload",
];

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const sourceAll = args.includes("--source-all");
  const dryRun = !execute;

  const sourceFilter = sourceAll ? {} : { source: { in: DEFAULT_SOURCES } };

  console.log(
    `\n=== Backfill Call.playbookId ===\n` +
    `  mode: ${dryRun ? "DRY-RUN" : "EXECUTE"}\n` +
    `  source filter: ${sourceAll ? "ALL" : DEFAULT_SOURCES.join(", ")}\n`,
  );

  const totalNull = await prisma.call.count({
    where: { playbookId: null, ...sourceFilter },
  });

  if (totalNull === 0) {
    console.log("No calls with null playbookId. Nothing to do.\n");
    return;
  }

  console.log(`Calls with null playbookId: ${totalNull}\n`);

  // Group by callerId so we resolve once per caller
  const grouped = await prisma.call.groupBy({
    by: ["callerId"],
    where: { playbookId: null, ...sourceFilter },
    _count: { _all: true },
  });

  console.log(`Distinct callers to resolve: ${grouped.length}\n`);

  let stamped = 0;
  let unresolved = 0;
  let nullCallerSkipped = 0;
  const breakdown: Array<{
    callerId: string | null;
    callCount: number;
    resolvedPlaybookId: string | null;
  }> = [];

  for (const g of grouped) {
    if (!g.callerId) {
      nullCallerSkipped += g._count._all;
      breakdown.push({
        callerId: null,
        callCount: g._count._all,
        resolvedPlaybookId: null,
      });
      continue;
    }

    const resolved = await resolvePlaybookId(g.callerId);
    breakdown.push({
      callerId: g.callerId,
      callCount: g._count._all,
      resolvedPlaybookId: resolved,
    });

    if (!resolved) {
      unresolved += g._count._all;
      continue;
    }

    if (!dryRun) {
      const result = await prisma.call.updateMany({
        where: {
          callerId: g.callerId,
          playbookId: null,
          ...sourceFilter,
        },
        data: { playbookId: resolved },
      });
      stamped += result.count;
    } else {
      stamped += g._count._all;
    }
  }

  console.log("\n=== Per-caller breakdown ===");
  for (const row of breakdown) {
    const status = row.resolvedPlaybookId
      ? `→ ${row.resolvedPlaybookId}`
      : row.callerId
        ? "→ UNRESOLVED (no enrollment / multi-enroll no default)"
        : "→ SKIPPED (null callerId)";
    console.log(`  ${row.callerId ?? "(null)"} (${row.callCount} calls) ${status}`);
  }

  console.log(
    `\n=== Summary ===\n` +
    `  ${dryRun ? "Would stamp" : "Stamped"}: ${stamped}\n` +
    `  Unresolved (skipped): ${unresolved}\n` +
    `  Null-callerId (skipped): ${nullCallerSkipped}\n`,
  );

  if (dryRun) {
    console.log("Re-run with --execute to apply.\n");
  } else {
    console.log("Done.\n");
  }
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
