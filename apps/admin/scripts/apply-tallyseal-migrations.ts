/**
 * Apply @tallyseal/prisma-adapter raw-SQL migrations explicitly.
 *
 * Why this exists:
 *   `applyMigrations()` is idempotent and is also called lazily by
 *   `ensureMigrated()` in `lib/intake/hf-adapter/event-store.ts` on
 *   the first event-store read/write. In production, paying that
 *   cost on the first request after deploy is unbounded (5 new
 *   migrations from prisma-adapter 0.0.5 alone). This script runs
 *   them ahead of time as part of the deploy pipeline so the first
 *   user request hits a warm DB.
 *
 * Usage:
 *   npx tsx scripts/apply-tallyseal-migrations.ts
 *   # or via npm script:
 *   npm run tallyseal:migrate
 *
 * Output:
 *   { applied: [...], skipped: [...] }
 *
 * Exit codes:
 *   0  All migrations idempotently applied (or already applied).
 *   1  Migration failure — the ledger row is NOT written for the
 *      failing migration, so re-running this script picks up where
 *      it left off.
 *
 * Idempotency: applyMigrations() consults the `_tallyseal_migrations`
 * ledger and skips already-applied files; safe to run repeatedly.
 *
 * Wire-up: /vm-cpp's deploy heredoc should call this between
 * `npx prisma migrate deploy` and `npx prisma generate` so tallyseal
 * tables are present before any tallyseal-using code starts.
 */

import { applyMigrations, type PrismaClientLike } from "@tallyseal/prisma-adapter";
import { prisma } from "@/lib/prisma";

async function main(): Promise<void> {
  const start = Date.now();
  const result = await applyMigrations(prisma as unknown as PrismaClientLike);
  const elapsedMs = Date.now() - start;

  const appliedCount = result.applied.length;
  const skippedCount = result.skipped.length;

  if (appliedCount === 0 && skippedCount === 0) {
    console.log("[tallyseal-migrate] No migrations to apply (empty migrations directory?).");
    return;
  }

  console.log(`[tallyseal-migrate] Applied ${appliedCount}, skipped ${skippedCount} in ${elapsedMs}ms.`);

  if (appliedCount > 0) {
    console.log("[tallyseal-migrate] Applied:");
    for (const m of result.applied) {
      console.log(`  + ${m.filename}  (checksum: ${m.checksum.slice(0, 12)}…)`);
    }
  }
  if (skippedCount > 0 && process.env.VERBOSE) {
    console.log("[tallyseal-migrate] Skipped (already applied):");
    for (const m of result.skipped) {
      console.log(`  · ${m.filename}`);
    }
  }
}

main()
  .catch((err: unknown) => {
    console.error("[tallyseal-migrate] FAILED:", err instanceof Error ? err.message : err);
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
