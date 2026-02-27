/**
 * Save Extracted Questions
 *
 * Persists ExtractedQuestion[] to the ContentQuestion table with
 * deduplication by contentHash. Returns save stats.
 */

import { prisma } from "@/lib/prisma";
import type { ExtractedQuestion } from "./extractors/base-extractor";

export interface SaveQuestionsResult {
  created: number;
  duplicatesSkipped: number;
}

/**
 * Save extracted questions for a content source.
 * Deduplicates by contentHash (skips existing).
 */
export async function saveQuestions(
  sourceId: string,
  questions: ExtractedQuestion[],
): Promise<SaveQuestionsResult> {
  if (questions.length === 0) return { created: 0, duplicatesSkipped: 0 };

  // Fetch existing hashes for this source
  const existing = await prisma.contentQuestion.findMany({
    where: { sourceId },
    select: { contentHash: true },
  });
  const existingHashes = new Set(existing.map((e) => e.contentHash).filter(Boolean));

  const seen = new Set<string>();
  const toCreate = questions.filter((q) => {
    if (existingHashes.has(q.contentHash) || seen.has(q.contentHash)) return false;
    seen.add(q.contentHash);
    return true;
  });
  const duplicatesSkipped = questions.length - toCreate.length;

  if (toCreate.length === 0) {
    return { created: 0, duplicatesSkipped };
  }

  await prisma.contentQuestion.createMany({
    data: toCreate.map((q, i) => ({
      sourceId,
      questionText: q.questionText,
      questionType: q.questionType,
      options: q.options || undefined,
      correctAnswer: q.correctAnswer || null,
      answerExplanation: q.answerExplanation || null,
      markScheme: q.markScheme || null,
      learningOutcomeRef: q.learningOutcomeRef || null,
      skillRef: q.skillRef || null,
      metadata: q.metadata || undefined,
      difficulty: q.difficulty || null,
      pageRef: q.pageRef || null,
      chapter: q.chapter || null,
      section: q.section || null,
      tags: q.tags || [],
      sortOrder: i,
      contentHash: q.contentHash,
    })),
    skipDuplicates: true,
  });

  return { created: toCreate.length, duplicatesSkipped };
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
