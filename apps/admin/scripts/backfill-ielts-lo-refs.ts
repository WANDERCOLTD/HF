/**
 * Demo-fix: backfill ContentAssertion.learningOutcomeRef for IELTS Speaking
 * Practice by parsing the "(REF-NN)" token from assertion.
 *
 * Durable fix tracked separately — this is a one-shot for the Market Test
 * demo so the Curriculum tab stops grouping every TP under "Unassigned".
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const PLAYBOOK_ID = process.argv[2];
if (!PLAYBOOK_ID) {
  console.error("Usage: tsx backfill-ielts-lo-refs.ts <playbookId>");
  process.exit(1);
}

const REF_RE = /\(([A-Z]+-\d+)\)/;

async function main() {
  const ps = await prisma.playbookSource.findMany({
    where: { playbookId: PLAYBOOK_ID },
    select: { sourceId: true },
  });
  const sourceIds = ps.map((p) => p.sourceId);
  if (sourceIds.length === 0) {
    console.log("[backfill] no PlaybookSource rows");
    return;
  }

  const tps = await prisma.contentAssertion.findMany({
    where: {
      sourceId: { in: sourceIds },
      learningOutcomeRef: null,
    },
    select: { id: true, assertion: true },
  });
  console.log(`[backfill] ${tps.length} TPs with null learningOutcomeRef`);

  let updated = 0;
  let skipped = 0;
  for (const tp of tps) {
    const m = tp.assertion?.match(REF_RE);
    if (!m) {
      skipped++;
      continue;
    }
    const ref = m[1];
    await prisma.contentAssertion.update({
      where: { id: tp.id },
      data: { learningOutcomeRef: ref },
    });
    updated++;
    console.log(`  ${tp.id} -> ${ref}`);
  }
  console.log(`[backfill] updated=${updated} skipped=${skipped}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
