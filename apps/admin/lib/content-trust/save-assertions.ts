/**
 * Shared assertion save logic.
 *
 * De-duplicates assertions by content hash against existing records,
 * then batch-creates new ones. Used by both the import and extract routes
 * to avoid duplicating this logic.
 *
 * AI-to-DB guard layer (#385 Slice 3a): enforces `maxAssertionsPerDocument`
 * from the resolved extraction config before any batch write. Without this,
 * the cap in `resolve-config.ts` was advisory only — extractors could emit
 * more rows than the per-document budget and they all landed in the DB.
 */

import { prisma } from "@/lib/prisma";
import type { ExtractedAssertion } from "./extract-assertions";
import { resolveExtractionConfig } from "./resolve-config";

export interface SaveResult {
  created: number;
  duplicatesSkipped: number;
  /** Non-zero when the input exceeded `maxAssertionsPerDocument` and was truncated. */
  truncatedByCap?: number;
}

/**
 * Save extracted assertions to DB, deduplicating by content hash.
 *
 * Checks existing assertions for this source, skips any with matching
 * content hashes, then enforces the per-document cap from
 * `resolveExtractionConfig`, then batch-creates the survivors.
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

  // #385 Slice 3a — AI-to-DB guard: cap at maxAssertionsPerDocument.
  // The cap is resolved per-source via the extraction config (varies by
  // documentType + domain overrides). Existing rows don't count against
  // the new-batch cap because dedup already filtered them out.
  let truncatedByCap = 0;
  try {
    const cfg = await resolveExtractionConfig(sourceId);
    const cap = cfg.extraction?.maxAssertionsPerDocument;
    if (typeof cap === "number" && cap > 0 && toCreate.length > cap) {
      truncatedByCap = toCreate.length - cap;
      toCreate.length = cap;
      console.warn(
        `[save-assertions] source ${sourceId}: truncated ${truncatedByCap} assertion(s) — exceeded maxAssertionsPerDocument=${cap}`,
      );
    }
  } catch (err) {
    // Non-blocking — log and continue with the un-capped batch rather than
    // failing the save. The cap is defence-in-depth, not a correctness gate.
    console.warn(
      `[save-assertions] source ${sourceId}: failed to resolve cap, skipping guard: ${err instanceof Error ? err.message : String(err)}`,
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
