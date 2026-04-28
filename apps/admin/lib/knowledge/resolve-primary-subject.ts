/**
 * Primary-Subject resolver for a Playbook.
 *
 * When a Playbook has multiple linked Subjects via PlaybookSubject, downstream
 * consumers (lesson-plan generation, regenerate-curriculum, content readers)
 * need a deterministic way to pick the "real" Subject — the one whose
 * Curriculum has populated Modules — instead of an arbitrary first row.
 *
 * @see https://github.com/WANDERCOLTD/HF/issues/206
 */

import { prisma } from "@/lib/prisma";

export interface PrimarySubject {
  subjectId: string;
  subject: {
    id: string;
    name: string;
    qualificationRef: string | null;
  };
  /** Curriculum on the chosen subject, if any. null when the subject has no Curriculum. */
  curriculumId: string | null;
  /** Number of CurriculumModule rows attached. 0 if no curriculum or empty. */
  moduleCount: number;
}

/**
 * Resolve the primary Subject for a Playbook.
 *
 * Preference order:
 *  1. Subject whose Curriculum has the most CurriculumModule rows (>0)
 *  2. Tie-break: Curriculum with most-recent updatedAt
 *  3. Subject with any Curriculum row (even 0 modules)
 *  4. First Subject by createdAt (deterministic last resort)
 *
 * Returns null only when the Playbook has zero linked Subjects.
 */
export async function resolvePrimarySubjectForPlaybook(
  playbookId: string,
): Promise<PrimarySubject | null> {
  const links = await prisma.playbookSubject.findMany({
    where: { playbookId },
    select: {
      subject: {
        select: {
          id: true,
          name: true,
          qualificationRef: true,
          createdAt: true,
          curricula: {
            select: {
              id: true,
              updatedAt: true,
              _count: { select: { modules: true } },
            },
          },
          _count: { select: { sources: true } },
        },
      },
    },
  });

  if (links.length === 0) return null;

  // Build a candidate list with the strongest curriculum per subject
  const candidates = links.map((l) => {
    // A Subject can technically have multiple Curricula; pick the most-modular one
    const sortedCurricula = [...l.subject.curricula].sort((a, b) => {
      const am = a._count.modules;
      const bm = b._count.modules;
      if (am !== bm) return bm - am;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });
    const top = sortedCurricula[0];
    return {
      subjectId: l.subject.id,
      subjectName: l.subject.name,
      qualificationRef: l.subject.qualificationRef,
      subjectCreatedAt: l.subject.createdAt,
      sourceCount: l.subject._count.sources,
      curriculumId: top?.id ?? null,
      moduleCount: top?._count.modules ?? 0,
      curriculumUpdatedAt: top?.updatedAt ?? null,
    };
  });

  // Sort: most modules first → most sources (where the real content lives) →
  // most-recent curriculum → oldest subject. This way an empty Curriculum row
  // doesn't beat a Subject with assertions but no curriculum (the data shape
  // we hit in dev for IELTS Speaking — see #206).
  candidates.sort((a, b) => {
    if (a.moduleCount !== b.moduleCount) return b.moduleCount - a.moduleCount;
    if (a.sourceCount !== b.sourceCount) return b.sourceCount - a.sourceCount;
    const at = a.curriculumUpdatedAt?.getTime() ?? 0;
    const bt = b.curriculumUpdatedAt?.getTime() ?? 0;
    if (at !== bt) return bt - at;
    return a.subjectCreatedAt.getTime() - b.subjectCreatedAt.getTime();
  });

  const winner = candidates[0];
  return {
    subjectId: winner.subjectId,
    subject: {
      id: winner.subjectId,
      name: winner.subjectName,
      qualificationRef: winner.qualificationRef,
    },
    curriculumId: winner.curriculumId,
    moduleCount: winner.moduleCount,
  };
}
