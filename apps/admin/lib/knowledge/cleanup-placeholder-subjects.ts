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

/**
 * #607 — Enforce "one primary subject per playbook" by unlinking every
 * `PlaybookSubject` row whose `subjectId !== keepSubjectId`.
 *
 * Two creation paths attach subjects to a playbook with no shared knowledge:
 *   1. `quick-launch/analyze/route.ts` creates a domain-level Subject with a
 *      bare slug (e.g. `esol`) and links it to the draft playbook.
 *   2. `wizard-tool-executor.create_course` then creates a course-scoped
 *      Subject (e.g. `abacus-academy-pw-ielts-prep-lab-ielts-speaking-practice`)
 *      and ALSO links it.
 * The DB only enforces `@@unique([playbookId, subjectId])` so two different
 * subjects on the same playbook slip past — producing duplicate CONTENT
 * AUTHORITY sections in the composed prompt (#600 RC4 / IELTS Prep Lab).
 *
 * Unlinking the join row is SAFE:
 *   - `PlaybookSubject.subjectId` has `onDelete: Cascade` from the FK on the
 *     join row's perspective; deleting the join does NOT delete the Subject.
 *   - Subject stays available to its other domains/playbooks.
 *   - There is no `CallScore.subjectId` or `CallerAttribute.subjectId` column
 *     (verified against schema 2026-05-23) — no FK orphans to worry about.
 *     CallerAttribute keys may textually reference a subject slug; that's a
 *     post-call mastery key and is unaffected by the join unlink.
 *
 * Returns the count of join rows removed plus the displaced subjects so the
 * caller can surface them in wizard telemetry.
 */
export async function unlinkNonPrimaryPlaybookSubjects(
  playbookId: string,
  keepSubjectId: string,
): Promise<{ removed: number; displaced: Array<{ subjectId: string; subjectName: string; subjectSlug: string }> }> {
  const candidates = await prisma.playbookSubject.findMany({
    where: { playbookId, NOT: { subjectId: keepSubjectId } },
    select: {
      subjectId: true,
      subject: { select: { id: true, name: true, slug: true } },
    },
  });

  if (candidates.length === 0) {
    return { removed: 0, displaced: [] };
  }

  const displaced = candidates.map((ps) => ({
    subjectId: ps.subjectId,
    subjectName: ps.subject.name,
    subjectSlug: ps.subject.slug,
  }));

  // Audit log — record what was displaced so a wizard run that fixes a
  // pre-existing duplicate can be traced back to the displaced subject.
  for (const d of displaced) {
    console.log(
      `[unlink-non-primary] playbook ${playbookId}: unlinking PlaybookSubject for "${d.subjectName}" (${d.subjectSlug}, ${d.subjectId}) — keeping primary ${keepSubjectId}`,
    );
  }

  const result = await prisma.playbookSubject.deleteMany({
    where: {
      playbookId,
      subjectId: { in: candidates.map((c) => c.subjectId) },
    },
  });

  return { removed: result.count, displaced };
}
