/**
 * Backfill subjectSourceId on ContentAssertion, ContentQuestion, ContentVocabulary.
 *
 * For each row where subjectSourceId is null:
 *   - Find SubjectSource rows where sourceId matches
 *   - If exactly ONE SubjectSource exists → set subjectSourceId to that row's id
 *   - If MULTIPLE SubjectSource links exist (deduped source shared across subjects):
 *     → Assign original row to first link, CLONE row for each additional link.
 *     This fixes cross-course content leaking: each subject gets its own assertion copy.
 *   - If zero → leave null (orphan; no SubjectSource link exists)
 *
 * Safe to run multiple times (idempotent — only touches rows with null subjectSourceId).
 * Epic #94 — Subject-Scoped Content Assertions.
 */

import { prisma } from "@/lib/prisma";

export interface BackfillSubjectSourceResult {
  assertions: { updated: number; cloned: number; skippedNoLink: number };
  questions: { updated: number; cloned: number; skippedNoLink: number };
  vocabulary: { updated: number; cloned: number; skippedNoLink: number };
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
    assertions: { updated: 0, cloned: 0, skippedNoLink: 0 },
    questions: { updated: 0, cloned: 0, skippedNoLink: 0 },
    vocabulary: { updated: 0, cloned: 0, skippedNoLink: 0 },
  };

  // Backfill ContentAssertions
  const assertions = await prisma.contentAssertion.findMany({
    where: { subjectSourceId: null },
    select: {
      id: true, sourceId: true, assertion: true, category: true,
      chapter: true, section: true, pageRef: true, tags: true,
      trustLevel: true, examRelevance: true, learningOutcomeRef: true,
      learningObjectiveId: true, validUntil: true, taxYear: true,
      contentHash: true, depth: true, parentId: true, orderIndex: true,
      topicSlug: true, teachMethod: true, figureRefs: true,
    },
  });

  for (const a of assertions) {
    const links = bySourceId.get(a.sourceId);
    if (!links || links.length === 0) {
      result.assertions.skippedNoLink++;
    } else {
      // Assign original to first link
      await prisma.contentAssertion.update({
        where: { id: a.id },
        data: { subjectSourceId: links[0] },
      });
      result.assertions.updated++;

      // Clone for additional links (deduped sources shared across subjects)
      for (let i = 1; i < links.length; i++) {
        const { id: _id, ...rest } = a;
        await prisma.contentAssertion.create({
          data: { ...rest, subjectSourceId: links[i] },
        });
        result.assertions.cloned++;
      }
    }
  }

  // Backfill ContentQuestions
  const questions = await prisma.contentQuestion.findMany({
    where: { subjectSourceId: null },
    select: {
      id: true, sourceId: true, questionText: true, questionType: true,
      options: true, correctAnswer: true, chapter: true, learningOutcomeRef: true,
      difficulty: true, skillRef: true, metadata: true, sortOrder: true,
      contentHash: true,
    },
  });

  for (const q of questions) {
    const links = bySourceId.get(q.sourceId);
    if (!links || links.length === 0) {
      result.questions.skippedNoLink++;
    } else {
      await prisma.contentQuestion.update({
        where: { id: q.id },
        data: { subjectSourceId: links[0] },
      });
      result.questions.updated++;

      for (let i = 1; i < links.length; i++) {
        const { id: _id, ...rest } = q;
        await prisma.contentQuestion.create({
          data: { ...rest, subjectSourceId: links[i] },
        });
        result.questions.cloned++;
      }
    }
  }

  // Backfill ContentVocabulary
  const vocabulary = await prisma.contentVocabulary.findMany({
    where: { subjectSourceId: null },
    select: {
      id: true, sourceId: true, term: true, definition: true,
      partOfSpeech: true, exampleUsage: true, topic: true,
      sortOrder: true, contentHash: true,
    },
  });

  for (const v of vocabulary) {
    const links = bySourceId.get(v.sourceId);
    if (!links || links.length === 0) {
      result.vocabulary.skippedNoLink++;
    } else {
      await prisma.contentVocabulary.update({
        where: { id: v.id },
        data: { subjectSourceId: links[0] },
      });
      result.vocabulary.updated++;

      for (let i = 1; i < links.length; i++) {
        const { id: _id, ...rest } = v;
        await prisma.contentVocabulary.create({
          data: { ...rest, subjectSourceId: links[i] },
        });
        result.vocabulary.cloned++;
      }
    }
  }

  return result;
}
