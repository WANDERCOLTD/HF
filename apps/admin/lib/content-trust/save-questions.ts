/**
 * Save Extracted Questions
 *
 * Persists ExtractedQuestion[] to the ContentQuestion table with
 * deduplication by contentHash. Returns save stats.
 */

import { prisma } from "@/lib/prisma";
import type { ExtractedQuestion } from "./extractors/base-extractor";
import { sanitiseLORef } from "./validate-lo-linkage";
import { computeWordOverlap } from "@/lib/assessment/validate-mcqs";
import { Prisma, type AssessmentUse } from "@prisma/client";

export interface SaveQuestionsResult {
  created: number;
  duplicatesSkipped: number;
  /** #276 Slice 2: questions dropped by the cross-question semantic dedup pass. */
  semanticDuplicatesSkipped?: number;
}

/**
 * #276 Slice 2: word-overlap threshold for cross-question dedup.
 * Two questions whose stopword-stripped Jaccard similarity ≥ this value
 * are treated as duplicates. Tuned to catch the kind of paraphrased
 * duplicate seen in the IELTS Speaking course:
 *   "How many assessment criteria are used to evaluate IELTS Speaking?"
 *   "How many assessment criteria are used in IELTS Speaking evaluation?"
 * Without stopword stripping these score ~0.6 (TL's suggested 0.85 misses
 * them). With stopwords stripped + 0.65, the pair collapses while
 * genuinely different questions about the same topic stay separate.
 */
const SEMANTIC_DUPLICATE_THRESHOLD = 0.65;

/**
 * Stopwords that inflate the union without adding signal — strip before
 * computing similarity so paraphrased dupes (different connectives) score
 * higher.
 */
const SIMILARITY_STOPWORDS = new Set([
  "a", "an", "the",
  "is", "are", "was", "were", "be", "been",
  "to", "of", "in", "on", "at", "for", "with", "by", "from",
  "and", "or", "but",
  "do", "does", "did",
  "this", "that", "these", "those",
  "it", "its",
  "?",
]);

function normalisedQuestionWords(s: string): string {
  return s
    .toLowerCase()
    .replace(/[?.!,;:]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !SIMILARITY_STOPWORDS.has(w))
    .join(" ");
}

/**
 * Save extracted questions for a content source.
 * Two-pass dedup:
 *   1. contentHash exact match (catches re-runs of identical AI output)
 *   2. cross-question Jaccard overlap (catches paraphrased duplicates that
 *      have different hashes — see #276 where Q1 and Q2 were near-identical)
 */
export async function saveQuestions(
  sourceId: string,
  questions: ExtractedQuestion[],
  subjectSourceId?: string,
  /**
   * Declared `hf-question-assessment-use` from the source's front-matter
   * (parseContentDeclaration). When present, EVERY question row gets this
   * value — the educator's declaration overrides the extractor's
   * per-question inference (e.g. an entire QUESTION_BANK doc tagged
   * TUTOR_ONLY should produce only tutor-reference questions, never
   * pre-test items). When absent, per-question `assessmentUse` is honoured.
   * See docs/CONTENT-PIPELINE.md §3 + §6.
   */
  declaredAssessmentUse?: AssessmentUse | null,
): Promise<SaveQuestionsResult> {
  if (questions.length === 0) return { created: 0, duplicatesSkipped: 0 };

  // Fetch existing hashes + question text for this source (scoped by
  // subjectSourceId when available). Question text feeds the semantic
  // dedup pass below.
  const existing = await prisma.contentQuestion.findMany({
    where: { sourceId, ...(subjectSourceId ? { subjectSourceId } : {}) },
    select: { contentHash: true, questionText: true },
  });
  const existingHashes = new Set(existing.map((e) => e.contentHash).filter(Boolean));
  const existingTexts: string[] = existing.map((e) => e.questionText).filter(Boolean) as string[];

  const seen = new Set<string>();
  // Pass 1: contentHash dedup
  const hashUnique = questions.filter((q) => {
    if (existingHashes.has(q.contentHash) || seen.has(q.contentHash)) return false;
    seen.add(q.contentHash);
    return true;
  });

  // Pass 2: cross-question semantic dedup — Jaccard overlap ≥ 0.85.
  // Compares each new question against (a) already-persisted questions and
  // (b) other new questions accepted earlier in this batch. Catches near-
  // identical paraphrases that contentHash misses.
  const acceptedTexts: string[] = [...existingTexts];
  const toCreate: ExtractedQuestion[] = [];
  let semanticDuplicatesSkipped = 0;
  for (const q of hashUnique) {
    const qNorm = normalisedQuestionWords(q.questionText);
    const dupe = acceptedTexts.find(
      (existingText) => computeWordOverlap(qNorm, normalisedQuestionWords(existingText)) >= SEMANTIC_DUPLICATE_THRESHOLD,
    );
    if (dupe) {
      semanticDuplicatesSkipped++;
      console.log(
        `[save-questions] #276 Slice 2: dropped near-duplicate "${q.questionText.slice(0, 60)}..." (overlap with "${dupe.slice(0, 60)}...")`,
      );
      continue;
    }
    acceptedTexts.push(q.questionText);
    toCreate.push(q);
  }
  const duplicatesSkipped = questions.length - hashUnique.length;

  if (toCreate.length === 0) {
    return { created: 0, duplicatesSkipped, semanticDuplicatesSkipped };
  }

  // #385 Slice 3a — AI-to-DB guard: coerce incoherent assessmentUse values.
  // TUTOR_QUESTION items are open-ended Socratic prompts with no machine-
  // gradable answer key; PRE_TEST / POST_TEST / BOTH / FORMATIVE all imply
  // a scored item. The only coherent values for TUTOR_QUESTION are null or
  // TUTOR_ONLY. Anything else is auto-corrected to TUTOR_ONLY and logged.
  let assessmentUseCoerced = 0;
  await prisma.contentQuestion.createMany({
    data: toCreate.map((q, i) => {
      const rawAssessmentUse = declaredAssessmentUse ?? q.assessmentUse ?? null;
      let resolvedAssessmentUse: AssessmentUse | null = rawAssessmentUse;
      if (
        q.questionType === "TUTOR_QUESTION" &&
        resolvedAssessmentUse !== null &&
        resolvedAssessmentUse !== "TUTOR_ONLY"
      ) {
        resolvedAssessmentUse = "TUTOR_ONLY";
        assessmentUseCoerced++;
      }
      return {
        sourceId,
        subjectSourceId: subjectSourceId ?? null,
        questionText: q.questionText,
        questionType: q.questionType,
        options: (q.options || undefined) as unknown as Prisma.InputJsonValue | undefined,
        correctAnswer: q.correctAnswer || null,
        answerExplanation: q.answerExplanation || null,
        markScheme: q.markScheme || null,
        // Defence-in-depth: even if an extractor slips a free-text ref through,
        // sanitise at write time per epic #131 A2.
        learningOutcomeRef: sanitiseLORef(q.learningOutcomeRef),
        skillRef: q.skillRef || null,
        metadata: (q.metadata || undefined) as unknown as Prisma.InputJsonValue | undefined,
        difficulty: q.difficulty || null,
        pageRef: q.pageRef || null,
        chapter: q.chapter || null,
        section: q.section || null,
        tags: q.tags || [],
        sortOrder: i,
        contentHash: q.contentHash,
        bloomLevel: q.bloomLevel || null,
        // Declared override (hf-question-assessment-use) wins for every row in
        // the doc. Otherwise honour the extractor's per-question value.
        // Coerced above when questionType=TUTOR_QUESTION demands TUTOR_ONLY.
        assessmentUse: resolvedAssessmentUse,
        // #276 Slice 3: stamp generator-output as AI_ASSISTED. Educator-
        // imported question banks may set a higher tier downstream.
        trustLevel: "AI_ASSISTED",
      };
    }),
    skipDuplicates: true,
  });
  if (assessmentUseCoerced > 0) {
    console.warn(
      `[save-questions] source ${sourceId}: coerced ${assessmentUseCoerced} TUTOR_QUESTION row(s) from incompatible assessmentUse to TUTOR_ONLY (#385 Slice 3a guard)`,
    );
  }

  // Fire-and-forget AI reconcile so freshly-imported question banks land
  // with `assertionId` populated, instead of relying on a later UI visit
  // to trigger McqPanel's auto-reconcile. Looks up every playbook that
  // contains this source and runs `reconcileQuestionAssertions` per
  // course. Errors swallowed — this is best-effort polish; the McqPanel
  // auto-reconcile remains the safety net.
  if (toCreate.length > 0) {
    void triggerReconcileForSource(sourceId);
  }

  return { created: toCreate.length, duplicatesSkipped, semanticDuplicatesSkipped };
}

/**
 * Per-course debounce for the post-upload reconcile. A course-pack ingest
 * may call `saveQuestions` many times across multiple sources tied to the
 * same course; without debouncing we'd fire N redundant reconciles back-
 * to-back. Window = 30s — long enough to coalesce a multi-source upload,
 * short enough that the educator sees fresh badges within a minute.
 *
 * The map lives at module scope (one entry per courseId). Each timeout
 * also stamps a `firingAt` time so concurrent calls can dedupe.
 */
const RECONCILE_DEBOUNCE_MS = 30_000;
const reconcileTimers = new Map<string, NodeJS.Timeout>();

/**
 * Look up every playbook attached to a source and schedule a debounced
 * AI MCQ reconcile for each. Fire-and-forget; never blocks the upload.
 *
 * Pre-checks before scheduling:
 * - Course must have ≥1 candidate ContentAssertion in scope (otherwise
 *   reconciliation can't match anything; cheap query saves an AI call)
 * - Course must have ≥1 orphan ContentQuestion (skip when already linked)
 *
 * Dedup:
 * - If a reconcile is already scheduled for this course within the
 *   debounce window, the new call resets the timer rather than queueing
 *   a second run. Course-pack ingests with many sources per course
 *   collapse to one reconcile per course.
 *
 * Dynamic import keeps embedding deps out of the hot-path module graph.
 */
async function triggerReconcileForSource(sourceId: string): Promise<void> {
  try {
    const links = await prisma.playbookSource.findMany({
      where: { sourceId },
      select: { playbookId: true },
    });
    if (links.length === 0) return;
    for (const link of links) {
      scheduleReconcileForCourse(link.playbookId);
    }
  } catch (err: any) {
    console.warn(`[save-questions] triggerReconcileForSource(${sourceId}) failed:`, err?.message || err);
  }
}

function scheduleReconcileForCourse(courseId: string): void {
  const existing = reconcileTimers.get(courseId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    reconcileTimers.delete(courseId);
    void runReconcileForCourse(courseId);
  }, RECONCILE_DEBOUNCE_MS);
  reconcileTimers.set(courseId, timer);
}

async function runReconcileForCourse(courseId: string): Promise<void> {
  try {
    // Guard 1: any orphans to reconcile?
    const orphanCount = await prisma.contentQuestion.count({
      where: { assertionId: null, source: { playbookSources: { some: { playbookId: courseId } } } },
    });
    if (orphanCount === 0) return;

    // Guard 2: any candidate teaching points in scope? Skip pure
    // question-bank courses (no TPs to link to) — they'd burn the AI
    // call for a guaranteed zero-match result.
    const candidateCount = await prisma.contentAssertion.count({
      where: { source: { playbookSources: { some: { playbookId: courseId } } } },
    });
    if (candidateCount === 0) {
      console.log(
        `[save-questions] post-import reconcile course=${courseId}: skipped (${orphanCount} orphan(s), 0 candidate TPs — pure question-bank course)`,
      );
      return;
    }

    const { reconcileQuestionAssertions } = await import("./reconcile-question-linkage");
    const res = await reconcileQuestionAssertions(courseId);
    if (res.scanned > 0) {
      console.log(
        `[save-questions] post-import reconcile course=${courseId}: scanned=${res.scanned} matched=${res.matched} unmatched=${res.unmatched}`,
      );
    }
  } catch (err: any) {
    console.warn(
      `[save-questions] runReconcileForCourse(${courseId}) failed:`,
      err?.message || err,
    );
  }
}

/**
 * Delete all questions for a content source (for re-extraction).
 */
export async function deleteQuestionsForSource(sourceId: string): Promise<number> {
  const result = await prisma.contentQuestion.deleteMany({
    where: { sourceId },
  });
  return result.count;
}
