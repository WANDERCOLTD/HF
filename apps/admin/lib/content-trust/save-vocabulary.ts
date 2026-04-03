/**
 * Save Extracted Vocabulary
 *
 * Persists ExtractedVocabulary[] to the ContentVocabulary table with
 * deduplication by (sourceId, term) unique constraint. Returns save stats.
 */

import { prisma } from "@/lib/prisma";
import type { ExtractedVocabulary } from "./extractors/base-extractor";

export interface SaveVocabularyResult {
  created: number;
  duplicatesSkipped: number;
}

/**
 * Save extracted vocabulary for a content source.
 * Deduplicates by (sourceId, term) unique constraint.
 */
export async function saveVocabulary(
  sourceId: string,
  vocabulary: ExtractedVocabulary[],
  subjectSourceId?: string,
): Promise<SaveVocabularyResult> {
  if (vocabulary.length === 0) return { created: 0, duplicatesSkipped: 0 };

  // Fetch existing terms for this source (scoped by subjectSourceId when available)
  const existing = await prisma.contentVocabulary.findMany({
    where: { sourceId, ...(subjectSourceId ? { subjectSourceId } : {}) },
    select: { term: true },
  });
  const existingTerms = new Set(existing.map((e) => e.term.toLowerCase()));

  const seen = new Set<string>();
  const toCreate = vocabulary.filter((v) => {
    const key = v.term.toLowerCase();
    if (existingTerms.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const duplicatesSkipped = vocabulary.length - toCreate.length;

  if (toCreate.length === 0) {
    return { created: 0, duplicatesSkipped };
  }

  await prisma.contentVocabulary.createMany({
    data: toCreate.map((v, i) => ({
      sourceId,
      subjectSourceId: subjectSourceId ?? null,
      term: v.term,
      definition: v.definition,
      partOfSpeech: v.partOfSpeech || null,
      exampleUsage: v.exampleUsage || null,
      pronunciation: v.pronunciation || null,
      topic: v.topic || null,
      difficulty: v.difficulty || null,
      chapter: v.chapter || null,
      pageRef: v.pageRef || null,
      tags: v.tags || [],
      contentHash: v.contentHash,
      sortOrder: i,
    })),
    skipDuplicates: true,
  });

  return { created: toCreate.length, duplicatesSkipped };
}

/**
 * Delete all vocabulary for a content source (for re-extraction).
 */
export async function deleteVocabularyForSource(sourceId: string): Promise<number> {
  const result = await prisma.contentVocabulary.deleteMany({
    where: { sourceId },
  });
  return result.count;
}
