/**
 * Backfill subjectSourceId on ContentAssertion, ContentQuestion, ContentVocabulary.
 *
 * For each row where subjectSourceId is null:
 *   - Find SubjectSource rows where sourceId matches
 *   - If exactly ONE SubjectSource exists → set subjectSourceId to that row's id
 *   - If zero or multiple → leave null (ambiguous; will re-extract per subject on next upload)
 *
 * Safe to run multiple times (idempotent).
 * Epic #94 — Subject-Scoped Content Assertions.
 */

import { prisma } from "@/lib/prisma";

export interface BackfillSubjectSourceResult {
  assertions: { updated: number; skippedAmbiguous: number; skippedNoLink: number };
  questions: { updated: number; skippedAmbiguous: number; skippedNoLink: number };
  vocabulary: { updated: number; skippedAmbiguous: number; skippedNoLink: number };
}

export async function backfillSubjectSourceIds(): Promise<BackfillSubjectSourceResult> {
  // Build a map: sourceId → SubjectSource[] (only need id)
  const allSubjectSources = await prisma.subjectSource.findMany({
    select: { id: true, sourceId: true },
  });

  const bySourceId = new Map<string, string[]>();
  for (const ss of allSubjectSources) {
    const existing = bySourceId.get(ss.sourceId) ?? [];
    existing.push(ss.id);
    bySourceId.set(ss.sourceId, existing);
  }

  const result: BackfillSubjectSourceResult = {
    assertions: { updated: 0, skippedAmbiguous: 0, skippedNoLink: 0 },
    questions: { updated: 0, skippedAmbiguous: 0, skippedNoLink: 0 },
    vocabulary: { updated: 0, skippedAmbiguous: 0, skippedNoLink: 0 },
  };

  // Backfill ContentAssertions
  const assertions = await prisma.contentAssertion.findMany({
    where: { subjectSourceId: null },
    select: { id: true, sourceId: true },
  });

  for (const a of assertions) {
    const links = bySourceId.get(a.sourceId);
    if (!links || links.length === 0) {
      result.assertions.skippedNoLink++;
    } else if (links.length > 1) {
      result.assertions.skippedAmbiguous++;
    } else {
      await prisma.contentAssertion.update({
        where: { id: a.id },
        data: { subjectSourceId: links[0] },
      });
      result.assertions.updated++;
    }
  }

  // Backfill ContentQuestions
  const questions = await prisma.contentQuestion.findMany({
    where: { subjectSourceId: null },
    select: { id: true, sourceId: true },
  });

  for (const q of questions) {
    const links = bySourceId.get(q.sourceId);
    if (!links || links.length === 0) {
      result.questions.skippedNoLink++;
    } else if (links.length > 1) {
      result.questions.skippedAmbiguous++;
    } else {
      await prisma.contentQuestion.update({
        where: { id: q.id },
        data: { subjectSourceId: links[0] },
      });
      result.questions.updated++;
    }
  }

  // Backfill ContentVocabulary
  const vocabulary = await prisma.contentVocabulary.findMany({
    where: { subjectSourceId: null },
    select: { id: true, sourceId: true },
  });

  for (const v of vocabulary) {
    const links = bySourceId.get(v.sourceId);
    if (!links || links.length === 0) {
      result.vocabulary.skippedNoLink++;
    } else if (links.length > 1) {
      result.vocabulary.skippedAmbiguous++;
    } else {
      await prisma.contentVocabulary.update({
        where: { id: v.id },
        data: { subjectSourceId: links[0] },
      });
      result.vocabulary.updated++;
    }
  }

  return result;
}
