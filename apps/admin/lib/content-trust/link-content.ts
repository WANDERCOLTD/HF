/**
 * Question-to-Assertion Content Linking
 *
 * Post-extraction step that matches orphaned questions and vocabulary
 * to their most relevant parent assertions using multi-strategy scoring:
 *
 * 1. Learning outcome reference exact match (highest priority)
 * 2. Chapter + section structural match
 * 3. Keyword overlap (Jaccard similarity)
 * 4. Tag overlap
 * 5. Vector similarity (optional, for top candidate confirmation)
 *
 * Non-destructive — only updates assertionId where currently NULL.
 * Idempotent — safe to re-run after embeddings complete or config changes.
 *
 * Configuration driven by SystemSettings (content_linking.*).
 */

import {
  getContentLinkingSettings,
  type ContentLinkingSettings,
  CONTENT_LINKING_DEFAULTS,
} from "@/lib/system-settings";

// ── Types ──────────────────────────────────────────────

export interface LinkingResult {
  questionsLinked: number;
  questionsOrphaned: number;
  vocabularyLinked: number;
  vocabularyOrphaned: number;
  warnings: string[];
}

interface AssertionCandidate {
  id: string;
  assertion: string;
  chapter: string | null;
  section: string | null;
  learningOutcomeRef: string | null;
  tags: string[];
  hasEmbedding: boolean;
  keywords: Set<string>;
}

interface LinkableItem {
  id: string;
  text: string;
  chapter: string | null;
  section: string | null;
  learningOutcomeRef: string | null;
  tags: string[];
  keywords: Set<string>;
}

// ── Stop words ─────────────────────────────────────────

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "through", "during",
  "before", "after", "above", "below", "between", "out", "off", "over",
  "under", "again", "further", "then", "once", "here", "there", "when",
  "where", "why", "how", "all", "each", "every", "both", "few", "more",
  "most", "other", "some", "such", "no", "not", "only", "own", "same",
  "so", "than", "too", "very", "just", "because", "if", "or", "and",
  "but", "nor", "what", "which", "who", "whom", "this", "that", "these",
  "those", "it", "its", "he", "she", "they", "them", "we", "you", "i",
]);

// ── Keyword extraction ─────────────────────────────────

/**
 * Extract meaningful keywords from text (stop words removed, lowercased).
 */
function extractKeywords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return new Set(words);
}

/**
 * Jaccard similarity between two keyword sets.
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ── Scoring ────────────────────────────────────────────

/**
 * Score a candidate assertion against a linkable item.
 * Returns a composite score between 0 and ~1.7 (boosts can stack).
 */
function scoreCandidate(
  item: LinkableItem,
  candidate: AssertionCandidate,
  settings: ContentLinkingSettings,
): number {
  let score = 0;

  // 1. LO reference exact match (strongest signal)
  if (
    item.learningOutcomeRef &&
    candidate.learningOutcomeRef &&
    item.learningOutcomeRef === candidate.learningOutcomeRef
  ) {
    score += settings.loRefMatchBoost;
  }

  // 2. Chapter + section structural match
  if (item.chapter && candidate.chapter) {
    const chapterMatch = item.chapter.toLowerCase() === candidate.chapter.toLowerCase();
    if (chapterMatch) {
      score += settings.chapterMatchBoost;
      // Extra boost for section match within same chapter
      if (
        item.section &&
        candidate.section &&
        item.section.toLowerCase() === candidate.section.toLowerCase()
      ) {
        score += settings.chapterMatchBoost * 0.4; // 40% of chapter boost
      }
    }
  }

  // 3. Keyword overlap (Jaccard)
  const keywordScore = jaccardSimilarity(item.keywords, candidate.keywords);
  if (keywordScore >= settings.minKeywordScore) {
    score += keywordScore * 0.5; // Scale keyword contribution
  }

  // 4. Tag overlap
  if (item.tags.length > 0 && candidate.tags.length > 0) {
    const itemTags = new Set(item.tags.map((t) => t.toLowerCase()));
    const candidateTags = new Set(candidate.tags.map((t) => t.toLowerCase()));
    let tagOverlap = 0;
    for (const tag of itemTags) {
      if (candidateTags.has(tag)) tagOverlap++;
    }
    if (tagOverlap > 0) {
      score += (tagOverlap / Math.max(itemTags.size, candidateTags.size)) * 0.15;
    }
  }

  return score;
}

// ── Main linking function ──────────────────────────────

/**
 * Link orphaned questions and vocabulary to their best-matching assertions.
 *
 * Loads all assertions for the source, scores each unlinked question/vocab
 * against them, and updates assertionId for items above the threshold.
 *
 * Vector similarity is used selectively — only for the top keyword candidate
 * per item (1 embedding call per question, not N).
 */
export async function linkContentForSource(sourceId: string, subjectSourceId?: string): Promise<LinkingResult> {
  const settings = await getContentLinkingSettings().catch(() => CONTENT_LINKING_DEFAULTS);
  const warnings: string[] = [];

  const { prisma } = await import("@/lib/prisma");
  const { Prisma } = await import("@prisma/client");

  // 1. Load assertions for this source
  const rawAssertions = await prisma.$queryRaw<
    Array<{
      id: string;
      assertion: string;
      chapter: string | null;
      section: string | null;
      learningOutcomeRef: string | null;
      tags: string[];
      hasEmbedding: boolean;
    }>
  >(
    subjectSourceId
      ? Prisma.sql`
          SELECT id, assertion, chapter, section, "learningOutcomeRef", tags,
                 (embedding IS NOT NULL) as "hasEmbedding"
          FROM "ContentAssertion"
          WHERE "sourceId" = ${sourceId} AND "subjectSourceId" = ${subjectSourceId}
        `
      : Prisma.sql`
          SELECT id, assertion, chapter, section, "learningOutcomeRef", tags,
                 (embedding IS NOT NULL) as "hasEmbedding"
          FROM "ContentAssertion"
          WHERE "sourceId" = ${sourceId}
        `,
  );

  if (rawAssertions.length === 0) {
    return { questionsLinked: 0, questionsOrphaned: 0, vocabularyLinked: 0, vocabularyOrphaned: 0, warnings: ["No assertions found for source"] };
  }

  const assertions: AssertionCandidate[] = rawAssertions.map((a) => ({
    ...a,
    keywords: extractKeywords(a.assertion),
  }));

  // 2. Load unlinked questions
  const unlinkedQuestions = await prisma.contentQuestion.findMany({
    where: { sourceId, assertionId: null, ...(subjectSourceId ? { subjectSourceId } : {}) },
    select: {
      id: true,
      questionText: true,
      chapter: true,
      section: true,
      learningOutcomeRef: true,
      tags: true,
    },
  });

  // 3. Load unlinked vocabulary
  const unlinkedVocab = await prisma.contentVocabulary.findMany({
    where: { sourceId, assertionId: null, ...(subjectSourceId ? { subjectSourceId } : {}) },
    select: {
      id: true,
      term: true,
      definition: true,
      chapter: true,
      topic: true,
      tags: true,
    },
  });

  if (unlinkedQuestions.length === 0 && unlinkedVocab.length === 0) {
    return { questionsLinked: 0, questionsOrphaned: 0, vocabularyLinked: 0, vocabularyOrphaned: 0, warnings: [] };
  }

  // 4. Link questions
  let questionsLinked = 0;
  let questionsOrphaned = 0;

  for (const q of unlinkedQuestions) {
    const item: LinkableItem = {
      id: q.id,
      text: q.questionText,
      chapter: q.chapter,
      section: q.section,
      learningOutcomeRef: q.learningOutcomeRef,
      tags: q.tags,
      keywords: extractKeywords(q.questionText),
    };

    const bestMatch = findBestMatch(item, assertions, settings);

    if (bestMatch && bestMatch.score >= settings.minLinkScore) {
      // Optional: confirm with vector similarity
      const confirmed = await confirmWithVector(
        item.text,
        bestMatch.assertionId,
        settings,
        prisma,
        Prisma,
      );

      if (confirmed) {
        await prisma.contentQuestion.update({
          where: { id: q.id },
          data: { assertionId: bestMatch.assertionId },
        });
        questionsLinked++;
      } else {
        questionsOrphaned++;
      }
    } else {
      questionsOrphaned++;
    }
  }

  // 5. Link vocabulary
  let vocabularyLinked = 0;
  let vocabularyOrphaned = 0;

  for (const v of unlinkedVocab) {
    const searchText = `${v.term} ${v.definition}`;
    const item: LinkableItem = {
      id: v.id,
      text: searchText,
      chapter: v.chapter,
      section: null,
      learningOutcomeRef: null,
      tags: v.tags,
      keywords: extractKeywords(searchText),
    };

    const bestMatch = findBestMatch(item, assertions, settings);

    if (bestMatch && bestMatch.score >= settings.minLinkScore) {
      const confirmed = await confirmWithVector(
        item.text,
        bestMatch.assertionId,
        settings,
        prisma,
        Prisma,
      );

      if (confirmed) {
        await prisma.contentVocabulary.update({
          where: { id: v.id },
          data: { assertionId: bestMatch.assertionId },
        });
        vocabularyLinked++;
      } else {
        vocabularyOrphaned++;
      }
    } else {
      vocabularyOrphaned++;
    }
  }

  // Summary warnings
  if (questionsOrphaned > 0) {
    warnings.push(
      `${questionsOrphaned} question${questionsOrphaned > 1 ? "s" : ""} could not be linked to assertions (below score threshold ${settings.minLinkScore})`,
    );
  }
  if (vocabularyOrphaned > 0) {
    warnings.push(
      `${vocabularyOrphaned} vocabulary term${vocabularyOrphaned > 1 ? "s" : ""} could not be linked to assertions`,
    );
  }
  if (questionsLinked > 0 || vocabularyLinked > 0) {
    warnings.push(
      `Linked ${questionsLinked} question${questionsLinked !== 1 ? "s" : ""} and ${vocabularyLinked} vocabulary term${vocabularyLinked !== 1 ? "s" : ""} to assertions`,
    );
  }

  return { questionsLinked, questionsOrphaned, vocabularyLinked, vocabularyOrphaned, warnings };
}

// ── Helpers ────────────────────────────────────────────

/**
 * Find the best-matching assertion for an item.
 * Returns the assertion ID and score, or null if no candidate scores above minKeywordScore.
 */
function findBestMatch(
  item: LinkableItem,
  assertions: AssertionCandidate[],
  settings: ContentLinkingSettings,
): { assertionId: string; score: number } | null {
  let bestId: string | null = null;
  let bestScore = 0;

  for (const candidate of assertions) {
    const score = scoreCandidate(item, candidate, settings);
    if (score > bestScore) {
      bestScore = score;
      bestId = candidate.id;
    }
  }

  return bestId ? { assertionId: bestId, score: bestScore } : null;
}

/**
 * Optionally confirm a match using vector cosine similarity.
 * Only fires if useVectorSimilarity is enabled AND the assertion has an embedding.
 * If vector check is disabled or no embedding, always confirms (pass-through).
 */
async function confirmWithVector(
  itemText: string,
  assertionId: string,
  settings: ContentLinkingSettings,
  prisma: any,
  Prisma: any,
): Promise<boolean> {
  if (!settings.useVectorSimilarity) return true;

  // Check if assertion has an embedding
  const rows = (await prisma.$queryRaw(
    Prisma.sql`
      SELECT (embedding IS NOT NULL) as "hasEmb"
      FROM "ContentAssertion"
      WHERE id = ${assertionId}
    `,
  )) as Array<{ hasEmb: boolean }>;

  if (!rows[0]?.hasEmb) return true; // No embedding yet — skip vector check

  try {
    const { embedText, toVectorLiteral } = await import("@/lib/embeddings");
    const embedding = await embedText(itemText);
    const vecLiteral = toVectorLiteral(embedding);

    // Compute cosine similarity
    const result = (await prisma.$queryRaw(
      Prisma.sql`
        SELECT 1 - (embedding <=> ${vecLiteral}::vector) as similarity
        FROM "ContentAssertion"
        WHERE id = ${assertionId} AND embedding IS NOT NULL
      `,
    )) as Array<{ similarity: number }>;

    const similarity = result[0]?.similarity ?? 0;
    return similarity >= settings.minVectorSimilarity;
  } catch {
    // If embedding fails (e.g., no API key), degrade gracefully
    return true;
  }
}
