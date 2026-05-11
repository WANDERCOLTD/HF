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
import type { AssessmentUse, DocumentType } from "@prisma/client";

/**
 * DocumentTypes where the cross-question semantic dedup pass is skipped.
 * These are author-curated banks where every entry is intentionally a frame
 * variant (e.g. IELTS Part 2 cue cards all start "Describe a/an …"). Hash
 * dedup still runs — only the Jaccard near-duplicate pass is bypassed.
 */
const DEDUP_SKIP_DOCTYPES = new Set<DocumentType>(["QUESTION_BANK"]);

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
  /**
   * The source's documentType. When set to a value in DEDUP_SKIP_DOCTYPES
   * (currently QUESTION_BANK), the cross-question semantic dedup pass is
   * skipped. Author-curated banks intentionally repeat frame language and
   * the 0.65 Jaccard threshold drops legitimate frame variants. Hash dedup
   * still runs.
   */
  sourceDocumentType?: DocumentType | null,
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

  // Pass 2: cross-question semantic dedup — Jaccard overlap ≥ threshold.
  // Compares each new question against (a) already-persisted questions and
  // (b) other new questions accepted earlier in this batch. Catches near-
  // identical paraphrases that contentHash misses.
  // Skipped for author-curated banks (QUESTION_BANK) where frame variants
  // share many words by design — see DEDUP_SKIP_DOCTYPES.
  const skipSemanticDedup = sourceDocumentType ? DEDUP_SKIP_DOCTYPES.has(sourceDocumentType) : false;
  const acceptedTexts: string[] = [...existingTexts];
  const toCreate: ExtractedQuestion[] = [];
  let semanticDuplicatesSkipped = 0;
  if (skipSemanticDedup) {
    toCreate.push(...hashUnique);
  } else {
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
  }
  const duplicatesSkipped = questions.length - hashUnique.length;

  if (toCreate.length === 0) {
    return { created: 0, duplicatesSkipped, semanticDuplicatesSkipped };
  }

  await prisma.contentQuestion.createMany({
    data: toCreate.map((q, i) => ({
      sourceId,
      subjectSourceId: subjectSourceId ?? null,
      questionText: q.questionText,
      questionType: q.questionType,
      options: q.options || undefined,
      correctAnswer: q.correctAnswer || null,
      answerExplanation: q.answerExplanation || null,
      markScheme: q.markScheme || null,
      // Defence-in-depth: even if an extractor slips a free-text ref through,
      // sanitise at write time per epic #131 A2.
      learningOutcomeRef: sanitiseLORef(q.learningOutcomeRef),
      skillRef: q.skillRef || null,
      metadata: q.metadata || undefined,
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
      assessmentUse: declaredAssessmentUse ?? q.assessmentUse ?? null,
      // #276 Slice 3: stamp generator-output as AI_ASSISTED. Educator-
      // imported question banks may set a higher tier downstream.
      trustLevel: "AI_ASSISTED",
    })),
    skipDuplicates: true,
  });

  return { created: toCreate.length, duplicatesSkipped, semanticDuplicatesSkipped };
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
