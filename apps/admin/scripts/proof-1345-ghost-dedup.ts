/**
 * #1345 Proof Script — Ghost-row dedup verification.
 *
 * Run against any DB to assert no long-lived ghost Call rows exist.
 * Idempotent. Read-only. Exits non-zero on mismatch.
 *
 * Bertie's ghost class:
 *   Call rows with endedAt IS NULL, voiceProvider IS NOT NULL, older
 *   than 5 minutes — meaning the row was never closed by webhook OR
 *   the poll-stale-calls reconciler. Post-#1345 these should not exist.
 *
 * Usage:
 *   npx tsx apps/admin/scripts/proof-1345-ghost-dedup.ts
 *
 * Output: structured PASS / FAIL with diff. The script does NOT modify
 * any rows; it's safe to run against hf_sandbox, dev, staging, or prod.
 */

import { PrismaClient } from "@prisma/client";

interface GhostRow {
  id: string;
  callerId: string | null;
  voiceProvider: string;
  externalId: string | null;
  createdAt: Date;
  source: string;
}

async function main() {
  const prisma = new PrismaClient();

  let ghosts: GhostRow[];
  try {
    ghosts = await prisma.$queryRaw<GhostRow[]>`
      SELECT c."id", c."callerId", c."voiceProvider", c."externalId",
             c."createdAt", c."source"
      FROM "Call" c
      WHERE c."endedAt" IS NULL
        AND c."createdAt" < NOW() - INTERVAL '5 minutes'
        AND c."voiceProvider" IS NOT NULL
      ORDER BY c."createdAt" DESC
      LIMIT 100
    `;
  } catch (err) {
    console.error(
      `[proof-1345] FAIL — database query threw: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    await prisma.$disconnect().catch(() => undefined);
    process.exit(2);
  }

  await prisma.$disconnect();

  if (ghosts.length === 0) {
    console.log("[proof-1345] PASS — no long-lived ghost Call rows detected.");
    console.log(
      "  Criterion: COUNT(Call WHERE endedAt IS NULL AND createdAt < NOW() - INTERVAL '5 minutes' AND voiceProvider IS NOT NULL) == 0",
    );
    process.exit(0);
  }

  console.error(
    `[proof-1345] FAIL — ${ghosts.length} long-lived ghost Call row(s) detected.`,
  );
  console.error(
    "  Criterion: COUNT(Call WHERE endedAt IS NULL AND createdAt < NOW() - INTERVAL '5 minutes' AND voiceProvider IS NOT NULL) == 0",
  );
  console.error("  Sample (up to 10):");
  for (const g of ghosts.slice(0, 10)) {
    const ageMinutes = Math.round(
      (Date.now() - g.createdAt.getTime()) / 60_000,
    );
    console.error(
      `    • id=${g.id} callerId=${g.callerId ?? "—"} voiceProvider=${g.voiceProvider} externalId=${g.externalId ?? "—"} age=${ageMinutes}m`,
    );
  }
  if (ghosts.length > 10) {
    console.error(`    … (+${ghosts.length - 10} more)`);
  }
  console.error(
    "  Investigation: check outbound-dial logs for `voice.outbound_dial.externalid_stamp_failed`",
  );
  console.error(
    "  and persistEndOfCall logs for placeholders that the dedup window missed.",
  );
  process.exit(1);
}

main().catch((err) => {
  console.error("[proof-1345] uncaught error:", err);
  process.exit(2);
});
