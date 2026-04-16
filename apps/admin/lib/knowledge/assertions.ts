/**
 * Shared assertion search functions — used by both VAPI knowledge endpoint
 * and sim call per-turn retrieval.
 *
 * Supports hybrid search (pgvector cosine similarity + keyword fallback).
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { toVectorLiteral } from "@/lib/embeddings";

export type AssertionMediaRef = {
  mediaId: string;
  figureRef: string | null;
  captionText: string | null;
};

export type AssertionResult = {
  id?: string;
  assertion: string;
  category: string;
  chapter: string | null;
  tags: string[];
  trustLevel: string | null;
  examRelevance: number | null;
  sourceName: string;
  relevanceScore: number;
  teachMethod: string | null;
  /** Linked figures/images from AssertionMedia junction */
  mediaRefs?: AssertionMediaRef[];
};

/**
 * Hybrid assertion search: runs vector + keyword in parallel, merges by ID, averages scores.
 * @param sourceIds — when provided, only return assertions from these content sources (domain scoping)
 */
export async function searchAssertionsHybrid(
  queryText: string,
  queryEmbedding: number[],
  limit: number,
  minRelevance = 0.3,
  sourceIds?: string[],
  subjectSourceIds?: string[],
): Promise<AssertionResult[]> {
  // Empty sourceIds = domain has no content sources → no results
  if (sourceIds && sourceIds.length === 0) return [];

  const [vectorResults, keywordResults] = await Promise.all([
    searchAssertionsByVector(queryEmbedding, limit * 2, minRelevance, sourceIds, subjectSourceIds),
    searchAssertions(queryText, limit * 2, sourceIds, subjectSourceIds),
  ]);

  // Merge by assertion text (dedup), average scores
  const merged = new Map<string, AssertionResult>();

  for (const r of vectorResults) {
    merged.set(r.assertion, r);
  }

  for (const r of keywordResults) {
    const existing = merged.get(r.assertion);
    if (existing) {
      // Average the scores for items found by both methods
      existing.relevanceScore = (existing.relevanceScore + r.relevanceScore) / 2;
    } else {
      merged.set(r.assertion, r);
    }
  }

  const results = Array.from(merged.values())
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);

  // Batch-load linked media for the result set
  await attachMediaRefs(results);

  return results;
}

/**
 * Search ContentAssertions by vector similarity (pgvector cosine distance).
 * @param sourceIds — when provided, only return assertions from these content sources (domain scoping)
 */
export async function searchAssertionsByVector(
  queryEmbedding: number[],
  limit: number,
  minRelevance = 0.3,
  sourceIds?: string[],
  subjectSourceIds?: string[],
): Promise<AssertionResult[]> {
  if (sourceIds && sourceIds.length === 0) return [];

  const vectorLiteral = toVectorLiteral(queryEmbedding);

  // Build WHERE clause: prefer subjectSourceIds when available, fall back to sourceIds
  const hasSubjectScope = subjectSourceIds && subjectSourceIds.length > 0;
  const hasSourceScope = sourceIds && sourceIds.length > 0;

  const rows = await prisma.$queryRaw<Array<{
    id: string;
    assertion: string;
    category: string;
    chapter: string | null;
    tags: string[];
    trustLevel: string | null;
    examRelevance: number | null;
    teachMethod: string | null;
    sourceName: string;
    similarity: number;
  }>>(
    hasSubjectScope
      ? Prisma.sql`
          SELECT a.id, a.assertion, a.category, a.chapter, a.tags,
                 a."trustLevel"::text, a."examRelevance",
                 a."teachMethod",
                 s.name as "sourceName",
                 1 - (a.embedding <=> ${vectorLiteral}::vector) as similarity
          FROM "ContentAssertion" a
          JOIN "ContentSource" s ON a."sourceId" = s.id
          WHERE a.embedding IS NOT NULL
            AND (a."subjectSourceId" = ANY(${subjectSourceIds}::text[]) OR a."subjectSourceId" IS NULL)
            AND a."sourceId" = ANY(${sourceIds ?? []}::text[])
          ORDER BY a.embedding <=> ${vectorLiteral}::vector
          LIMIT ${limit}
        `
      : hasSourceScope
        ? Prisma.sql`
            SELECT a.id, a.assertion, a.category, a.chapter, a.tags,
                   a."trustLevel"::text, a."examRelevance",
                   a."teachMethod",
                   s.name as "sourceName",
                   1 - (a.embedding <=> ${vectorLiteral}::vector) as similarity
            FROM "ContentAssertion" a
            JOIN "ContentSource" s ON a."sourceId" = s.id
            WHERE a.embedding IS NOT NULL
              AND a."sourceId" = ANY(${sourceIds}::text[])
            ORDER BY a.embedding <=> ${vectorLiteral}::vector
            LIMIT ${limit}
          `
        : Prisma.sql`
            SELECT a.id, a.assertion, a.category, a.chapter, a.tags,
                   a."trustLevel"::text, a."examRelevance",
                   a."teachMethod",
                   s.name as "sourceName",
                   1 - (a.embedding <=> ${vectorLiteral}::vector) as similarity
            FROM "ContentAssertion" a
            JOIN "ContentSource" s ON a."sourceId" = s.id
            WHERE a.embedding IS NOT NULL
            ORDER BY a.embedding <=> ${vectorLiteral}::vector
            LIMIT ${limit}
          `
  );

  return rows
    .filter((r) => r.similarity >= minRelevance)
    .map((r) => ({
      id: r.id,
      assertion: r.assertion,
      category: r.category,
      chapter: r.chapter,
      tags: r.tags || [],
      trustLevel: r.trustLevel,
      examRelevance: r.examRelevance,
      teachMethod: r.teachMethod,
      sourceName: r.sourceName,
      relevanceScore: r.similarity,
    }));
}

/**
 * Search ContentAssertions by tag and keyword matching (fallback).
 * @param sourceIds — when provided, only return assertions from these content sources (domain scoping)
 */
export async function searchAssertions(
  queryText: string,
  limit: number,
  sourceIds?: string[],
  subjectSourceIds?: string[],
): Promise<AssertionResult[]> {
  if (sourceIds && sourceIds.length === 0) return [];

  // Extract keywords for tag matching
  const words = queryText
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  if (words.length === 0) return [];

  // Search by content and tags, scoped to domain's sources when available.
  // Strict subjectSourceId scoping — no null fallback to prevent cross-course leaking.
  const assertions = await prisma.contentAssertion.findMany({
    where: {
      ...(sourceIds ? { sourceId: { in: sourceIds } } : {}),
      ...(subjectSourceIds && subjectSourceIds.length > 0
        ? { subjectSourceId: { in: subjectSourceIds } }
        : {}),
      AND: [{
        OR: [
          // Match assertion text
          ...words.slice(0, 5).map((w) => ({
            assertion: { contains: w, mode: "insensitive" as const },
          })),
          // Match tags
          { tags: { hasSome: words.slice(0, 10) } },
        ],
      }],
    },
    take: limit * 2, // Fetch extra for scoring
    include: {
      source: { select: { name: true, trustLevel: true } },
    },
  });

  // Score by keyword overlap
  return assertions
    .map((a) => {
      const lowerAssertion = a.assertion.toLowerCase();
      const tagSet = new Set(a.tags.map((t) => t.toLowerCase()));
      const contentMatches = words.filter((w) => lowerAssertion.includes(w)).length;
      const tagMatches = words.filter((w) => tagSet.has(w)).length;
      // Boost deeper assertions (key points and details have more specific content)
      const depthBoost = (a.depth === null || a.depth === undefined || a.depth >= 2) ? 0.05 : 0;
      const relevanceScore = Math.min(
        1,
        (contentMatches + tagMatches * 1.5) / words.length * 0.7 +
          (a.examRelevance || 0.5) * 0.3 +
          depthBoost,
      );

      return {
        id: a.id,
        assertion: a.assertion,
        category: a.category,
        chapter: a.chapter,
        tags: a.tags,
        trustLevel: a.trustLevel,
        examRelevance: a.examRelevance,
        teachMethod: a.teachMethod ?? null,
        sourceName: a.source.name,
        relevanceScore,
      };
    })
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);
}

/**
 * Search caller memories relevant to the current conversation topic.
 */
export async function searchCallerMemories(
  callerId: string,
  queryText: string,
  limit: number,
): Promise<Array<{ key: string; value: string; category: string; relevanceScore: number }>> {
  const words = queryText
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  if (words.length === 0) return [];

  const memories = await prisma.callerMemory.findMany({
    where: {
      callerId,
      supersededById: null,
      OR: [
        ...words.slice(0, 5).map((w) => ({
          key: { contains: w, mode: "insensitive" as const },
        })),
        ...words.slice(0, 5).map((w) => ({
          value: { contains: w, mode: "insensitive" as const },
        })),
      ],
    },
    take: limit,
    orderBy: { confidence: "desc" },
  });

  return memories.map((m) => {
    const lowerKey = m.key.toLowerCase();
    const lowerValue = m.value.toLowerCase();
    const matches = words.filter(
      (w) => lowerKey.includes(w) || lowerValue.includes(w),
    ).length;

    return {
      key: m.key,
      value: m.value,
      category: m.category,
      relevanceScore: Math.min(1, matches / words.length + 0.3),
    };
  });
}

/**
 * Batch-load linked media (figures/images) for a set of assertion results.
 * Populates the `mediaRefs` field on each result that has linked images.
 */
async function attachMediaRefs(results: AssertionResult[]): Promise<void> {
  const ids = results.map((r) => r.id).filter(Boolean) as string[];
  if (ids.length === 0) return;

  const links = await prisma.assertionMedia.findMany({
    where: { assertionId: { in: ids } },
    select: {
      assertionId: true,
      figureRef: true,
      media: {
        select: { id: true, captionText: true },
      },
    },
  });

  if (links.length === 0) return;

  // Group by assertionId
  const byAssertion = new Map<string, AssertionMediaRef[]>();
  for (const link of links) {
    const refs = byAssertion.get(link.assertionId) || [];
    refs.push({
      mediaId: link.media.id,
      figureRef: link.figureRef,
      captionText: link.media.captionText,
    });
    byAssertion.set(link.assertionId, refs);
  }

  // Attach to results
  for (const r of results) {
    if (r.id && byAssertion.has(r.id)) {
      r.mediaRefs = byAssertion.get(r.id)!;
    }
  }
}

/**
 * Format a teaching assertion for AI consumption.
 */
export function formatAssertion(a: {
  assertion: string;
  category: string;
  chapter: string | null;
  sourceName: string;
  trustLevel: string | null;
  teachMethod?: string | null;
  mediaRefs?: AssertionMediaRef[];
}): string {
  const parts: string[] = [];
  if (a.teachMethod) parts.push(`[${a.teachMethod}]`);
  parts.push(`[${a.category.toUpperCase()}]`);
  if (a.chapter) parts.push(`(${a.chapter})`);
  parts.push(a.assertion);
  if (a.trustLevel) parts.push(`[Trust: ${a.trustLevel}]`);

  // Append linked figure markers so the AI knows images are available
  if (a.mediaRefs?.length) {
    for (const ref of a.mediaRefs) {
      const label = ref.captionText || ref.figureRef || ref.mediaId;
      parts.push(`[HAS FIGURE: "${label}", media_id: ${ref.mediaId}]`);
    }
  }

  return parts.join(" ");
}

// ------------------------------------------------------------------
// Question search
// ------------------------------------------------------------------

export type QuestionResult = {
  questionText: string;
  questionType: string;
  correctAnswer: string | null;
  difficulty: number | null;
  tags: string[];
  relevanceScore: number;
};

/**
 * Search ContentQuestions by keyword matching.
 * Used by VAPI knowledge endpoint when learner asks for practice/assessment.
 * @param sourceIds — when provided, only return questions from these content sources (domain scoping)
 */
export async function searchQuestions(
  queryText: string,
  limit: number,
  sourceIds?: string[],
): Promise<QuestionResult[]> {
  if (sourceIds && sourceIds.length === 0) return [];

  const words = queryText
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  if (words.length === 0) return [];

  const questions = await prisma.contentQuestion.findMany({
    where: {
      ...(sourceIds ? { sourceId: { in: sourceIds } } : {}),
      OR: [
        ...words.slice(0, 5).map((w) => ({
          questionText: { contains: w, mode: "insensitive" as const },
        })),
        { tags: { hasSome: words.slice(0, 10) } },
      ],
    },
    take: limit * 2,
  });

  return questions
    .map((q) => {
      const lower = q.questionText.toLowerCase();
      const tagSet = new Set((q.tags || []).map((t) => t.toLowerCase()));
      const matches = words.filter((w) => lower.includes(w) || tagSet.has(w)).length;
      return {
        questionText: q.questionText,
        questionType: q.questionType,
        correctAnswer: q.correctAnswer,
        difficulty: q.difficulty,
        tags: q.tags || [],
        relevanceScore: Math.min(1, matches / words.length * 0.8 + 0.2),
      };
    })
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);
}

/**
 * Format a question for AI consumption (VAPI knowledge result).
 */
export function formatQuestion(q: QuestionResult): string {
  const parts = [`[QUESTION: ${q.questionType}]`];
  parts.push(q.questionText);
  if (q.correctAnswer) parts.push(`→ ${q.correctAnswer}`);
  if (q.difficulty) parts.push(`[Difficulty: ${q.difficulty}]`);
  return parts.join(" ");
}

// ------------------------------------------------------------------
// Vocabulary search
// ------------------------------------------------------------------

export type VocabularyResult = {
  term: string;
  definition: string;
  partOfSpeech: string | null;
  topic: string | null;
  relevanceScore: number;
};

/**
 * Search ContentVocabulary by keyword matching.
 * Used by VAPI knowledge endpoint when learner asks "what does X mean?"
 * @param sourceIds — when provided, only return vocabulary from these content sources (domain scoping)
 */
export async function searchVocabulary(
  queryText: string,
  limit: number,
  sourceIds?: string[],
): Promise<VocabularyResult[]> {
  if (sourceIds && sourceIds.length === 0) return [];

  const words = queryText
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  if (words.length === 0) return [];

  const vocabulary = await prisma.contentVocabulary.findMany({
    where: {
      ...(sourceIds ? { sourceId: { in: sourceIds } } : {}),
      OR: [
        ...words.slice(0, 5).map((w) => ({
          term: { contains: w, mode: "insensitive" as const },
        })),
        ...words.slice(0, 5).map((w) => ({
          definition: { contains: w, mode: "insensitive" as const },
        })),
        { tags: { hasSome: words.slice(0, 10) } },
      ],
    },
    take: limit * 2,
  });

  return vocabulary
    .map((v) => {
      const lowerTerm = v.term.toLowerCase();
      const lowerDef = v.definition.toLowerCase();
      const termMatches = words.filter((w) => lowerTerm.includes(w)).length;
      const defMatches = words.filter((w) => lowerDef.includes(w)).length;
      return {
        term: v.term,
        definition: v.definition,
        partOfSpeech: v.partOfSpeech,
        topic: v.topic,
        relevanceScore: Math.min(1, (termMatches * 2 + defMatches) / words.length * 0.7 + 0.3),
      };
    })
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);
}

/**
 * Format a vocabulary item for AI consumption (VAPI knowledge result).
 */
export function formatVocabulary(v: VocabularyResult): string {
  const pos = v.partOfSpeech ? ` (${v.partOfSpeech})` : "";
  return `[VOCABULARY] ${v.term}${pos}: ${v.definition}`;
}
