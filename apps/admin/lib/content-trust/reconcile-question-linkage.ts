/**
 * reconcile-question-linkage.ts
 *
 * ContentQuestion → ContentAssertion linkage (issue #163 Phase 2).
 *
 * Fixes the MCQ orphan problem: ~50% of extracted MCQs on real courses have
 * `assertionId = null` because the MCQ extractor's Jaccard linker (in
 * lib/content-trust/link-content.ts) fails on narrative content — same
 * vocabulary-mismatch problem that killed Jaccard Pass 2 on assertion→LO.
 *
 * Mirrors the assertion→LO reconciler shape: thin wrapper around the generic
 * `reconcileChildToParent` utility. Only difference is which Prisma model
 * gets updated and what labels appear in the AI prompt.
 *
 * Writes `linkConfidence` on ContentQuestion is deferred — the column
 * doesn't exist yet. V1 writes the FK only and relies on the existing
 * link-content.ts path being run first (which is a safe no-op when rows
 * are already linked).
 */

import { prisma } from "@/lib/prisma";
import { reconcileChildToParent } from "./reconcile-child-parent";

export interface QuestionReconcileResult {
  courseId: string;
  scanned: number;
  matched: number;
  unmatched: number;
  invalidRefs: number;
  byTp: Record<string, number>;
}

/**
 * Reconcile orphan ContentQuestion rows for a course by asking the AI to
 * tag each one with the best-matching teaching-point (ContentAssertion) id.
 *
 * Scope is by course (playbook) — we load all sources attached to any
 * subject linked to the course and operate across them.
 */
export async function reconcileQuestionAssertions(courseId: string): Promise<QuestionReconcileResult> {
  const empty: QuestionReconcileResult = {
    courseId,
    scanned: 0,
    matched: 0,
    unmatched: 0,
    invalidRefs: 0,
    byTp: {},
  };

  // 1. Resolve the course's source set via PlaybookSource
  const { getSourceIdsForPlaybook } = await import("@/lib/knowledge/domain-sources");
  const sourceIds = await getSourceIdsForPlaybook(courseId);
  if (sourceIds.length === 0) return empty;

  // 2. Load orphan questions (no assertionId yet)
  const orphans = await prisma.contentQuestion.findMany({
    where: { sourceId: { in: sourceIds }, assertionId: null },
    select: {
      id: true,
      questionText: true,
      questionType: true,
      chapter: true,
    },
  });
  if (orphans.length === 0) return empty;

  // 3. Load candidate teaching points — non-instruction assertions only,
  //    since MCQs should ground on student content not tutor rules.
  const { INSTRUCTION_CATEGORIES } = await import("@/lib/content-trust/resolve-config");
  const teachingPoints = await prisma.contentAssertion.findMany({
    where: {
      sourceId: { in: sourceIds },
      category: { notIn: [...INSTRUCTION_CATEGORIES] },
    },
    select: {
      id: true,
      assertion: true,
      learningOutcomeRef: true,
      learningObjective: { select: { ref: true } },
    },
  });
  if (teachingPoints.length === 0) return empty;

  // Use assertion id as the "ref" — stable unique key. It's an ugly ref
  // but the AI doesn't need to be human-readable, and it guarantees
  // uniqueness without re-inventing a slug.
  type Tp = (typeof teachingPoints)[number];

  const result = await reconcileChildToParent<(typeof orphans)[number], Tp>({
    children: orphans,
    parents: teachingPoints,
    getChildId: (q) => q.id,
    getChildText: (q) => q.questionText.slice(0, 400), // cap to keep prompt manageable
    getChildCategory: (q) => q.questionType,
    getParentRef: (tp) => tp.id,
    getParentDescription: (tp) => tp.assertion.slice(0, 200),
    getParentGroup: (tp) => tp.learningObjective?.ref ?? tp.learningOutcomeRef ?? undefined,
    getParentId: (tp) => tp.id,
    writeFk: async (questionId, tpId) => {
      await prisma.contentQuestion.update({
        where: { id: questionId },
        data: { assertionId: tpId },
      });
    },
    aiCallPoint: "content-trust.retag-mcqs",
    childLabel: "multiple-choice questions",
    parentLabel: "teaching points",
  });

  console.log(
    `[reconcile-question-linkage] course=${courseId}: scanned=${result.scanned} ` +
      `matched=${result.matched} unmatched=${result.unmatched} invalid-refs=${result.invalidRefs}`,
  );

  return {
    courseId,
    scanned: result.scanned,
    matched: result.matched,
    unmatched: result.unmatched,
    invalidRefs: result.invalidRefs,
    byTp: result.byRef,
  };
}
