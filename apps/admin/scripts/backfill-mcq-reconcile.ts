/**
 * Backfill: run AI MCQ reconciliation across every course that currently
 * has orphan `ContentQuestion` rows (assertionId IS NULL) AND has at
 * least one `ContentAssertion` in scope to link against.
 *
 * Why: until #690 the auto-reconcile only fired on the derived-curriculum
 * branch in the UI; authored-modules courses never reconciled. #690 fixes
 * the going-forward path, but historic courses still sit with orphans until
 * an educator opens each one. This script proactively walks the DB and
 * runs the reconciler course-by-course.
 *
 * Idempotent: re-running after a clean pass is a near-no-op (only
 * rows newly added since the last run get re-evaluated).
 *
 * Run on VM:
 *   npx tsx scripts/backfill-mcq-reconcile.ts            (dry-run, default)
 *   npx tsx scripts/backfill-mcq-reconcile.ts --execute  (apply changes)
 *   npx tsx scripts/backfill-mcq-reconcile.ts --course <courseId>  (single course)
 */

import { prisma } from "@/lib/prisma";
import { reconcileQuestionAssertions } from "@/lib/content-trust/reconcile-question-linkage";
import { getSourceIdsForPlaybook } from "@/lib/knowledge/domain-sources";

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const dryRun = !execute;
  const courseFlagIdx = args.indexOf("--course");
  const explicitCourseId =
    courseFlagIdx >= 0 && args[courseFlagIdx + 1] ? args[courseFlagIdx + 1] : null;

  console.log(
    `\n=== Backfill MCQ reconcile ===\n` +
    `  mode: ${dryRun ? "DRY-RUN (pass --execute to apply)" : "EXECUTE"}\n` +
    (explicitCourseId ? `  course filter: ${explicitCourseId}\n` : ""),
  );

  // 1. Find every Playbook (course). When --course is set, scope to just one.
  const playbooks = await prisma.playbook.findMany({
    where: explicitCourseId ? { id: explicitCourseId } : {},
    select: { id: true, name: true, status: true },
    orderBy: { createdAt: "asc" },
  });

  if (playbooks.length === 0) {
    console.log("No playbooks matched the filter.\n");
    return;
  }
  console.log(`  inspecting ${playbooks.length} playbook(s)...\n`);

  let coursesProcessed = 0;
  let coursesSkippedNoOrphans = 0;
  let coursesSkippedNoCandidates = 0;
  let totalScanned = 0;
  let totalMatched = 0;
  let totalUnmatched = 0;
  let totalErrored = 0;

  for (const pb of playbooks) {
    const sourceIds = await getSourceIdsForPlaybook(pb.id);
    if (sourceIds.length === 0) {
      continue;
    }

    // Cheap pre-checks — skip courses with nothing to reconcile.
    const [orphanCount, candidateCount] = await Promise.all([
      prisma.contentQuestion.count({
        where: { sourceId: { in: sourceIds }, assertionId: null },
      }),
      prisma.contentAssertion.count({ where: { sourceId: { in: sourceIds } } }),
    ]);

    if (orphanCount === 0) {
      coursesSkippedNoOrphans += 1;
      continue;
    }
    if (candidateCount === 0) {
      // Pure question-bank course — no teaching points to match against.
      // The reconciler would return 0 matches; no point spending the API call.
      console.log(
        `  ${pb.id.slice(0, 8)}…  ${pb.name}: ${orphanCount} orphan(s), 0 TPs → skipped (no candidates)`,
      );
      coursesSkippedNoCandidates += 1;
      continue;
    }

    if (dryRun) {
      console.log(
        `  ${pb.id.slice(0, 8)}…  ${pb.name}: ${orphanCount} orphan(s), ${candidateCount} candidate TP(s) → would reconcile`,
      );
      coursesProcessed += 1;
      continue;
    }

    try {
      console.log(
        `  ${pb.id.slice(0, 8)}…  ${pb.name}: reconciling ${orphanCount} orphan(s)…`,
      );
      const res = await reconcileQuestionAssertions(pb.id);
      totalScanned += res.scanned;
      totalMatched += res.matched;
      totalUnmatched += res.unmatched;
      coursesProcessed += 1;
      console.log(
        `    → scanned=${res.scanned}  matched=${res.matched}  unmatched=${res.unmatched}  invalidRefs=${res.invalidRefs}`,
      );
    } catch (err: any) {
      totalErrored += 1;
      console.warn(`    ! error: ${err?.message || err}`);
    }
  }

  console.log(
    `\n=== ${dryRun ? "Dry-run" : "Done"} ===\n` +
    `  courses processed: ${coursesProcessed}\n` +
    `  courses skipped (no orphans): ${coursesSkippedNoOrphans}\n` +
    `  courses skipped (no candidate TPs): ${coursesSkippedNoCandidates}\n` +
    (dryRun ? "" :
      `  total scanned: ${totalScanned}\n` +
      `  total matched: ${totalMatched}\n` +
      `  total unmatched: ${totalUnmatched}\n` +
      `  errored: ${totalErrored}\n`),
  );

  if (dryRun) {
    console.log(`Run again with --execute to apply.\n`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
