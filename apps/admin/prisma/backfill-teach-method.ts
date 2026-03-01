/**
 * Backfill teachMethod on existing ContentAssertions where teachMethod is null.
 *
 * Uses the canonical categoryToTeachMethod from resolve-config.ts with default
 * "recall" teaching mode. For teaching-mode-aware backfill, use
 * scripts/backfill-teach-method.ts instead.
 *
 * Usage:
 *   npx tsx prisma/backfill-teach-method.ts
 */

import { PrismaClient } from "@prisma/client";
import { categoryToTeachMethod } from "@/lib/content-trust/resolve-config";

const prisma = new PrismaClient();

async function main() {
  const nullCount = await prisma.contentAssertion.count({
    where: { teachMethod: null },
  });
  console.log(`Found ${nullCount} assertions with no teachMethod`);

  if (nullCount === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  // Fetch in batches to avoid loading everything at once
  const BATCH = 500;
  let updated = 0;
  let skip = 0;

  while (true) {
    const rows = await prisma.contentAssertion.findMany({
      where: { teachMethod: null },
      select: { id: true, category: true },
      take: BATCH,
      skip,
    });

    if (rows.length === 0) break;

    // Group by teachMethod to minimise round-trips
    const byMethod = new Map<string, string[]>();
    for (const row of rows) {
      const method = categoryToTeachMethod(row.category ?? "", "recall");
      if (!byMethod.has(method)) byMethod.set(method, []);
      byMethod.get(method)!.push(row.id);
    }

    for (const [method, ids] of byMethod) {
      await prisma.contentAssertion.updateMany({
        where: { id: { in: ids } },
        data: { teachMethod: method },
      });
      console.log(`  ${method}: ${ids.length} updated`);
      updated += ids.length;
    }

    skip += rows.length;
    if (rows.length < BATCH) break;
  }

  console.log(`\nDone. ${updated} / ${nullCount} assertions backfilled.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
