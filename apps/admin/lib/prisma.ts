import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// ── Transaction helpers ───────────────────────────────
// Shared type for interactive transaction clients.
// Functions that accept `tx?: TxClient` can be called both
// inside and outside a prisma.$transaction() — the `db()` helper
// returns the transaction client if provided, or the global singleton.

export type TxClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export function db(tx?: TxClient): TxClient {
  return tx ?? prisma;
}

// Note: Slow query metering is available via lib/metering/usage-logger.ts
// For automatic tracking, use the logSlowQuery helper when instrumenting
// specific expensive operations. Prisma middleware-based tracking can be
// added in a future iteration using $extends or query event logging.