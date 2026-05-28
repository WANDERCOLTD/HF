/**
 * Backfill — #953 set `Subject.teachingProfile` from the subject name when
 * `suggestTeachingProfile` can now resolve it.
 *
 * The keyword map for `suggestTeachingProfile` was extended in #953 with
 * ESOL / IELTS / TOEFL / TOEIC / CAE / FCE / CPE / PTE / EFL / ESL +
 * "english as a second language" / "english as a foreign language". Any
 * existing Subject row that ended up with `teachingProfile = null`
 * because the older map didn't recognise the name can now be repaired
 * idempotently.
 *
 * Rule applied:
 *   - For Subject rows where `teachingProfile IS NULL`, run
 *     `suggestTeachingProfile(name)`. If it returns non-null, set the
 *     column. If still null (genuinely unmapped subject), leave alone.
 *   - Idempotent — re-runs are no-ops because the script targets
 *     `teachingProfile IS NULL` only.
 *
 * Usage:
 *   npx tsx scripts/backfill-953-subject-teaching-profile.ts        # apply
 *   npx tsx scripts/backfill-953-subject-teaching-profile.ts --dry  # report only
 */

import { prisma } from "../lib/prisma";
import { suggestTeachingProfile } from "../lib/content-trust/teaching-profiles";

async function main() {
  const dry = process.argv.includes("--dry");
  console.log(`[backfill-953] mode=${dry ? "DRY-RUN" : "APPLY"}`);

  const subjects = await prisma.subject.findMany({
    where: { teachingProfile: null },
    select: { id: true, name: true },
    orderBy: { createdAt: "desc" },
  });

  console.log(`[backfill-953] inspecting ${subjects.length} subject(s) with null teachingProfile`);

  const repairable: Array<{ id: string; name: string; profile: string }> = [];
  const unmapped: Array<{ id: string; name: string }> = [];
  for (const s of subjects) {
    const suggested = suggestTeachingProfile(s.name);
    if (suggested) repairable.push({ id: s.id, name: s.name, profile: suggested });
    else unmapped.push({ id: s.id, name: s.name });
  }

  console.log(`[backfill-953] repairable: ${repairable.length}`);
  for (const r of repairable) {
    console.log(`  ${r.id.slice(0, 8)}  "${r.name}"  →  ${r.profile}`);
  }
  console.log(`[backfill-953] unmapped (left untouched): ${unmapped.length}`);
  for (const u of unmapped.slice(0, 10)) {
    console.log(`  ${u.id.slice(0, 8)}  "${u.name}"`);
  }
  if (unmapped.length > 10) console.log(`  …and ${unmapped.length - 10} more`);

  if (dry || repairable.length === 0) {
    await prisma.$disconnect();
    return;
  }

  for (const r of repairable) {
    await prisma.subject.update({
      where: { id: r.id },
      data: { teachingProfile: r.profile },
    });
  }
  console.log(`[backfill-953] repaired ${repairable.length} subject row(s)`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("[backfill-953] error:", e);
  process.exit(1);
});
