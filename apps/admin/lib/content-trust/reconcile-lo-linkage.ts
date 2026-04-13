/**
 * reconcile-lo-linkage.ts
 *
 * Epic #131 A4 — populate `ContentAssertion.learningObjectiveId` by joining
 * the string `learningOutcomeRef` against `LearningObjective.ref` within the
 * curriculum scope.
 *
 * Two-pass reconciliation:
 *
 *   **Pass 1 — Structured ref matching** (original A4 logic, authoritative).
 *   Matches `learningOutcomeRef` strings against LO refs via `loRefsMatch`
 *   (word-boundary bidirectional). Handles "LO1"↔"R04-LO1" etc.
 *
 *   **Pass 2 — Semantic keyword matching** (#142).
 *   For assertions that still have no FK after pass 1 (null ref, free-text ref,
 *   or unmatched structured ref), scores assertion text against LO descriptions
 *   using Jaccard keyword overlap with category bonus. Best match above threshold
 *   gets the FK set. No AI calls — pure deterministic text similarity.
 *
 * Runs automatically from `syncModulesToDB` after every curriculum save, and
 * on-demand from the repair script (B2) and the extract route after first-pass
 * extraction (handles the temporal dependency where assertions are extracted
 * before LOs exist).
 *
 * The FK (`learningObjectiveId`) is the **single source of truth** for linkage.
 * The string `learningOutcomeRef` is preserved as write-time provenance — never
 * overwritten by semantic matching.
 */

import { prisma } from "@/lib/prisma";
import { loRefsMatch } from "@/lib/lesson-plan/lo-ref-match";

// ── Configuration ─────────────────────────────────────────

const SEMANTIC_LO_THRESHOLD = parseFloat(
  process.env.SEMANTIC_LO_THRESHOLD || "0.3",
);

// ── Result types ──────────────────────────────────────────

export interface ReconcileResult {
  curriculumId: string;
  assertionsScanned: number;
  /** Pass 1: FKs set via structured ref matching */
  fkWritten: number;
  fkAlreadySet: number;
  noRefOnAssertion: number;
  refDidNotMatchAnyLo: number;
  /** Pass 2: FKs set via semantic keyword matching */
  semanticFkWritten: number;
  semanticBelowThreshold: number;
  assertionsByLoRef: Record<string, number>;
}

// ── Semantic scoring ──────────────────────────────────────

/** Stop words to exclude from keyword scoring */
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "shall", "can", "this", "that",
  "these", "those", "it", "its", "not", "no", "as", "if", "so", "than",
  "how", "what", "when", "where", "which", "who", "whom", "their",
  "they", "them", "we", "our", "you", "your", "he", "she", "his", "her",
]);

/**
 * Tokenise text into lowercase keyword set, stripping stop words and
 * short tokens. Designed for comparing assertion text against LO descriptions.
 */
export function tokenise(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  return new Set(words);
}

/**
 * Score how well an assertion matches an LO description.
 * Returns 0–1 where 1 = perfect overlap.
 *
 * Base: Jaccard-style overlap weighted toward the LO side
 * (how much of the LO description is covered by the assertion text).
 *
 * Category bonus: +0.1 when the assertion category semantically aligns
 * with the LO description (e.g. category "character" + LO mentioning
 * "character motivations").
 */
export function scoreMatch(
  assertionText: string,
  assertionCategory: string,
  loDescription: string,
): number {
  const aTokens = tokenise(assertionText);
  const loTokens = tokenise(loDescription);

  if (loTokens.size === 0 || aTokens.size === 0) return 0;

  let overlap = 0;
  for (const t of loTokens) {
    if (aTokens.has(t)) overlap++;
  }

  // Base score: fraction of LO keywords found in assertion
  const base = overlap / loTokens.size;

  // Category bonus: if the assertion category appears as a keyword in the LO
  const catTokens = tokenise(assertionCategory.replace(/_/g, " "));
  let catBonus = 0;
  for (const ct of catTokens) {
    if (loTokens.has(ct)) {
      catBonus = 0.1;
      break;
    }
  }

  return Math.min(1, base + catBonus);
}

// ── Main reconciler ───────────────────────────────────────

/**
 * For every ContentAssertion reachable from this curriculum's sources that
 * has a non-null `learningOutcomeRef`, try to set `learningObjectiveId` by
 * matching against the curriculum's `LearningObjective` rows.
 *
 * Pass 1: Structured ref matching (original logic).
 * Pass 2: Semantic keyword matching for assertions still without FK.
 *
 * Idempotent — assertions that already have the FK set are left alone.
 * Safe to call on every curriculum save.
 */
export async function reconcileAssertionLOs(curriculumId: string): Promise<ReconcileResult> {
  const curriculum = await prisma.curriculum.findUnique({
    where: { id: curriculumId },
    select: {
      id: true,
      subjectId: true,
      modules: {
        where: { isActive: true },
        select: {
          id: true,
          learningObjectives: {
            select: { id: true, ref: true, description: true },
          },
        },
      },
    },
  });

  const empty: ReconcileResult = {
    curriculumId,
    assertionsScanned: 0,
    fkWritten: 0,
    fkAlreadySet: 0,
    noRefOnAssertion: 0,
    refDidNotMatchAnyLo: 0,
    semanticFkWritten: 0,
    semanticBelowThreshold: 0,
    assertionsByLoRef: {},
  };

  if (!curriculum) return empty;

  // Flatten LOs to (ref, id, description) — first occurrence wins per ref
  const loByRef = new Map<string, { id: string; ref: string; description: string }>();
  const loArray: { id: string; ref: string; description: string }[] = [];
  for (const mod of curriculum.modules) {
    for (const lo of mod.learningObjectives) {
      if (!loByRef.has(lo.ref)) {
        const entry = { id: lo.id, ref: lo.ref, description: lo.description };
        loByRef.set(lo.ref, entry);
        loArray.push(entry);
      }
    }
  }

  if (loArray.length === 0) return empty;

  // Resolve source IDs via the subject link chain
  const subjectSources = await prisma.subjectSource.findMany({
    where: { subjectId: curriculum.subjectId ?? undefined },
    select: { sourceId: true },
  });
  const sourceIds = [...new Set(subjectSources.map((s) => s.sourceId))];
  if (sourceIds.length === 0) return empty;

  const assertions = await prisma.contentAssertion.findMany({
    where: { sourceId: { in: sourceIds } },
    select: {
      id: true,
      assertion: true,
      category: true,
      learningOutcomeRef: true,
      learningObjectiveId: true,
    },
  });

  const result: ReconcileResult = { ...empty, assertionsScanned: assertions.length };

  // ── Pass 1: Structured ref matching ─────────────────────
  // Collect assertions that need pass 2 (no FK after pass 1)
  const needsSemantic: typeof assertions = [];

  for (const a of assertions) {
    if (a.learningObjectiveId) {
      result.fkAlreadySet++;
      continue;
    }
    if (!a.learningOutcomeRef) {
      // No string ref — can't do structured match, try semantic
      needsSemantic.push(a);
      result.noRefOnAssertion++;
      continue;
    }

    const match = loArray.find((lo) => loRefsMatch(a.learningOutcomeRef, lo.ref));
    if (match) {
      // Collect for batch update instead of N+1
      if (!result.assertionsByLoRef[match.ref]) {
        result.assertionsByLoRef[match.ref] = 0;
      }
      result.assertionsByLoRef[match.ref]++;
      result.fkWritten++;
      // Stage for batch: tag with the matched LO id
      (a as any)._matchedLoId = match.id;
    } else {
      result.refDidNotMatchAnyLo++;
      needsSemantic.push(a);
    }
  }

  // Batch update pass 1 results
  const pass1ByLoId = new Map<string, string[]>();
  for (const a of assertions) {
    const matchedId = (a as any)._matchedLoId;
    if (matchedId) {
      const list = pass1ByLoId.get(matchedId) || [];
      list.push(a.id);
      pass1ByLoId.set(matchedId, list);
    }
  }
  for (const [loId, assertionIds] of pass1ByLoId) {
    await prisma.contentAssertion.updateMany({
      where: { id: { in: assertionIds } },
      data: { learningObjectiveId: loId },
    });
  }

  // ── Pass 2: Semantic keyword matching ───────────────────
  // Pre-tokenise LO descriptions once
  const loTokensCache = new Map<string, Set<string>>();
  for (const lo of loArray) {
    loTokensCache.set(lo.id, tokenise(lo.description));
  }

  const pass2ByLoId = new Map<string, string[]>();

  for (const a of needsSemantic) {
    let bestScore = 0;
    let bestLo: { id: string; ref: string } | null = null;

    for (const lo of loArray) {
      const score = scoreMatch(a.assertion, a.category, lo.description);
      if (score > bestScore) {
        bestScore = score;
        bestLo = lo;
      }
    }

    if (bestLo && bestScore >= SEMANTIC_LO_THRESHOLD) {
      const list = pass2ByLoId.get(bestLo.id) || [];
      list.push(a.id);
      pass2ByLoId.set(bestLo.id, list);
      result.semanticFkWritten++;
      result.assertionsByLoRef[bestLo.ref] = (result.assertionsByLoRef[bestLo.ref] ?? 0) + 1;
    } else {
      result.semanticBelowThreshold++;
    }
  }

  // Batch update pass 2 results
  for (const [loId, assertionIds] of pass2ByLoId) {
    await prisma.contentAssertion.updateMany({
      where: { id: { in: assertionIds } },
      data: { learningObjectiveId: loId },
    });
  }

  console.log(
    `[reconcile-lo-linkage] curriculum=${curriculumId}: scanned=${result.assertionsScanned} ` +
      `pass1=${result.fkWritten} pass2-semantic=${result.semanticFkWritten} ` +
      `alreadySet=${result.fkAlreadySet} noRef=${result.noRefOnAssertion} ` +
      `unmatched-ref=${result.refDidNotMatchAnyLo} below-threshold=${result.semanticBelowThreshold} ` +
      `(threshold=${SEMANTIC_LO_THRESHOLD})`,
  );

  return result;
}
