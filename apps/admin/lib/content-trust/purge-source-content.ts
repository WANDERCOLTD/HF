/**
 * Purge all extracted content for a source.
 *
 * Deletes assertions, questions, and vocabulary in dependency order.
 * AssertionMedia cascades automatically when assertions are deleted.
 *
 * Used by the extract route's `replace` mode to ensure a clean slate
 * before re-extraction (prevents near-duplicate accumulation from
 * non-deterministic AI output).
 */

import { prisma } from "@/lib/prisma";

export interface PurgeResult {
  assertions: number;
  questions: number;
  vocabulary: number;
}

export async function purgeSourceContent(sourceId: string): Promise<PurgeResult> {
  // Delete in dependency order: questions/vocab first (they reference assertions),
  // then assertions (AssertionMedia cascades via onDelete: Cascade).
  const [questions, vocabulary, assertions] = await prisma.$transaction([
    prisma.contentQuestion.deleteMany({ where: { sourceId } }),
    prisma.contentVocabulary.deleteMany({ where: { sourceId } }),
    prisma.contentAssertion.deleteMany({ where: { sourceId } }),
  ]);

  return {
    assertions: assertions.count,
    questions: questions.count,
    vocabulary: vocabulary.count,
  };
}
