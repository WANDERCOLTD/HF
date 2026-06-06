/**
 * retrieval-question-selector.ts — #164 (retrieval practice).
 *
 * Selects MCQs for the retrieval-practice COMPOSE transform. Called once
 * per prompt composition in continuous mode. Pure DB read — no AI call.
 *
 * Selection strategy:
 *   1. Filter by assessmentUse (FORMATIVE, TUTOR_ONLY, BOTH — not PRE/POST_TEST)
 *   2. Filter by bloomLevel >= bloomFloor
 *   3. Filter by learningOutcomeRef matching current working-set LOs
 *   4. Exclude recently-used question IDs (prevent repetition)
 *   5. For voice channel: exclude question types that need visual aids
 *   6. Spread by Bloom level (prefer diversity over repetition of one level)
 *   7. If LO-filtered pool is too small, fall back to full curriculum pool
 *
 * Reuses patterns from `lib/assessment/pre-test-builder.ts` (Bloom spread,
 * skill spread) but adapted for per-call retrieval context.
 */

import { prisma } from "@/lib/prisma";
import { getSourceIdsForPlaybook } from "@/lib/knowledge/domain-sources";

/** Bloom levels in taxonomy order for >= comparison */
const BLOOM_ORDER: string[] = [
  "REMEMBER",
  "UNDERSTAND",
  "APPLY",
  "ANALYZE",
  "EVALUATE",
  "CREATE",
];

/** Question types that require visual presentation (not suitable for voice) */
const VISUAL_ONLY_TYPES = new Set(["MATCHING", "ORDERING", "UNSCRAMBLE"]);

/** AssessmentUse values eligible for retrieval practice */
const RETRIEVAL_ELIGIBLE_USES = ["FORMATIVE", "TUTOR_ONLY", "BOTH"];

export interface RetrievalQuestion {
  id: string;
  questionText: string;
  questionType: string;
  options: unknown;
  correctAnswer: string | null;
  answerExplanation: string | null;
  learningOutcomeRef: string | null;
  bloomLevel: string | null;
  difficulty: number | null;
}

export interface SelectRetrievalOpts {
  /**
   * Curriculum ID — kept for back-compat / logging only. The actual source
   * resolution now goes through `playbookId` via
   * `getSourceIdsForPlaybook` to walk the modern PlaybookSource attachment
   * chain. The legacy `source: { curricula: { some: { id } } }` filter only
   * matched sources where `Curriculum.primarySourceId = ContentSource.id`
   * (the `@relation("CurriculumPrimarySource")` back-relation), which silently
   * returned zero questions for every course that attached its Question
   * Banks via PlaybookSource — i.e. all of the CIO/CTO Standard variants
   * + any other modern course. See #1167.
   */
  curriculumId: string;
  /**
   * #1167 — Playbook ID for the canonical source resolution. When provided,
   * sources are resolved via `getSourceIdsForPlaybook(playbookId)` which
   * walks `PlaybookSource` first, then the legacy 4-hop
   * `PlaybookSubject → Subject → SubjectSource` chain. When omitted (legacy
   * callers), the function falls back to the broken curricula-relation
   * filter so existing behaviour is preserved — but new callers should
   * always pass `playbookId`.
   */
  playbookId?: string | null;
  /** LO refs from the current working set (e.g., ["LO1", "LO2"]) */
  outcomeRefs: string[];
  /** How many questions to select */
  count: number;
  /** Minimum Bloom level (e.g., "REMEMBER", "UNDERSTAND") */
  bloomFloor: string;
  /** Question IDs to exclude (recently used, prevent repetition) */
  recentQuestionIds: string[];
  /** Delivery channel — voice excludes visual-only question types */
  channel: "text" | "voice";
}

/**
 * Select retrieval practice questions for the current call.
 *
 * Returns up to `count` questions, possibly fewer if the pool is small.
 * Returns empty array if no questions exist (graceful no-op).
 */
export async function selectRetrievalQuestions(
  opts: SelectRetrievalOpts,
): Promise<RetrievalQuestion[]> {
  const { curriculumId, playbookId, outcomeRefs, count, bloomFloor, recentQuestionIds, channel } = opts;

  if (count <= 0) return [];

  const bloomFloorIdx = BLOOM_ORDER.indexOf(bloomFloor);
  const eligibleBlooms = bloomFloorIdx >= 0
    ? BLOOM_ORDER.slice(bloomFloorIdx)
    : BLOOM_ORDER; // Unknown floor → allow all

  // #1167 — source filter resolution.
  //
  // PREFERRED (when `playbookId` is provided): resolve sources via
  // `getSourceIdsForPlaybook(playbookId)`. That helper walks
  // `PlaybookSource` first, then the legacy 4-hop fallback. Every modern
  // course (CIO/CTO Standard variants, IELTS, Big Five, Psychology,
  // Persuasion) attaches its Question Banks via PlaybookSource — the
  // path the helper covers.
  //
  // FALLBACK (when `playbookId` is missing): keep the legacy
  // `source: { curricula: { some: { id: curriculumId } } }` filter so
  // existing call sites that haven't been updated yet don't regress to
  // empty pools. The legacy filter only matches sources where
  // `Curriculum.primarySourceId = ContentSource.id` — a small subset of
  // courses in practice — but it's better than nothing for any caller
  // that genuinely has no playbookId in scope.
  const sourceFilter = playbookId
    ? { sourceId: { in: await getSourceIdsForPlaybook(playbookId) } }
    : { source: { curricula: { some: { id: curriculumId } } } };

  // Base filter: eligible assessment use + bloom floor + not recently used
  const baseWhere = {
    ...sourceFilter,
    assessmentUse: { in: RETRIEVAL_ELIGIBLE_USES as any },
    bloomLevel: { in: eligibleBlooms as any },
    ...(recentQuestionIds.length > 0 ? { id: { notIn: recentQuestionIds } } : {}),
    ...(channel === "voice" ? { questionType: { notIn: [...VISUAL_ONLY_TYPES] as any } } : {}),
  };

  // Pass 1: try LO-scoped selection (prefer questions about current outcomes)
  let pool: RetrievalQuestion[] = [];
  if (outcomeRefs.length > 0) {
    pool = await prisma.contentQuestion.findMany({
      where: {
        ...baseWhere,
        learningOutcomeRef: { in: outcomeRefs },
      },
      select: {
        id: true,
        questionText: true,
        questionType: true,
        options: true,
        correctAnswer: true,
        answerExplanation: true,
        learningOutcomeRef: true,
        bloomLevel: true,
        difficulty: true,
      },
    });
  }

  // Pass 2: if LO-scoped pool is too small, widen to full curriculum
  if (pool.length < count) {
    const widerPool = await prisma.contentQuestion.findMany({
      where: baseWhere,
      select: {
        id: true,
        questionText: true,
        questionType: true,
        options: true,
        correctAnswer: true,
        answerExplanation: true,
        learningOutcomeRef: true,
        bloomLevel: true,
        difficulty: true,
      },
    });
    // Merge — LO-scoped first (higher relevance), then wider pool
    const seenIds = new Set(pool.map((q) => q.id));
    for (const q of widerPool) {
      if (!seenIds.has(q.id)) {
        pool.push(q);
        seenIds.add(q.id);
      }
    }
  }

  if (pool.length === 0) return [];

  // Spread by Bloom level — pick one from each level round-robin
  return selectByBloomSpread(pool, count);
}

/**
 * Select questions spread across Bloom taxonomy levels.
 * Picks round-robin from each represented level until count is reached.
 */
function selectByBloomSpread(
  pool: RetrievalQuestion[],
  count: number,
): RetrievalQuestion[] {
  // Group by Bloom level
  const byLevel = new Map<string, RetrievalQuestion[]>();
  for (const q of pool) {
    const level = q.bloomLevel ?? "REMEMBER";
    const list = byLevel.get(level) ?? [];
    list.push(q);
    byLevel.set(level, list);
  }

  // Shuffle within each level for variety
  for (const list of byLevel.values()) {
    shuffleInPlace(list);
  }

  // Round-robin across levels in taxonomy order
  const selected: RetrievalQuestion[] = [];
  const levels = BLOOM_ORDER.filter((l) => byLevel.has(l));
  let levelIdx = 0;
  const consumed = new Map<string, number>();
  for (const l of levels) consumed.set(l, 0);

  while (selected.length < count && levels.length > 0) {
    const level = levels[levelIdx % levels.length];
    const list = byLevel.get(level)!;
    const idx = consumed.get(level) ?? 0;
    if (idx < list.length) {
      selected.push(list[idx]);
      consumed.set(level, idx + 1);
    }
    levelIdx++;
    // Safety: break if we've cycled through all levels with nothing left
    if (levelIdx > count * levels.length) break;
  }

  return selected;
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
