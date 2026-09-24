/**
 * Insights response redactor — #1922 (epic #1915, §6a I-PR7).
 *
 * Strips operator-only fields from `/api/callers/[callerId]/insights`
 * for STUDENT / VIEWER / TESTER tier.
 *
 * **What gets hidden at the `redacted` tier (per FocusAreaEntry):**
 * - `recommendation` — AI tutor's internal next-step rationale
 * - `reason` — free-text explanation of why this module is flagged
 *
 * **What stays visible at the `redacted` tier:**
 * - Identity envelope (callerId, momentum, callStreak, lastCallDaysAgo,
 *   totalCalls)
 * - Achievements (already learner-facing — surfaced as gamification)
 * - FocusArea identity: `type`, `moduleId`, `moduleName`, `mastery`
 *   (the score is shown elsewhere via the lo-mastery redactor — keeping
 *   it here lets a STUDENT see "you've got 40% on Module A" without
 *   the tutor's full rationale).
 */

import type { VisibilityTier } from "@/lib/rbac/visibility";
import type {
  CallerInsightsResponse,
  FocusAreaEntry,
} from "@/app/api/callers/[callerId]/insights/route";

export interface FocusAreaEntryRedacted {
  type: FocusAreaEntry["type"];
  moduleId: string;
  moduleName: string;
  mastery: number;
}

export interface CallerInsightsResponseRedacted {
  ok: boolean;
  callerId: string;
  momentum: CallerInsightsResponse["momentum"];
  callStreak: number;
  lastCallDaysAgo: number | null;
  totalCalls: number;
  focusAreas: FocusAreaEntryRedacted[];
  achievements: CallerInsightsResponse["achievements"];
  viewerTier: "redacted";
}

export interface CallerInsightsResponseFull extends CallerInsightsResponse {
  viewerTier: "full" | "diagnostic";
}

export type CallerInsightsResponseForViewer =
  | CallerInsightsResponseRedacted
  | CallerInsightsResponseFull;

function redactFocusArea(f: FocusAreaEntry): FocusAreaEntryRedacted {
  return {
    type: f.type,
    moduleId: f.moduleId,
    moduleName: f.moduleName,
    mastery: f.mastery,
  };
}

export function redactInsightsForTier(
  raw: CallerInsightsResponse,
  tier: VisibilityTier,
): CallerInsightsResponseForViewer {
  if (tier === "full" || tier === "diagnostic") {
    return { ...raw, viewerTier: tier };
  }
  return {
    ok: raw.ok,
    callerId: raw.callerId,
    momentum: raw.momentum,
    callStreak: raw.callStreak,
    lastCallDaysAgo: raw.lastCallDaysAgo,
    totalCalls: raw.totalCalls,
    focusAreas: raw.focusAreas.map(redactFocusArea),
    achievements: raw.achievements,
    viewerTier: "redacted",
  };
}
