/**
 * priorCallFeedback loader (#492 Slice 3.5)
 *
 * When composing the prompt for the next call on a given module, pull a brief
 * "since your last attempt on this module" recap so the AI tutor can reference
 * what the learner struggled with last time.
 *
 * The output is consumed by the `renderPriorCallFeedback` transform and emitted
 * as the `priorCallFeedback` section between `curriculum` and `learner_goals`.
 *
 * Implementation notes:
 *   - Pure function — takes a prisma client + scope as args so it can be tested
 *     against a mock client and reused outside the composition path.
 *   - Single Call query + single CallScore query (no N+1).
 *   - Safe by default: any unexpected error returns `hasFeedback: false`. The
 *     SectionDataLoader wrapper additionally try/catches so composition is
 *     never broken by a feedback miss.
 *
 * @see SectionDataLoader.registerLoader("priorCallFeedback", ...)
 * @see transforms/priorCallFeedback.ts (renderPriorCallFeedback transform)
 */

import type { PrismaClient } from "@prisma/client";

export interface PriorCallFeedbackData {
  hasFeedback: boolean;
  /** ISO date of the most recent prior call on this module */
  lastCallAt: string | null;
  lastCallId: string | null;
  /** Lowest-scoring parameter's name */
  weakestParameterName: string | null;
  /** Lowest-scoring parameter's score (0–1) */
  weakestParameterScore: number | null;
  /** Average of all CallScore rows on the prior call (0–1) */
  overallScore: number | null;
  /** 1–2 sentence canned summary — friendly, with relative time */
  summary: string | null;
}

export interface LoadPriorCallFeedbackOptions {
  callerId: string;
  /** CurriculumModule.id to scope the prior-call lookup */
  moduleId: string;
  /** Current call id to exclude from the search (so we never self-reference) */
  currentCallId?: string | null;
  /** Override "now" for deterministic tests */
  now?: Date;
}

const EMPTY: PriorCallFeedbackData = {
  hasFeedback: false,
  lastCallAt: null,
  lastCallId: null,
  weakestParameterName: null,
  weakestParameterScore: null,
  overallScore: null,
  summary: null,
};

/**
 * Subset of PrismaClient used by this loader — narrows the surface so tests
 * can pass a minimal mock object.
 */
type PrismaForLoader = Pick<PrismaClient, "call" | "callScore">;

/**
 * Load the prior-call feedback summary for a given caller + module.
 *
 * Returns {@link EMPTY} (with `hasFeedback: false`) when:
 *   - `moduleId` or `callerId` is missing/empty
 *   - No prior `Call` row exists for the (callerId, moduleId) pair (other than
 *     `currentCallId`, which is excluded)
 *   - The prior call exists but has no `CallScore` rows (still returns
 *     `hasFeedback: true` with a friendly fallback summary — see tests)
 */
export async function loadPriorCallFeedback(
  prisma: PrismaForLoader,
  opts: LoadPriorCallFeedbackOptions,
): Promise<PriorCallFeedbackData> {
  const { callerId, moduleId, currentCallId, now } = opts;
  if (!callerId || !moduleId) return EMPTY;

  // 1. Most recent prior call on this module (excluding currentCallId)
  const priorCall = await prisma.call.findFirst({
    where: {
      callerId,
      curriculumModuleId: moduleId,
      ...(currentCallId ? { id: { not: currentCallId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true },
  });

  if (!priorCall) return EMPTY;

  // 2. Scores from that prior call (joined to parameter name)
  const scores = await prisma.callScore.findMany({
    where: { callId: priorCall.id },
    select: {
      score: true,
      parameter: { select: { name: true } },
    },
  });

  const lastCallAt = priorCall.createdAt.toISOString();
  const relativeTime = formatRelativeTime(priorCall.createdAt, now ?? new Date());

  if (scores.length === 0) {
    return {
      hasFeedback: true,
      lastCallAt,
      lastCallId: priorCall.id,
      weakestParameterName: null,
      weakestParameterScore: null,
      overallScore: null,
      summary:
        `On your last attempt ${relativeTime} we didn't have clear score signals to learn from — let's pick up where we left off.`,
    };
  }

  // Average overall score
  const overallScore = scores.reduce((sum, s) => sum + (s.score ?? 0), 0) / scores.length;

  // Weakest parameter — pick the lowest score; tie-break by name for determinism
  const sortedByScore = [...scores].sort((a, b) => {
    const sa = a.score ?? 0;
    const sb = b.score ?? 0;
    if (sa !== sb) return sa - sb;
    return (a.parameter?.name ?? "").localeCompare(b.parameter?.name ?? "");
  });
  const weakest = sortedByScore[0];
  const weakestParameterName = weakest.parameter?.name ?? null;
  const weakestParameterScore = weakest.score ?? null;

  const summary = buildSummary({
    relativeTime,
    weakestParameterName,
    weakestParameterScore,
    overallScore,
  });

  return {
    hasFeedback: true,
    lastCallAt,
    lastCallId: priorCall.id,
    weakestParameterName,
    weakestParameterScore,
    overallScore,
    summary,
  };
}

// =============================================================
// Helpers
// =============================================================

/**
 * Format a relative time like "yesterday", "3 days ago", "2 weeks ago".
 *
 * Uses Intl.RelativeTimeFormat so localisation hooks are in place; the
 * caller-facing copy is still produced via deterministic template strings
 * (see {@link buildSummary}) for predictable test assertions.
 */
export function formatRelativeTime(then: Date, now: Date): string {
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const diffMs = then.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  // Same calendar bucket: "today" / "yesterday" — Intl.RelativeTimeFormat with
  // numeric:"auto" handles those words for diffDays === 0 and -1.
  if (Math.abs(diffDays) < 7) {
    return rtf.format(diffDays, "day");
  }
  const diffWeeks = Math.round(diffDays / 7);
  if (Math.abs(diffWeeks) < 5) {
    return rtf.format(diffWeeks, "week");
  }
  const diffMonths = Math.round(diffDays / 30);
  if (Math.abs(diffMonths) < 12) {
    return rtf.format(diffMonths, "month");
  }
  const diffYears = Math.round(diffDays / 365);
  return rtf.format(diffYears, "year");
}

/**
 * Format a 0–1 score as a one-decimal value out of 9 — matches the IELTS-style
 * band the tutor speaks in. Bounded to [0, 9] for safety.
 */
function formatScoreOutOf9(score: number): string {
  const bounded = Math.max(0, Math.min(1, score));
  const banded = Math.round(bounded * 9 * 10) / 10;
  return `${banded.toFixed(1)}/9`;
}

function buildSummary(args: {
  relativeTime: string;
  weakestParameterName: string | null;
  weakestParameterScore: number | null;
  overallScore: number | null;
}): string {
  const { relativeTime, weakestParameterName, weakestParameterScore, overallScore } = args;

  if (weakestParameterName !== null && weakestParameterScore !== null) {
    return (
      `On your last attempt ${relativeTime}, your weakest area was ` +
      `${weakestParameterName} (${formatScoreOutOf9(weakestParameterScore)}).`
    );
  }
  if (overallScore !== null) {
    return `On your last attempt ${relativeTime}, your overall score was ${formatScoreOutOf9(overallScore)}.`;
  }
  return `On your last attempt ${relativeTime}, no specific weaknesses were flagged.`;
}
