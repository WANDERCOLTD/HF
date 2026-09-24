/**
 * Uplift response redactor — #1922 (epic #1915, §6a I-PR7).
 *
 * Strips operator-only fields from `/api/callers/[callerId]/uplift`
 * for STUDENT / VIEWER / TESTER tier.
 *
 * **What gets hidden at the `redacted` tier:**
 * - `scoreTrends[].scores[].confidence` — per-score AI confidence
 * - `adaptationEvidence[].confidence` — adaptation confidence
 * - `trustScores[].hasLearnerEvidence` — Wave C3 / #566 evidence signal,
 *   operator-facing forensic
 *
 * **What stays visible at the `redacted` tier:**
 * - All identity + engagement fields (totalCalls, callDates, momentum,
 *   memoryCounts, topTopics, moduleProgress)
 * - scoreTrends WITHOUT per-score confidence
 * - adaptationEvidence WITHOUT confidence (parameterName, delta still
 *   visible — STUDENT can see what's been adapted, just not the
 *   internal confidence)
 * - trustScores WITHOUT hasLearnerEvidence
 *
 * The route currently returns inline types (no exported interfaces),
 * so this redactor takes the response object structurally.
 */

import type { VisibilityTier } from "@/lib/rbac/visibility";

/** Structural type — matches the `NextResponse.json` body the route returns. */
export interface UpliftResponseInput {
  ok: boolean;
  uplift: {
    confidencePre: number | null;
    confidencePost: number | null;
    confidenceDelta: number | null;
    testScorePre: number | null;
    testScorePost: number | null;
    knowledgeDelta: number | null;
    overallMastery: number | null;
    totalCalls: number;
    firstCallAt: string | null;
    latestCallAt: string | null;
    timeOnPlatformDays: number;
    moduleProgress: Array<Record<string, unknown>>;
    goals: Array<Record<string, unknown>>;
    scoreTrends: Array<{
      parameterId: string;
      scores: Array<{
        callDate: string;
        score: number;
        confidence: number;
      }>;
    }>;
    adaptationEvidence: Array<{
      parameterName: string;
      parameterType: string | null;
      sectionId: string | null;
      definition: string | null;
      defaultValue: number;
      currentValue: number;
      delta: number;
      callsUsed: number;
      confidence: number;
    }>;
    memoryCounts: Record<string, number>;
    topTopics: Array<{ topic: string; lastMentioned?: string }>;
    trustScores: Array<{
      callId: string;
      score: number;
      hasLearnerEvidence: boolean | null;
    }>;
    trustCalls: Array<Record<string, unknown>>;
    callFrequencyPerWeek: number;
    callDates: string[];
  };
}

export interface UpliftResponseRedacted {
  ok: boolean;
  uplift: Omit<
    UpliftResponseInput["uplift"],
    "scoreTrends" | "adaptationEvidence" | "trustScores"
  > & {
    scoreTrends: Array<{
      parameterId: string;
      scores: Array<{
        callDate: string;
        score: number;
      }>;
    }>;
    adaptationEvidence: Array<{
      parameterName: string;
      parameterType: string | null;
      sectionId: string | null;
      definition: string | null;
      defaultValue: number;
      currentValue: number;
      delta: number;
      callsUsed: number;
    }>;
    trustScores: Array<{
      callId: string;
      score: number;
    }>;
  };
  viewerTier: "redacted";
}

export interface UpliftResponseFull extends UpliftResponseInput {
  viewerTier: "full" | "diagnostic";
}

export type UpliftResponseForViewer =
  | UpliftResponseRedacted
  | UpliftResponseFull;

export function redactUpliftForTier(
  raw: UpliftResponseInput,
  tier: VisibilityTier,
): UpliftResponseForViewer {
  if (tier === "full" || tier === "diagnostic") {
    return { ...raw, viewerTier: tier };
  }
  return {
    ok: raw.ok,
    uplift: {
      confidencePre: raw.uplift.confidencePre,
      confidencePost: raw.uplift.confidencePost,
      confidenceDelta: raw.uplift.confidenceDelta,
      testScorePre: raw.uplift.testScorePre,
      testScorePost: raw.uplift.testScorePost,
      knowledgeDelta: raw.uplift.knowledgeDelta,
      overallMastery: raw.uplift.overallMastery,
      totalCalls: raw.uplift.totalCalls,
      firstCallAt: raw.uplift.firstCallAt,
      latestCallAt: raw.uplift.latestCallAt,
      timeOnPlatformDays: raw.uplift.timeOnPlatformDays,
      moduleProgress: raw.uplift.moduleProgress,
      goals: raw.uplift.goals,
      scoreTrends: raw.uplift.scoreTrends.map((t) => ({
        parameterId: t.parameterId,
        scores: t.scores.map((s) => ({
          callDate: s.callDate,
          score: s.score,
        })),
      })),
      adaptationEvidence: raw.uplift.adaptationEvidence.map((a) => ({
        parameterName: a.parameterName,
        parameterType: a.parameterType,
        sectionId: a.sectionId,
        definition: a.definition,
        defaultValue: a.defaultValue,
        currentValue: a.currentValue,
        delta: a.delta,
        callsUsed: a.callsUsed,
      })),
      memoryCounts: raw.uplift.memoryCounts,
      topTopics: raw.uplift.topTopics,
      trustScores: raw.uplift.trustScores.map((t) => ({
        callId: t.callId,
        score: t.score,
      })),
      trustCalls: raw.uplift.trustCalls,
      callFrequencyPerWeek: raw.uplift.callFrequencyPerWeek,
      callDates: raw.uplift.callDates,
    },
    viewerTier: "redacted",
  };
}
