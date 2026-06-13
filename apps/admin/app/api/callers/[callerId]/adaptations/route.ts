/**
 * @api GET /api/callers/[callerId]/adaptations
 *
 * Sprint 5 SP5-A — Adaptations tab shell endpoint. Sister of
 * `/api/callers/[callerId]/attainment` (the per-learner mastery view);
 * Adaptations surfaces what the engine CHANGED for this learner, why
 * those changes were warranted, and what the next call's adaptation
 * will be.
 *
 * SP5-A scope: the SHELL — single-load wrapper that branches into
 * three sections, all returned as empty placeholders. Real data lands
 * in:
 *
 *   - SP5-B "What was adapted" — `CallerTarget` overrides vs PLAYBOOK
 *     default (cascade chips on each override).
 *   - SP5-C "Why" — `RewardScore` rows + `Goal.progressMetrics.progress`
 *     evidence (tier, band, callId, at).
 *   - SP5-D "Next call's adaptation" — `goalAdaptationGuidance`
 *     LOW/MID/HIGH preview.
 *
 * Auth: **OPERATOR+ only.** Locked per master epic #1577 — Adaptations
 * is operator-private; STUDENT can read their OWN attainment but NEVER
 * the change-log. `requireAuth("OPERATOR")` is the structural gate; no
 * path-param scope is needed because STUDENT can't reach this method.
 *
 * Single-load: the response carries the three section envelopes
 * needed for first paint. Real-data sections that grow large will
 * lazy-fetch per section in SP5-B/C/D, mirroring the Attainment
 * pattern (SP4-C's `/lo-mastery` lazy fetch on module-row click).
 */

/* eslint-disable hf-security/no-unscoped-caller-id-route --
 * OPERATOR+ only per master epic #1577 (Adaptations is operator-private,
 * STUDENT may only read their own Attainment). `requireAuth("OPERATOR")`
 * structurally refuses STUDENT/VIEWER at the auth gate, so the
 * studentAllowedToReadCaller path-param guard is moot for this surface.
 */
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getEffectiveBehaviorTargetsForCaller } from "@/lib/tolerance/getEffectiveBehaviorTargetsForCaller";

/** What changed for this learner vs the playbook default. Each row is one
 *  cascade-resolved BEHAVIOR parameter; the UI renders the source-scope
 *  chip (SYSTEM / PLAYBOOK / CALLER) so the educator can see which layer
 *  is currently in effect. SYSTEM-only rows are omitted (those aren't
 *  "adaptations" — they're the unchanged baseline). */
export interface AdaptationOverride {
  parameterId: string;
  parameterName: string;
  /** SYSTEM-scope value (or 0.5 default if no SYSTEM row exists). */
  defaultValue: number;
  /** Cascade-resolved effective value (the winning layer's value). */
  overrideValue: number;
  /** Which cascade layer is currently winning. */
  sourceScope: "SYSTEM" | "PLAYBOOK" | "CALLER";
  /** AI confidence on the CallerTarget override (CALLER-scope only;
   *  null when the winner is PLAYBOOK or SYSTEM). */
  confidence: number | null;
  /** How many scoring calls fed into the CallerTarget rollup
   *  (CALLER-scope only; 0 when the winner is PLAYBOOK or SYSTEM). */
  callsApplied: number;
  /** ISO timestamp of the most recent override write to the winning
   *  layer; null when no override exists (pure SYSTEM baseline). */
  updatedAt: string | null;
}

/** Why the engine adapted — `RewardScore` evidence + `Goal.progressMetrics`
 *  structured progress. SP5-C fills this. */
export interface AdaptationReason {
  callId: string;
  at: string;
  /** Free-text explanation written by the REWARD stage. */
  rationale: string;
  /** Direction the engine pushed: UP / DOWN / HOLD. */
  direction: "up" | "down" | "hold";
  parameterId: string | null;
  parameterName: string | null;
}

/** What the next call's adaptation will be — `goalAdaptationGuidance`
 *  with LOW / MID / HIGH bands. SP5-D fills this. */
export interface NextAdaptationGuidance {
  band: "low" | "mid" | "high";
  summary: string;
  affectedParameterIds: string[];
}

export interface AdaptationsResponse {
  callerId: string;
  callerName: string | null;
  playbookId: string | null;
  playbookName: string | null;
  whatWasAdapted: AdaptationOverride[];
  why: AdaptationReason[];
  nextAdaptation: NextAdaptationGuidance | null;
  /** True when no enrolment + no overrides + no rewards exist. The UI
   *  branches on this for the empty-state copy. */
  empty: boolean;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ callerId: string }> },
) {
  const { callerId } = await params;

  // OPERATOR+ gate. No `studentAllowedToReadCaller` — STUDENT is below
  // OPERATOR and is refused at this line, so per-caller path-param
  // scope is moot.
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { id: true, name: true },
  });
  if (!caller) {
    return NextResponse.json({ error: "Caller not found" }, { status: 404 });
  }

  // Most-recent enrolment is the playbook scope — same convention as
  // attainment + skills-evidence routes.
  const enrolment = await prisma.callerPlaybook.findFirst({
    where: { callerId },
    select: {
      playbookId: true,
      playbook: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!enrolment) {
    return NextResponse.json({
      callerId,
      callerName: caller.name,
      playbookId: null,
      playbookName: null,
      whatWasAdapted: [],
      why: [],
      nextAdaptation: null,
      empty: true,
    } satisfies AdaptationsResponse);
  }

  const playbookId = enrolment.playbookId;

  // ── SP5-B "What was adapted" ─────────────────────────────────────────────
  // Cascade-resolved per-parameter values via the canonical resolver
  // (`getEffectiveBehaviorTargetsForCaller`) so we never drift from the
  // values the COMPOSE stage uses. The resolver returns one entry per
  // parameter touched by ANY layer; we filter to entries where a
  // non-SYSTEM layer is winning — SYSTEM-only rows are the unchanged
  // baseline, not an "adaptation".
  const effectiveTargets = await getEffectiveBehaviorTargetsForCaller(
    playbookId,
    callerId,
  );
  const adaptedEntries = effectiveTargets.filter(
    (e) => e.sourceScope !== "SYSTEM",
  );

  let whatWasAdapted: AdaptationOverride[] = [];
  if (adaptedEntries.length > 0) {
    const parameterIds = adaptedEntries.map((e) => e.parameterId);
    const parameters = await prisma.parameter.findMany({
      where: { parameterId: { in: parameterIds } },
      select: { parameterId: true, name: true },
    });
    const nameByParam = new Map(
      parameters.map((p) => [p.parameterId, p.name]),
    );

    // Pull CallerTarget rows for CALLER-scope winners — gives us the
    // AI-computed confidence + callsUsed + updatedAt that the cascade
    // resolver doesn't carry. PLAYBOOK winners get a separate
    // BehaviorTarget read for updatedAt.
    const callerScopeIds = adaptedEntries
      .filter((e) => e.sourceScope === "CALLER")
      .map((e) => e.parameterId);
    const callerTargets = callerScopeIds.length
      ? await prisma.callerTarget.findMany({
          where: { callerId, parameterId: { in: callerScopeIds } },
          select: {
            parameterId: true,
            confidence: true,
            callsUsed: true,
            updatedAt: true,
          },
        })
      : [];
    const callerTargetByParam = new Map(
      callerTargets.map((t) => [t.parameterId, t]),
    );

    const playbookScopeIds = adaptedEntries
      .filter((e) => e.sourceScope === "PLAYBOOK")
      .map((e) => e.parameterId);
    const playbookTargets = playbookScopeIds.length
      ? await prisma.behaviorTarget.findMany({
          where: {
            scope: "PLAYBOOK",
            playbookId,
            parameterId: { in: playbookScopeIds },
            effectiveUntil: null,
          },
          select: { parameterId: true, updatedAt: true },
        })
      : [];
    const playbookTargetByParam = new Map(
      playbookTargets.map((t) => [t.parameterId, t]),
    );

    whatWasAdapted = adaptedEntries.map((e) => {
      const callerRow = callerTargetByParam.get(e.parameterId);
      const playbookRow = playbookTargetByParam.get(e.parameterId);
      const updatedAt =
        e.sourceScope === "CALLER"
          ? callerRow?.updatedAt.toISOString() ?? null
          : e.sourceScope === "PLAYBOOK"
            ? playbookRow?.updatedAt.toISOString() ?? null
            : null;
      return {
        parameterId: e.parameterId,
        parameterName: nameByParam.get(e.parameterId) ?? e.parameterId,
        defaultValue: e.systemValue ?? 0.5,
        overrideValue: e.effectiveValue,
        sourceScope: e.sourceScope,
        confidence:
          e.sourceScope === "CALLER" ? callerRow?.confidence ?? null : null,
        callsApplied:
          e.sourceScope === "CALLER" ? callerRow?.callsUsed ?? 0 : 0,
        updatedAt,
      };
    });
  }

  return NextResponse.json({
    callerId,
    callerName: caller.name,
    playbookId,
    playbookName: enrolment.playbook?.name ?? null,
    whatWasAdapted,
    why: [],
    nextAdaptation: null,
    empty: whatWasAdapted.length === 0,
  } satisfies AdaptationsResponse);
}
