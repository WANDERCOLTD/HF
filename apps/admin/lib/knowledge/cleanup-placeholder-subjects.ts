/**
 * Placeholder-Subject cleanup helpers.
 *
 * A "placeholder" Subject is one created during early wizard turns with
 * a generic name (e.g. "Course") before the educator named the discipline.
 * Once the real discipline-named Subject is linked, the placeholder must
 * be removed from the playbook so resolvers don't pick the empty subject.
 *
 * @see https://github.com/WANDERCOLTD/HF/issues/207
 */

import { prisma } from "@/lib/prisma";

/**
 * Names that are never valid as a real Subject — these always indicate a
 * placeholder created from courseName fallback. Compared case-insensitively.
 */
const PLACEHOLDER_SUBJECT_NAMES = new Set([
  "course",
  "subject",
  "training plan",
  "playbook",
]);

/**
 * Returns true if `name` is a placeholder term that should never be used
 * as a real Subject name.
 */
export function isPlaceholderSubjectName(name: string | null | undefined): boolean {
  if (!name) return true;
  return PLACEHOLDER_SUBJECT_NAMES.has(name.trim().toLowerCase());
}

/**
 * Remove any PlaybookSubject rows on `playbookId` that point to a
 * Subject which is empty (no Curriculum, no ContentAssertions via
 * SubjectSource → ContentAssertion). Skips the `keepSubjectId`.
 *
 * Safe to call after linking a real primary Subject — it will only
 * remove orphans, never the live one.
 *
 * Returns the number of PlaybookSubject rows removed.
 */
export async function removePlaceholderPlaybookSubjects(
  playbookId: string,
  keepSubjectId: string,
): Promise<number> {
  const candidates = await prisma.playbookSubject.findMany({
    where: { playbookId, NOT: { subjectId: keepSubjectId } },
    select: {
      subjectId: true,
      subject: {
        select: {
          id: true,
          name: true,
          curricula: { select: { id: true }, take: 1 },
          sources: {
            select: {
              source: {
                select: {
                  assertions: { select: { id: true }, take: 1 },
                },
              },
            },
            take: 5,
          },
        },
      },
    },
  });

  let removed = 0;
  for (const ps of candidates) {
    const hasCurriculum = ps.subject.curricula.length > 0;
    const hasAssertions = ps.subject.sources.some(
      (ss) => ss.source.assertions.length > 0,
    );
    const isPlaceholderName = isPlaceholderSubjectName(ps.subject.name);

    // Only remove if BOTH name is placeholder AND content is empty —
    // belt + braces to avoid accidentally severing a real Subject.
    if (isPlaceholderName && !hasCurriculum && !hasAssertions) {
      await prisma.playbookSubject.delete({
        where: {
          playbookId_subjectId: { playbookId, subjectId: ps.subjectId },
        },
      });
      removed++;
      console.log(
        `[cleanup-placeholder] Removed PlaybookSubject for placeholder "${ps.subject.name}" (${ps.subjectId}) on playbook ${playbookId}`,
      );
    }
  }

  return removed;
}
