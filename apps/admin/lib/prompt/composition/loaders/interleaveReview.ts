/**
 * interleaveReview loader (#492 E3 Slice 3.3)
 *
 * Implements the **spaced-review nudge** half of the interleaving strategy.
 * Without this, modules the learner has mastered effectively vanish from the
 * picker recommendation flow and are never refreshed — research on spaced
 * retrieval shows that even a brief review check-in dramatically improves
 * long-term retention.
 *
 * Why a composer-only nudge (Path A) rather than a picker switch (Path B):
 *   - Picker semantics stay predictable for the rest of the codebase that
 *     reads `recommendNextModule()`. We do NOT divert the learner into a
 *     mastered module wholesale.
 *   - The tutor sees a soft cue ("Consider a brief review check-in") and can
 *     decide whether to weave it into the conversation. The block is a hint,
 *     not a directive.
 *
 * Selection algorithm (see {@link loadInterleaveReview}):
 *   1. Load every `CallerModuleProgress` for this caller with `status="COMPLETED"`
 *      (excluding `currentModuleId`).
 *   2. Throttle: require ≥ 2 mastered modules. With 0 or 1 mastered there is
 *      nothing meaningful to interleave with — emit nothing.
 *   3. For each candidate, look up the latest `Call` for `(callerId, moduleId)`
 *      to get `lastCallAt`.
 *   4. Filter to modules where `(now - lastCallAt).days >= minDays`
 *      (default 3, configurable via `playbookConfig.interleaveReviewMinDays`).
 *   5. Pick the candidate with the OLDEST `lastCallAt` (stalest first).
 *   6. Build a short tutor-facing summary referencing title + day count.
 *
 * Safety:
 *   - All failure paths return the empty shape. The SectionDataLoader wrapper
 *     additionally try/catches so a slow/broken progress row never breaks
 *     composition.
 *   - Excludes `currentModuleId` from candidates — the active module is
 *     trivially "not stale" and isn't a review opportunity.
 *   - When `currentModuleId === null` (no active module) → `hasReview: false`.
 *     The nudge only makes sense alongside an active module.
 *
 * Wire-up:
 *   - dataSource : "interleaveReview"
 *   - transform  : "renderInterleaveReview"
 *   - outputKey  : "interleaveReview"
 *   - activation : "interleaveReviewExists" (hasReview === true)
 *   - fallback   : { action: "omit" }
 *
 * @see transforms/interleaveReview.ts (renderer)
 * @see CompositionExecutor.ts (section registration, activation branch)
 */

import type { PrismaClient } from "@prisma/client";
import type { PlaybookConfig } from "@/lib/types/json-fields";

export interface InterleaveReviewData {
  hasReview: boolean;
  candidateModule: { id: string; slug: string; title: string } | null;
  daysSinceLastCall: number | null;
  mastery: number | null;
  summary: string | null;
}

export interface LoadInterleaveReviewOptions {
  callerId: string;
  /** The CurriculumModule.id of the active module for this call. Required —
   *  when null the nudge is suppressed (nothing to pair the review with). */
  currentModuleId: string | null;
  /** Playbook config — read defensively for `interleaveReviewMinDays`. */
  playbookConfig: PlaybookConfig | null | undefined;
  /** Override "now" for deterministic tests. */
  now?: Date;
}

const EMPTY: InterleaveReviewData = {
  hasReview: false,
  candidateModule: null,
  daysSinceLastCall: null,
  mastery: null,
  summary: null,
};

/** Default freshness threshold — modules called within this many days are NOT stale. */
const DEFAULT_MIN_DAYS = 3;

/** Floor count of mastered modules before an interleave nudge makes sense. */
const MIN_MASTERED_FOR_REVIEW = 2;

/**
 * Subset of PrismaClient used by this loader — narrows the surface so tests
 * can pass a minimal mock object.
 */
type PrismaForLoader = Pick<
  PrismaClient,
  "callerModuleProgress" | "call" | "curriculumModule"
>;

/**
 * Read `playbookConfig.interleaveReviewMinDays`, falling back to
 * {@link DEFAULT_MIN_DAYS}. Defensive: ignores non-finite / negative values
 * and any non-object playbookConfig.
 */
function readMinDays(playbookConfig: PlaybookConfig | null | undefined): number {
  if (!playbookConfig || typeof playbookConfig !== "object") return DEFAULT_MIN_DAYS;
  const raw = (playbookConfig as Record<string, unknown>).interleaveReviewMinDays;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return DEFAULT_MIN_DAYS;
  return raw;
}

/**
 * Load a single stale mastered-module review opportunity for `callerId`.
 *
 * Returns {@link EMPTY} (with `hasReview: false`) when:
 *   - `callerId` is empty
 *   - `currentModuleId` is null
 *   - Fewer than {@link MIN_MASTERED_FOR_REVIEW} mastered modules exist
 *   - No mastered module has been silent for ≥ `minDays`
 */
export async function loadInterleaveReview(
  prisma: PrismaForLoader,
  opts: LoadInterleaveReviewOptions,
): Promise<InterleaveReviewData> {
  const { callerId, currentModuleId, playbookConfig, now } = opts;
  if (!callerId) return EMPTY;
  // Throttle: the nudge only makes sense when there's an active module to
  // pair the review with.
  if (!currentModuleId) return EMPTY;

  // 1. Load every COMPLETED progress row for this caller, excluding the
  // current module. The exclusion happens in the DB query rather than
  // post-filter so the result-set stays small even with many mastered
  // modules. NOT_STARTED / IN_PROGRESS rows are not interleave candidates.
  const completedRows = await prisma.callerModuleProgress.findMany({
    where: {
      callerId,
      status: "COMPLETED",
      moduleId: { not: currentModuleId },
    },
    select: {
      moduleId: true,
      mastery: true,
      lastCallId: true,
    },
  });

  // Throttle: need ≥ 2 mastered modules for interleave to make sense. With 0
  // or 1, there's nothing meaningfully different from "just keep going".
  if (completedRows.length < MIN_MASTERED_FOR_REVIEW) return EMPTY;

  const candidateModuleIds = completedRows.map((r) => r.moduleId);

  // 2. Resolve last-call timestamps in a single query — group by moduleId,
  // take the latest createdAt per module. Prisma doesn't support windowed
  // SELECTs cleanly, so we fetch the relevant calls and reduce in JS. The
  // candidate set is already capped by the COMPLETED filter so the result
  // is bounded.
  const calls = await prisma.call.findMany({
    where: {
      callerId,
      curriculumModuleId: { in: candidateModuleIds },
    },
    select: { curriculumModuleId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const latestByModule = new Map<string, Date>();
  for (const c of calls) {
    if (!c.curriculumModuleId) continue;
    if (!latestByModule.has(c.curriculumModuleId)) {
      latestByModule.set(c.curriculumModuleId, c.createdAt);
    }
  }

  // 3. Filter to stale candidates (lastCallAt older than threshold).
  const minDays = readMinDays(playbookConfig);
  const nowDate = now ?? new Date();
  const nowMs = nowDate.getTime();

  interface StaleCandidate {
    moduleId: string;
    mastery: number;
    lastCallAt: Date;
    daysSinceLastCall: number;
  }
  const stale: StaleCandidate[] = [];

  for (const row of completedRows) {
    const lastCallAt = latestByModule.get(row.moduleId);
    if (!lastCallAt) continue; // No call history → skip (shouldn't happen for COMPLETED, but defensive).
    const daysSinceLastCall = Math.floor((nowMs - lastCallAt.getTime()) / 86_400_000);
    if (daysSinceLastCall < minDays) continue;
    stale.push({
      moduleId: row.moduleId,
      mastery: row.mastery,
      lastCallAt,
      daysSinceLastCall,
    });
  }

  if (stale.length === 0) return EMPTY;

  // 4. Pick the OLDEST lastCallAt — i.e. the module most starved of review.
  // Tie-break by moduleId for determinism (alphabetic — keeps tests stable).
  stale.sort((a, b) => {
    const diff = a.lastCallAt.getTime() - b.lastCallAt.getTime();
    if (diff !== 0) return diff;
    return a.moduleId.localeCompare(b.moduleId);
  });
  const chosen = stale[0];

  // 5. Resolve module title (single row).
  const moduleRow = await prisma.curriculumModule.findUnique({
    where: { id: chosen.moduleId },
    select: { id: true, slug: true, title: true },
  });

  // If the module was deleted between the progress query and now (very
  // unusual), drop the section rather than emit a broken reference.
  if (!moduleRow) return EMPTY;

  const summary = buildSummary({
    title: moduleRow.title,
    daysSinceLastCall: chosen.daysSinceLastCall,
  });

  return {
    hasReview: true,
    candidateModule: {
      id: moduleRow.id,
      slug: moduleRow.slug,
      title: moduleRow.title,
    },
    daysSinceLastCall: chosen.daysSinceLastCall,
    mastery: chosen.mastery,
    summary,
  };
}

// =============================================================
// Helpers
// =============================================================

/**
 * Tutor-facing summary. Deliberately a NUDGE, not a directive — the tutor
 * decides whether to weave it in. Format follows the slice 3.3 contract:
 *
 *   "It's been {N} days since the learner last practised {title}.
 *    Consider a brief review check-in."
 *
 * Singular/plural day-count for natural reading.
 */
export function buildSummary(args: {
  title: string;
  daysSinceLastCall: number;
}): string {
  const { title, daysSinceLastCall } = args;
  const days = daysSinceLastCall === 1 ? "1 day" : `${daysSinceLastCall} days`;
  return (
    `It's been ${days} since the learner last practised ${title}. ` +
    `Consider a brief review check-in.`
  );
}
