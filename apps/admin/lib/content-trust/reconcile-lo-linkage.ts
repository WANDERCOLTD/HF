/**
 * reconcile-lo-linkage.ts
 *
 * Populate `ContentAssertion.learningObjectiveId` after a curriculum exists.
 *
 * Two-pass reconciliation:
 *
 *   **Pass 1 — Structured ref matching** (deterministic, free).
 *   Matches `learningOutcomeRef` strings against LO refs via `loRefsMatch`
 *   (word-boundary bidirectional). Handles "LO1"↔"R04-LO1" etc. Writes
 *   `linkConfidence = 1.0`.
 *
 *   **Pass 2 — AI retag** (issue #162 follow-up — replaces the old Jaccard
 *   and vector passes that proved unreliable on narrative content).
 *   For orphans after Pass 1, batch the assertion text + full LO list into
 *   one AI call and ask it to return `{ [assertionId]: "LO ref" | null }`.
 *   Output is validated against the real LO whitelist — any ref not in the
 *   curriculum is rejected. Matched rows get `linkConfidence = 0.85`
 *   (AI-verified but not ground-truth). This is the fix for "the extractor
 *   can't tag refs because the curriculum didn't exist yet" — we retag AFTER
 *   the curriculum is in place.
 *
 * Runs automatically from `syncModulesToDB` after every curriculum save, and
 * on-demand from the `/api/curricula/[id]/reconcile-orphans` endpoint.
 *
 * The FK (`learningObjectiveId`) is the single source of truth. The string
 * `learningOutcomeRef` is preserved as write-time provenance.
 *
 * History: the earlier Jaccard keyword pass (Pass 2) scored 0 matches on
 * real narrative content (LO descriptions use abstract verbs like "Identify"
 * while assertions are concrete), and the vector cosine pass (Pass 3) near-
 * missed 41 assertions in the 0.4–0.55 band for the same reason. Both
 * removed in favour of a single AI retag call that sees both texts with
 * full context.
 */

import { prisma } from "@/lib/prisma";
import { loRefsMatch } from "@/lib/lesson-plan/lo-ref-match";
import { reconcileChildToParent } from "./reconcile-child-parent";

// ── Result types ──────────────────────────────────────────

export interface ReconcileResult {
  curriculumId: string;
  assertionsScanned: number;
  /** Pre-pass cleanup: stale refs/FKs cleared before matching */
  staleRefsCleared: number;
  staleFksCleared: number;
  /** Pass 1: FKs set via structured ref matching (linkConfidence = 1.0) */
  fkWritten: number;
  fkAlreadySet: number;
  noRefOnAssertion: number;
  refDidNotMatchAnyLo: number;
  /** Pass 2: FKs set via AI retag with LO list in context (linkConfidence = 0.85) */
  aiRetagMatched: number;
  aiRetagUnmatched: number;
  aiRetagInvalidRefs: number;
  assertionsByLoRef: Record<string, number>;

  // Legacy fields preserved for type-compat with older callers/tests.
  // Always 0 in the new flow.
  /** @deprecated — old Jaccard pass removed */
  semanticFkWritten: number;
  /** @deprecated — old Jaccard pass removed */
  semanticBelowThreshold: number;
  /** @deprecated — old vector cosine pass removed */
  vectorFkWritten: number;
  /** @deprecated — old vector cosine pass removed */
  vectorBelowThreshold: number;
  /** @deprecated — old vector cosine pass removed */
  vectorNearMiss: number;
  /** @deprecated — old vector cosine pass removed */
  avgVectorConfidence: number;
}

export interface ReconcileOptions {
  /** Set false to skip Pass 2 (the AI retag). Default true. */
  runAiRetagPass?: boolean;
}

// ── Legacy helpers preserved for test/tooling compat ─────
// These were the scoring primitives for the removed Jaccard Pass 2.
// Kept exported in case external tools import them — harmless when unused.

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "shall", "can", "this", "that",
  "these", "those", "it", "its", "not", "no", "as", "if", "so", "than",
  "how", "what", "when", "where", "which", "who", "whom", "their",
  "they", "them", "we", "our", "you", "your", "he", "she", "his", "her",
]);

export function tokenise(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  return new Set(words);
}

/** @deprecated — old Jaccard pass removed. Kept as a pure helper for tests. */
export function scoreMatch(
  assertionText: string,
  assertionCategory: string,
  loDescription: string,
): number {
  const aTokens = tokenise(assertionText);
  const loTokens = tokenise(loDescription);
  if (loTokens.size === 0 || aTokens.size === 0) return 0;
  let overlap = 0;
  for (const t of loTokens) if (aTokens.has(t)) overlap++;
  const base = overlap / loTokens.size;
  const catTokens = tokenise(assertionCategory.replace(/_/g, " "));
  let catBonus = 0;
  for (const ct of catTokens) if (loTokens.has(ct)) { catBonus = 0.1; break; }
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
export async function reconcileAssertionLOs(
  curriculumId: string,
  options: ReconcileOptions = {},
): Promise<ReconcileResult> {
  // Default OFF. Pass 1 (exact ref match) is free and runs always.
  // Pass 2 (AI retag) is an AI call — only fire when the caller explicitly
  // opts in, to avoid duplicate AI calls when multiple surfaces save curriculum
  // in rapid succession (#162 follow-up).
  const runAiRetagPass = options.runAiRetagPass === true;
  const curriculum = await prisma.curriculum.findUnique({
    where: { id: curriculumId },
    select: {
      id: true,
      subjectId: true,
      playbookId: true,
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
    staleRefsCleared: 0,
    staleFksCleared: 0,
    fkWritten: 0,
    fkAlreadySet: 0,
    noRefOnAssertion: 0,
    refDidNotMatchAnyLo: 0,
    aiRetagMatched: 0,
    aiRetagUnmatched: 0,
    aiRetagInvalidRefs: 0,
    assertionsByLoRef: {},
    // Legacy fields
    semanticFkWritten: 0,
    semanticBelowThreshold: 0,
    vectorFkWritten: 0,
    vectorBelowThreshold: 0,
    vectorNearMiss: 0,
    avgVectorConfidence: 0,
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

  // Resolve source IDs: prefer PlaybookSource (via curriculum.playbookId), fall back to SubjectSource
  let sourceIds: string[] = [];
  if (curriculum.playbookId) {
    const { getSourceIdsForPlaybook } = await import("@/lib/knowledge/domain-sources");
    sourceIds = await getSourceIdsForPlaybook(curriculum.playbookId);
  }
  if (sourceIds.length === 0 && curriculum.subjectId) {
    const subjectSources = await prisma.subjectSource.findMany({
      where: { subjectId: curriculum.subjectId },
      select: { sourceId: true },
    });
    sourceIds = [...new Set(subjectSources.map((s) => s.sourceId))];
  }
  if (sourceIds.length === 0) return empty;

  // ── Pre-pass: clear stale state ──────────────────────────
  // Two failure modes accumulate refs/FKs that point to nothing:
  //
  //   1. Per-source AI extractor wrote `learningOutcomeRef = "LO13"` using the
  //      OLD curriculum's LO list; a subsequent regenerate produced a smaller
  //      curriculum (LO1-LO12) and "LO13" no longer exists.
  //
  //   2. A previous reconcile run set `learningObjectiveId` to an LO that has
  //      since been deactivated (mode: "replace" in syncModulesToDB), so the
  //      FK now points at an inactive row. The current reconciler treats any
  //      non-null FK as "already set" and skips it — so stale FKs persist
  //      forever and block re-binding to the new active LO.
  //
  // Both cases: null out the stale field before pass 1 so the assertion
  // re-enters the matching pipeline cleanly. Idempotent — assertions with
  // valid refs/FKs are not touched.
  const validRefs = new Set(loArray.map((lo) => lo.ref));
  const validLoIds = new Set(loArray.map((lo) => lo.id));

  const staleRefs = await prisma.contentAssertion.updateMany({
    where: {
      sourceId: { in: sourceIds },
      learningOutcomeRef: { not: null },
      NOT: { learningOutcomeRef: { in: [...validRefs] } },
    },
    data: { learningOutcomeRef: null },
  });

  const staleFks = await prisma.contentAssertion.updateMany({
    where: {
      sourceId: { in: sourceIds },
      learningObjectiveId: { not: null },
      NOT: { learningObjectiveId: { in: [...validLoIds] } },
    },
    data: { learningObjectiveId: null },
  });

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

  const result: ReconcileResult = {
    ...empty,
    assertionsScanned: assertions.length,
    staleRefsCleared: staleRefs.count,
    staleFksCleared: staleFks.count,
  };

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
    // Pass 1 writes linkConfidence = 1.0 (exact ref match is ground truth).
    // Idempotency rule: we only touch rows that had no FK at the start of
    // this run, so we cannot overwrite a higher-confidence manual edit.
    await prisma.contentAssertion.updateMany({
      where: { id: { in: assertionIds } },
      data: { learningObjectiveId: loId, linkConfidence: 1.0 },
    });
  }

  // ── Pass 2: AI retag ────────────────────────────────────
  // Issue #162 follow-up. The old Jaccard (Pass 2) and vector cosine (Pass 3)
  // passes both scored poorly on real narrative content because LO
  // descriptions use abstract verbs ("Identify", "Analyse") while assertions
  // are concrete. One AI call with both texts in context beats both of them
  // combined. Runs per-batch to stay under prompt size limits.
  if (runAiRetagPass && needsSemantic.length > 0) {
    const retag = await runAiRetagPass_impl(needsSemantic, loArray);
    result.aiRetagMatched = retag.matched;
    result.aiRetagUnmatched = retag.unmatched;
    result.aiRetagInvalidRefs = retag.invalidRefs;
    for (const [ref, count] of Object.entries(retag.byRef)) {
      result.assertionsByLoRef[ref] = (result.assertionsByLoRef[ref] ?? 0) + count;
    }
  } else {
    result.aiRetagUnmatched = needsSemantic.length;
  }

  console.log(
    `[reconcile-lo-linkage] curriculum=${curriculumId}: scanned=${result.assertionsScanned} ` +
      `cleared-stale-refs=${result.staleRefsCleared} cleared-stale-fks=${result.staleFksCleared} ` +
      `pass1=${result.fkWritten} pass2-ai-retag=${result.aiRetagMatched} ` +
      `(unmatched=${result.aiRetagUnmatched} invalid-refs=${result.aiRetagInvalidRefs}) ` +
      `alreadySet=${result.fkAlreadySet} noRef=${result.noRefOnAssertion} ` +
      `unmatched-ref=${result.refDidNotMatchAnyLo}`,
  );

  return result;
}

// ── Pass 2: AI retag ──────────────────────────────────────

type OrphanAssertion = {
  id: string;
  assertion: string;
  category: string;
  learningOutcomeRef: string | null;
  learningObjectiveId: string | null;
};

type LoRow = { id: string; ref: string; description: string };

/**
 * Assertion→LO flavour of the generic reconcileChildToParent utility.
 * Thin wrapper — all prompt-building, batching, validation, and retry logic
 * lives in reconcile-child-parent.ts. This function just wires the Prisma
 * write path.
 *
 * Writes `linkConfidence = 0.80` on match (generic default). Lands in the
 * 🟡 "ok" band, visually distinct from 🟢 "strong" rows (1.0: exact-ref or
 * manual drawer picks).
 */
async function runAiRetagPass_impl(
  orphans: OrphanAssertion[],
  los: LoRow[],
): Promise<{
  matched: number;
  unmatched: number;
  invalidRefs: number;
  byRef: Record<string, number>;
}> {
  const result = await reconcileChildToParent<OrphanAssertion, LoRow>({
    children: orphans,
    parents: los,
    getChildId: (a) => a.id,
    getChildText: (a) => a.assertion,
    getChildCategory: (a) => a.category,
    getParentRef: (lo) => lo.ref,
    getParentDescription: (lo) => lo.description,
    getParentId: (lo) => lo.id,
    writeFk: async (childId, parentId, confidence) => {
      // Sync learningOutcomeRef to the matched LO ref so the next reconcile
      // run can short-circuit in Pass 1.
      const lo = los.find((x) => x.id === parentId);
      await prisma.contentAssertion.update({
        where: { id: childId },
        data: {
          learningObjectiveId: parentId,
          learningOutcomeRef: lo?.ref ?? null,
          linkConfidence: confidence,
        },
      });
    },
    aiCallPoint: "content-trust.retag-orphans",
    childLabel: "teaching points",
    parentLabel: "learning outcomes",
  });
  return {
    matched: result.matched,
    unmatched: result.unmatched,
    invalidRefs: result.invalidRefs,
    byRef: result.byRef,
  };
}
