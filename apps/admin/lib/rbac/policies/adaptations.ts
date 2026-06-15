/**
 * Adaptations response redactor — Wave C3b of the legacy-tab retirement
 * plan. Master epic #1577 kept this surface OPERATOR+ for safety; the
 * redactor restores VIEWER/STUDENT visibility WITHOUT exposing the
 * sensitive payload.
 *
 * **What gets hidden at the `redacted` tier:**
 * - Per-override numeric values (defaultValue, overrideValue) — kept as
 *   a direction-only chip (up/down/hold)
 * - sourceScope (SYSTEM vs PLAYBOOK vs CALLER) — internal cascade layer
 * - confidence + callsApplied — AI-internal rollup metadata
 * - Per-reason rationale text — free-text REWARD-stage logs that may
 *   reveal operator strategy or contain learner-side names
 * - nextAdaptation entirely — forward-planning that would spoil the
 *   learning experience if the learner reads it pre-call
 *
 * **What stays visible at the `redacted` tier:**
 * - Identity (callerId, callerName, playbookId, playbookName)
 * - whatWasAdapted parameter names + adjustment direction
 * - Reason count + most-recent date ("3 adjustments, last on 12 Jun")
 *
 * **Whitelist-default-safe:** if a new field is added to
 * `AdaptationsResponse`, the redactor's `redacted` branch will NOT
 * forward it unless this file is updated. The corresponding vitest
 * pins the absence of the sensitive fields per tier.
 *
 * Sibling to `.claude/rules/ai-to-db-guard.md` (write-side); the
 * pattern is documented at the top of `lib/rbac/visibility.ts`.
 */

import type { VisibilityTier } from "@/lib/rbac/visibility";
import type {
  AdaptationsResponse,
  AdaptationOverride,
  AdaptationReason,
  NextAdaptationGuidanceEntry,
} from "@/app/api/callers/[callerId]/adaptations/route";

/** Redacted shape of `AdaptationOverride` — only parameter identity +
 *  direction survives the redactor. Numeric values + cascade-layer
 *  metadata are stripped.  */
export interface AdaptationOverrideRedacted {
  parameterId: string;
  parameterName: string;
  direction: "up" | "down" | "hold";
  updatedAt: string | null;
}

/** Redacted shape of the `why` array — collapsed to a count + most-recent
 *  timestamp so the learner sees "you've been adapted recently" without
 *  the free-text rationale. */
export interface AdaptationReasonRedacted {
  count: number;
  mostRecentAt: string | null;
}

/** What clients receive at the `redacted` tier. Same identity envelope
 *  as the full response so client navigation doesn't break. */
export interface AdaptationsResponseRedacted {
  callerId: string;
  callerName: string | null;
  playbookId: string | null;
  playbookName: string | null;
  whatWasAdapted: AdaptationOverrideRedacted[];
  whyRedacted: AdaptationReasonRedacted;
  /** Always empty array at the `redacted` tier — kept for client shape
   *  stability so the NextAdaptation section can render its empty
   *  state without conditional chains.  */
  nextAdaptation: never[];
  empty: boolean;
  viewerTier: "redacted";
}

/** What clients receive at the `full` or `diagnostic` tier — the raw
 *  response with the viewerTier discriminator appended. */
export interface AdaptationsResponseFull extends AdaptationsResponse {
  viewerTier: "full" | "diagnostic";
}

export type AdaptationsResponseForViewer =
  | AdaptationsResponseRedacted
  | AdaptationsResponseFull;

function directionFor(o: AdaptationOverride): "up" | "down" | "hold" {
  const delta = o.overrideValue - o.defaultValue;
  if (Math.abs(delta) < 0.005) return "hold";
  return delta > 0 ? "up" : "down";
}

function mostRecentAt(why: AdaptationReason[]): string | null {
  if (why.length === 0) return null;
  // `why` is already sorted descending by REWARD scoredAt in the route,
  // but defensive sort here so a future re-order at the route doesn't
  // silently produce the wrong "most recent" stamp.
  const sorted = [...why].sort((a, b) =>
    a.at < b.at ? 1 : a.at > b.at ? -1 : 0,
  );
  return sorted[0].at;
}

/**
 * Project an `AdaptationsResponse` onto the redacted surface. Pure
 * function — no I/O. Pinned by tests in
 * `tests/lib/rbac/policies/adaptations-redact.test.ts`.
 */
export function redactAdaptationsForTier(
  raw: AdaptationsResponse,
  tier: VisibilityTier,
): AdaptationsResponseForViewer {
  if (tier === "full" || tier === "diagnostic") {
    return { ...raw, viewerTier: tier };
  }

  // `redacted` tier — STUDENT / VIEWER / TESTER. Default-safe: only
  // the whitelisted fields below are forwarded.
  const whatWasAdapted: AdaptationOverrideRedacted[] = raw.whatWasAdapted.map(
    (o) => ({
      parameterId: o.parameterId,
      parameterName: o.parameterName,
      direction: directionFor(o),
      updatedAt: o.updatedAt,
    }),
  );

  const whyRedacted: AdaptationReasonRedacted = {
    count: raw.why.length,
    mostRecentAt: mostRecentAt(raw.why),
  };

  return {
    callerId: raw.callerId,
    callerName: raw.callerName,
    playbookId: raw.playbookId,
    playbookName: raw.playbookName,
    whatWasAdapted,
    whyRedacted,
    nextAdaptation: [] as never[],
    empty: raw.empty,
    viewerTier: "redacted",
  };
}

/**
 * Type guard so the AdaptationsTab client can branch on the redaction
 * envelope without unsafe casts.
 */
export function isRedacted(
  response: AdaptationsResponseForViewer,
): response is AdaptationsResponseRedacted {
  return response.viewerTier === "redacted";
}

/**
 * Same Next.js NextResponse signature as a normal route — the route
 * file uses this as the only return path so callers can't accidentally
 * skip the redactor.
 */
export type { NextAdaptationGuidanceEntry };
