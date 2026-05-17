/**
 * #417 backfill — restore `BehaviorTarget.skillRef` for existing rows
 * created by `applyProjection` BEFORE the Phase B fix landed.
 *
 * Strategy: re-parse the source Course Reference doc to recover the
 * `parameterName → skillRef` map, then update each BehaviorTarget whose
 * `parameterId` matches and whose `skillRef` is still NULL.
 *
 * Idempotent — re-running is a no-op once skillRefs are filled.
 */
import { prisma } from "@/lib/prisma";
import {
  projectCourseReference,
  skillNameToParameterName,
} from "@/lib/wizard/project-course-reference";

async function main() {
  let updated = 0;
  let skipped = 0;
  let noSource = 0;

  const targets = await prisma.behaviorTarget.findMany({
    where: {
      skillRef: null,
      sourceContentId: { not: null },
    },
    select: {
      id: true,
      parameterId: true,
      sourceContentId: true,
      playbookId: true,
    },
  });

  console.log(`Found ${targets.length} BehaviorTarget rows with null skillRef + non-null sourceContentId`);

  // Group by sourceContentId — re-parse each source doc once.
  const bySource = new Map<string, typeof targets>();
  for (const bt of targets) {
    if (!bt.sourceContentId) {
      noSource++;
      continue;
    }
    const arr = bySource.get(bt.sourceContentId) ?? [];
    arr.push(bt);
    bySource.set(bt.sourceContentId, arr);
  }

  for (const [sourceContentId, batch] of bySource) {
    const source = await prisma.contentSource.findUnique({
      where: { id: sourceContentId },
      select: { id: true, fileName: true, contentText: true },
    });
    if (!source?.contentText) {
      console.warn(`  [skip] source ${sourceContentId} (${source?.fileName ?? "?"}) has no contentText`);
      skipped += batch.length;
      continue;
    }

    // Re-parse the doc to get the canonical skills list
    const projection = projectCourseReference(source.contentText, { sourceContentId });
    const refByParamName = new Map<string, string>();
    for (const skill of projection.skills) {
      refByParamName.set(skillNameToParameterName(skill.name), skill.ref);
    }

    for (const bt of batch) {
      const ref = refByParamName.get(bt.parameterId);
      if (!ref) {
        skipped++;
        continue;
      }
      await prisma.behaviorTarget.update({
        where: { id: bt.id },
        data: { skillRef: ref },
      });
      updated++;
      console.log(`  [ok] ${bt.parameterId} → ${ref}`);
    }
  }

  console.log(`\nBackfill complete: updated=${updated}, skipped=${skipped}, noSource=${noSource}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
