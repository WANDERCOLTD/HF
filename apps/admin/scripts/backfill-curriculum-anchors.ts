/**
 * Backfill — #1081 Slice 2B.1: label the existing CIO/CTO Curriculum with
 * `qualificationAnchor = "sias-cio-cto-v6"`.
 *
 * This is the one-shot backfill that goes with the schema change. It targets
 * a single, known Curriculum (the shared `the-standard-v1` Curriculum used by
 * all three CIO/CTO Playbooks — Revision Aid / Pop Quiz / Exam Assessment) and
 * sets its `qualificationAnchor`. Mastery sharing already works via the
 * PlaybookCurriculum(role: linked) variant pattern — this field is purely a
 * labelling/grouping marker for CI guards (Slice 2B.3) and admin rollups.
 *
 * Safety properties:
 *   - Dry-run by default. Pass --apply to commit.
 *   - Idempotent: re-running with the anchor already set is a no-op.
 *   - Refuses to overwrite an unexpected non-null anchor (operator investigates).
 *   - Wraps the write + assertion in a single $transaction.
 *
 * Usage:
 *   npx tsx scripts/backfill-curriculum-anchors.ts            # dry-run (default)
 *   npx tsx scripts/backfill-curriculum-anchors.ts --apply    # commit
 *
 * Exit codes:
 *   0 — clean (skipped or applied)
 *   1 — unexpected error
 *   2 — aborted (anchor set to an unexpected value)
 */

import { prisma } from "../lib/prisma";

const TARGET_CURRICULUM_ID = "0ccb2874-f2d5-4431-96d0-0c0faf342636";
const TARGET_ANCHOR = "sias-cio-cto-v6";

async function main(): Promise<number> {
  const apply = process.argv.includes("--apply");
  const mode = apply ? "APPLY" : "DRY-RUN";

  let updated = 0;
  let skipped = 0;
  let aborted = 0;

  const current = await prisma.curriculum.findUnique({
    where: { id: TARGET_CURRICULUM_ID },
    select: { id: true, slug: true, qualificationAnchor: true },
  });

  if (!current) {
    console.error(
      `[backfill-anchors] ERROR — target Curriculum ${TARGET_CURRICULUM_ID} not found`,
    );
    return 1;
  }

  console.log(
    `[backfill-anchors] target id=${current.id} slug=${current.slug} current=${
      current.qualificationAnchor ?? "null"
    } proposed=${TARGET_ANCHOR}`,
  );

  if (current.qualificationAnchor === TARGET_ANCHOR) {
    console.log(`[backfill-anchors] anchor already set to "${TARGET_ANCHOR}" — no-op`);
    skipped = 1;
  } else if (current.qualificationAnchor && current.qualificationAnchor !== TARGET_ANCHOR) {
    console.error(
      `[backfill-anchors] ABORT — anchor already set to unexpected value "${current.qualificationAnchor}" (expected null or "${TARGET_ANCHOR}"). Operator must investigate before re-running.`,
    );
    aborted = 1;
  } else if (apply) {
    // Transactional write + post-update assertion.
    await prisma.$transaction(async (tx) => {
      const result = await tx.curriculum.update({
        where: { id: TARGET_CURRICULUM_ID },
        data: { qualificationAnchor: TARGET_ANCHOR },
        select: { id: true, qualificationAnchor: true },
      });
      if (result.id !== TARGET_CURRICULUM_ID) {
        throw new Error(
          `[backfill-anchors] assertion failed — updated row id "${result.id}" !== target "${TARGET_CURRICULUM_ID}"`,
        );
      }
      if (result.qualificationAnchor !== TARGET_ANCHOR) {
        throw new Error(
          `[backfill-anchors] assertion failed — post-update anchor "${result.qualificationAnchor}" !== expected "${TARGET_ANCHOR}"`,
        );
      }
    });
    console.log(`[backfill-anchors] APPLIED — set anchor to "${TARGET_ANCHOR}"`);
    updated = 1;
  } else {
    console.log(
      `[backfill-anchors] would set anchor to "${TARGET_ANCHOR}" (dry-run — pass --apply to commit)`,
    );
  }

  console.log(
    `[backfill-anchors] mode=${mode}  target=1  updated=${updated}  skipped=${skipped}  aborted=${aborted}`,
  );

  return aborted > 0 ? 2 : 0;
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error("[backfill-anchors] unexpected error:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
