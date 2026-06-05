// Seed a synthetic tallyseal_intent row for the Phase 1 admin-bridge
// dogfood — gives Tracy something to see in the admin-viewer intent
// list. Removable post-dogfood (DELETE by the fixture id).
//
// Why this exists: the bridge's intentLister reads from
// tallyseal_intent (Phase 1 partial wiring per
// bridge-callbacks.ts). Intake bootstrap (POST /api/intake/bootstrap)
// uses an in-memory session store — Phase 1.5 — so no real rows land
// in tallyseal_intent today. This script bypasses that gap.
//
// Usage on hf-dev VM:
//   cd apps/admin && npx tsx scripts/seed-tallyseal-intent-fixture.ts
//
// To remove:
//   cd apps/admin && npx tsx scripts/seed-tallyseal-intent-fixture.ts --remove

import { PrismaClient } from "@prisma/client";

const FIXTURE_ID = "intent_fixture_dogfood_001";
const FIXTURE_KEY = "EnrollmentIntake";
const FIXTURE_TENANT_ID = "tenant_hf_dev";

async function main() {
  const remove = process.argv.includes("--remove");
  const prisma = new PrismaClient();

  try {
    if (remove) {
      const result = await prisma.$executeRawUnsafe(
        `DELETE FROM tallyseal_intent WHERE id = $1`,
        FIXTURE_ID,
      );
      console.log(`Removed fixture intent (rows affected: ${result})`);
      return;
    }

    const exists = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint AS count FROM tallyseal_intent WHERE id = $1`,
      FIXTURE_ID,
    );
    if (exists[0]?.count && Number(exists[0].count) > 0) {
      console.log(`Fixture intent ${FIXTURE_ID} already present — skipping.`);
      return;
    }

    await prisma.$executeRawUnsafe(
      `INSERT INTO tallyseal_intent
         (id, tenant_id, key, spec_version, state, snapshot, created_at, updated_at)
       VALUES
         ($1, $2, $3, 1, 'open', '{}'::jsonb, NOW(), NOW())`,
      FIXTURE_ID,
      FIXTURE_TENANT_ID,
      FIXTURE_KEY,
    );

    console.log(
      `Seeded fixture intent: ${FIXTURE_ID} (key=${FIXTURE_KEY}, tenant=${FIXTURE_TENANT_ID})`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
