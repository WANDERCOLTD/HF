/**
 * #607 — One-off cleanup: drain historical playbooks that have both a
 * course-scoped Subject and one-or-more non-course-scoped Subject(s)
 * linked via `PlaybookSubject` (the pre-#607 quick-launch/analyze +
 * create_course duplicate-link shape).
 *
 * Idempotent — running this multiple times is safe. Dry-run by default;
 * pass `--apply` to perform the deletes.
 *
 * Strategy:
 *   1. Find playbooks where at least one course-scoped Subject AND at
 *      least one non-course-scoped Subject are linked.
 *      Course-scoped pattern: subject.slug starts with
 *      `{domain.slug}-{slugify(playbook.name)}-`.
 *   2. For each, keep the (first) course-scoped Subject and unlink every
 *      other PlaybookSubject row on that playbook via the shared
 *      `unlinkNonPrimaryPlaybookSubjects()` helper used by the wizard.
 *   3. Skip playbooks that have ONLY non-course-scoped subjects (no clear
 *      "primary" to keep) — log them for manual review.
 *
 * Run:
 *   npx tsx apps/admin/scripts/cleanup-duplicate-playbook-subjects.ts
 *   npx tsx apps/admin/scripts/cleanup-duplicate-playbook-subjects.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import slugify from "slugify";
import { unlinkNonPrimaryPlaybookSubjects } from "../lib/knowledge/cleanup-placeholder-subjects";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient();

  const playbooks = await prisma.playbook.findMany({
    select: {
      id: true,
      name: true,
      domain: { select: { slug: true } },
      subjects: {
        select: {
          subjectId: true,
          subject: { select: { id: true, name: true, slug: true } },
        },
      },
    },
  });

  let mixedCount = 0;
  let noPrimaryCount = 0;
  let plannedUnlinks = 0;
  let actualUnlinks = 0;

  for (const pb of playbooks) {
    if (pb.subjects.length < 2) continue;
    if (!pb.domain?.slug) continue;

    const courseSlugPrefix = `${pb.domain.slug}-${slugify(pb.name, { lower: true, strict: true })}-`;
    const courseScoped = pb.subjects.filter((ps) => ps.subject.slug.startsWith(courseSlugPrefix));
    const other = pb.subjects.filter((ps) => !ps.subject.slug.startsWith(courseSlugPrefix));

    if (courseScoped.length === 0 || other.length === 0) {
      if (courseScoped.length === 0 && pb.subjects.length > 1) {
        noPrimaryCount++;
        console.log(
          `[no-primary] playbook "${pb.name}" (${pb.id}) has ${pb.subjects.length} subjects but none match course-scoped pattern "${courseSlugPrefix}*" — needs manual review`,
        );
        for (const ps of pb.subjects) {
          console.log(`    - ${ps.subject.name} (slug=${ps.subject.slug}, id=${ps.subjectId})`);
        }
      }
      continue;
    }

    mixedCount++;
    const keep = courseScoped[0];
    plannedUnlinks += other.length;
    console.log(
      `[mixed] playbook "${pb.name}" (${pb.id}): keep "${keep.subject.name}" (${keep.subject.slug}); unlink ${other.length} → [${other.map((o) => `"${o.subject.name}"`).join(", ")}]`,
    );

    if (apply) {
      const result = await unlinkNonPrimaryPlaybookSubjects(pb.id, keep.subjectId);
      actualUnlinks += result.removed;
    }
  }

  console.log(`\n──── summary ────`);
  console.log(`mode:              ${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`playbooks scanned: ${playbooks.length}`);
  console.log(`mixed-scope:       ${mixedCount}  (target 0 post-#607)`);
  console.log(`no-primary:        ${noPrimaryCount}  (manual review)`);
  console.log(`planned unlinks:   ${plannedUnlinks}`);
  if (apply) {
    console.log(`actual unlinks:    ${actualUnlinks}`);
  } else {
    console.log(`(re-run with --apply to perform the deletes)`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
