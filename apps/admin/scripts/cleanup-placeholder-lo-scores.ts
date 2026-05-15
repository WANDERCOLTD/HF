/**
 * #403 data correction — zero out `CallerModuleProgress.loScoresJson` rows
 * whose keys match the placeholder pattern /^LO\d+$/.
 *
 * Before #403, the pipeline's AI-extract prompt told the model to use keys
 * like "LO1", "LO2"… so the accumulated `loScoresJson` is scientifically
 * meaningless — keys don't correspond to any real LearningObjective. The
 * rollup from those keys is also wrong.
 *
 * Recovery: zero `loScoresJson` and `mastery` so the row falls back to the
 * Phase 0 cap on the next pipeline run, then accumulates from scratch with
 * real refs.
 *
 * Run on hf-dev VM (or via /vm-cpp post-deploy):
 *   npx tsx scripts/cleanup-placeholder-lo-scores.ts
 *
 * Add `--dry-run` to preview without writing.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

const PLACEHOLDER = /^LO\d+$/;

function hasPlaceholderKey(scoresJson: unknown): boolean {
  if (!scoresJson || typeof scoresJson !== "object" || Array.isArray(scoresJson)) return false;
  return Object.keys(scoresJson as Record<string, unknown>).some((k) => PLACEHOLDER.test(k));
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const rows = await prisma.callerModuleProgress.findMany({
    where: { loScoresJson: { not: Prisma.DbNull } },
    select: { id: true, callerId: true, moduleId: true, mastery: true, loScoresJson: true },
  });

  const affected = rows.filter((r) => hasPlaceholderKey(r.loScoresJson));

  console.log(`[cleanup-placeholder-lo-scores] Scanned ${rows.length} row(s) with non-null loScoresJson.`);
  console.log(`[cleanup-placeholder-lo-scores] ${affected.length} row(s) contain placeholder LO keys.`);

  if (affected.length === 0) {
    console.log("[cleanup-placeholder-lo-scores] Nothing to do.");
    return;
  }

  for (const r of affected.slice(0, 10)) {
    console.log(
      `  - caller=${r.callerId} module=${r.moduleId} mastery=${r.mastery} keys=${Object.keys(
        r.loScoresJson as Record<string, unknown>,
      )}`,
    );
  }
  if (affected.length > 10) console.log(`  ... and ${affected.length - 10} more`);

  if (dryRun) {
    console.log("[cleanup-placeholder-lo-scores] --dry-run: no writes performed.");
    return;
  }

  const result = await prisma.callerModuleProgress.updateMany({
    where: { id: { in: affected.map((r) => r.id) } },
    data: { loScoresJson: Prisma.DbNull, mastery: 0 },
  });

  console.log(`[cleanup-placeholder-lo-scores] Reset ${result.count} row(s). Next pipeline run repopulates from real LO refs.`);
}

main()
  .catch((err) => {
    console.error("[cleanup-placeholder-lo-scores] FAILED:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
