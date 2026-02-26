/**
 * Shared pure functions for caller insights — used by both list (roster) and detail (lens) views.
 * No React, no hooks — plain TypeScript.
 */

// ─── Types ─────────────────────────────────────────────────────

export type Momentum = "accelerating" | "steady" | "slowing" | "new";

export type TriageCategory = "attention" | "advancing" | "active" | "inactive" | "new";

// ─── Thresholds ────────────────────────────────────────────────

export const MASTERY_THRESHOLD = 0.75;
export const ADVANCE_THRESHOLD = 0.80;
export const ATTENTION_THRESHOLD = 0.45;
export const INACTIVE_DAYS = 7;

// ─── Momentum ──────────────────────────────────────────────────

/**
 * Compute engagement momentum from call dates.
 * Compares avg gap of recent 5 calls vs previous 5 calls.
 * Tighter gaps = accelerating, wider gaps = slowing.
 */
export function computeMomentum(callDates: (string | Date)[]): Momentum {
  if (!callDates || callDates.length < 3) return "new";

  const sorted = [...callDates]
    .map((d) => new Date(d).getTime())
    .sort((a, b) => b - a); // newest first

  if (sorted.length < 5) return "steady";

  const recent = sorted.slice(0, Math.min(5, sorted.length));
  const older = sorted.slice(Math.min(5, sorted.length), Math.min(10, sorted.length));

  if (older.length === 0) return "steady";

  const avgGap = (arr: number[]) => {
    if (arr.length < 2) return Infinity;
    let totalGap = 0;
    for (let i = 1; i < arr.length; i++) {
      totalGap += arr[i - 1] - arr[i];
    }
    return totalGap / (arr.length - 1);
  };

  const recentGap = avgGap(recent);
  const olderGap = avgGap(older);

  if (recentGap < olderGap * 0.7) return "accelerating";
  if (recentGap > olderGap * 1.5) return "slowing";
  return "steady";
}

// ─── Call Streak ────────────────────────────────────────────────

/**
 * Count consecutive days with calls (allows 2-day gaps for weekends).
 */
export function computeCallStreak(callDates: (string | Date)[]): number {
  if (!callDates || callDates.length === 0) return 0;

  const sorted = [...callDates]
    .map((d) => new Date(d).getTime())
    .sort((a, b) => b - a); // newest first

  let streak = 1;
  for (let i = 1; i < sorted.length; i++) {
    const daysDiff = Math.floor((sorted[i - 1] - sorted[i]) / (1000 * 60 * 60 * 24));
    if (daysDiff <= 2) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

// ─── Triage ────────────────────────────────────────────────────

/**
 * Determine triage category for a caller.
 * Used for filter pills and section grouping.
 */
export function computeTriage(
  mastery: number | null,
  momentum: Momentum,
  lastCallDaysAgo: number | null,
  totalCalls: number
): TriageCategory {
  // Never called
  if (totalCalls === 0) return "new";

  // Inactive: 7+ days since last call
  if (lastCallDaysAgo !== null && lastCallDaysAgo >= INACTIVE_DAYS) return "inactive";

  // Needs attention: low mastery OR slowing momentum
  if (
    (mastery !== null && mastery < ATTENTION_THRESHOLD) ||
    momentum === "slowing"
  ) {
    return "attention";
  }

  // Ready to advance: high mastery AND good momentum
  if (mastery !== null && mastery >= ADVANCE_THRESHOLD && momentum !== "slowing") {
    return "advancing";
  }

  return "active";
}

// ─── Days Ago ──────────────────────────────────────────────────

/**
 * Compute days since a date, or null if no date.
 */
export function daysAgo(date: string | Date | null): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
}

// ─── Diagnostic ────────────────────────────────────────────────

/**
 * Compute a short one-line diagnostic for a caller.
 * Used as the subtitle in roster rows.
 */
export function computeDiagnostic(
  triage: TriageCategory,
  mastery: number | null,
  momentum: Momentum,
  totalCalls: number,
  lastCallDaysAgo: number | null
): string {
  if (totalCalls === 0) return "Not started";

  switch (triage) {
    case "attention":
      if (mastery !== null && mastery < ATTENTION_THRESHOLD) {
        return momentum === "slowing" ? "Struggling · slowing down" : "Needs more practice";
      }
      return "Engagement declining";

    case "advancing":
      return "Ready to advance";

    case "inactive":
      return lastCallDaysAgo !== null ? `Inactive ${lastCallDaysAgo}d` : "Inactive";

    case "new":
      return "Not started";

    case "active":
      if (momentum === "accelerating") return "On track · accelerating";
      return "On track";
  }
}

// ─── Triage Sort Order ─────────────────────────────────────────

const TRIAGE_ORDER: Record<TriageCategory, number> = {
  attention: 0,
  advancing: 1,
  active: 2,
  inactive: 3,
  new: 4,
};

/**
 * Sort rank for triage categories.
 * Attention first, then advancing, active, inactive, new.
 */
export function triageSortRank(category: TriageCategory): number {
  return TRIAGE_ORDER[category];
}
