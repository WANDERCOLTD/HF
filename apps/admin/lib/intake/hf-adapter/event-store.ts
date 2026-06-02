// Tallyseal EventStorePort wiring against HF's existing PrismaClient.
//
// @tallyseal/prisma-adapter ships its own SQL migration that creates
// the tallyseal_* tables (tallyseal_intent, tallyseal_event,
// tallyseal_suggestion, _tallyseal_migrations) via raw SQL — HF's
// schema.prisma does NOT need any Tallyseal model declarations.
//
// applyMigrations() is idempotent. We invoke it lazily on first event
// store access so cold starts pay the migration cost once. Production
// deploys with NODE_ENV=production should run migrations as part of
// the deploy job, not on first request — see ensureMigrated() comment.

import {
  PrismaEventStore,
  applyMigrations,
  type PrismaClientLike,
} from "@tallyseal/prisma-adapter";
import { prisma } from "@/lib/prisma";

let storeSingleton: PrismaEventStore | null = null;
let migrationsAppliedAt: Date | null = null;
let migrationsInFlight: Promise<void> | null = null;

/**
 * Idempotent lazy migration runner. Runs the bundled
 * @tallyseal/prisma-adapter migrations on the active Prisma client.
 *
 * IN PRODUCTION: the deploy job SHOULD run migrations explicitly via
 * `scripts/apply-tallyseal-migrations.ts` (TBA). Lazy first-request
 * apply is a dev/sandbox convenience; in production it can cause the
 * first request after deploy to pay the migration cost (typically
 * sub-second for the initial schema, but unpredictable for larger
 * additive migrations).
 */
export async function ensureMigrated(): Promise<void> {
  if (migrationsAppliedAt) return;
  if (migrationsInFlight) {
    await migrationsInFlight;
    return;
  }
  migrationsInFlight = (async () => {
    const result = await applyMigrations(prisma as unknown as PrismaClientLike);
    migrationsAppliedAt = new Date();
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[intake] tallyseal migrations: ${result.applied.length} applied, ${result.skipped.length} skipped`,
      );
    }
  })();
  try {
    await migrationsInFlight;
  } finally {
    migrationsInFlight = null;
  }
}

/**
 * Get the singleton event store, ensuring migrations are applied
 * first. All HF intake code paths that need to read/write events go
 * through this.
 */
export async function getEventStore(): Promise<PrismaEventStore> {
  await ensureMigrated();
  if (!storeSingleton) {
    storeSingleton = new PrismaEventStore(prisma as unknown as PrismaClientLike);
  }
  return storeSingleton;
}

/**
 * Test-only: reset singletons so test runs don't bleed state across
 * fixtures. NOT exported from the lib/intake barrel — tests import
 * the relative path directly.
 */
export function __resetForTests(): void {
  storeSingleton = null;
  migrationsAppliedAt = null;
  migrationsInFlight = null;
}
