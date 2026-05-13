/**
 * Shared assertion save logic.
 *
 * De-duplicates assertions by content hash against existing records,
 * then batch-creates new ones. Used by both the import and extract routes
 * to avoid duplicating this logic.
 */

import { prisma } from "@/lib/prisma";
import type { ExtractedAssertion } from "./extract-assertions";

export interface SaveResult {
  created: number;
  duplicatesSkipped: number;
}

/**
 * Save extracted assertions to DB, deduplicating by content hash.
 *
 * Checks existing assertions for this source, skips any with matching
 * content hashes, and creates the rest in a single batch.
 */
export async function saveAssertions(
  sourceId: string,
  assertions: ExtractedAssertion[],
  subjectSourceId?: string,
): Promise<SaveResult> {
  const existingHashes = new Set(
    (
      await prisma.contentAssertion.findMany({
        where: {
          sourceId,
          ...(subjectSourceId ? { subjectSourceId } : {}),
        },
        select: { contentHash: true },
      })
    )
      .map((a) => a.contentHash)
      .filter(Boolean),
  );

  const toCreate: ExtractedAssertion[] = [];
  const seen = new Set<string>();
  let duplicatesSkipped = 0;
  let emptySkipped = 0;

  for (const assertion of assertions) {
    if (typeof assertion.assertion !== "string" || assertion.assertion.trim() === "") {
      emptySkipped++;
      continue;
    }
    if (existingHashes.has(assertion.contentHash) || seen.has(assertion.contentHash)) {
      duplicatesSkipped++;
      continue;
    }
    seen.add(assertion.contentHash);
    toCreate.push(assertion);
  }

  if (emptySkipped > 0) {
    console.warn(
      `[save-assertions] source ${sourceId}: skipped ${emptySkipped} empty/whitespace assertion(s) — extractor returned blank text`,
    );
  }

  if (toCreate.length > 0) {
    await prisma.contentAssertion.createMany({
      data: toCreate.map((a) => ({
        sourceId,
        subjectSourceId: subjectSourceId ?? null,
        assertion: a.assertion,
        category: a.category,
        chapter: a.chapter || null,
        section: a.section || null,
        tags: a.tags,
        examRelevance: a.examRelevance ?? null,
        learningOutcomeRef: a.learningOutcomeRef || null,
        validUntil: a.validUntil ? new Date(a.validUntil) : null,
        taxYear: a.taxYear || null,
        contentHash: a.contentHash,
        teachMethod: a.teachMethod || null,
        figureRefs: a.figureRefs?.length ? a.figureRefs : [],
      })),
      skipDuplicates: true,
    });
  }

  return { created: toCreate.length, duplicatesSkipped };
}
