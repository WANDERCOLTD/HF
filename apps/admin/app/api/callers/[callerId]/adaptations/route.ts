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

/** What changed for this learner vs the playbook default. SP5-B fills
 *  this with `CallerTarget` rows joined to `Parameter` so the UI can
 *  render the override + the cascade chip (system / playbook / caller). */
export interface AdaptationOverride {
  parameterId: string;
  parameterName: string;
  defaultValue: number;
  overrideValue: number;
  confidence: number | null;
  callsApplied: number;
  /** ISO timestamp of the most recent override write. */
  updatedAt: string;
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

  // SP5-A is the shell — real data writers (SP5-B/C/D) will replace
  // these placeholders. We still walk one cheap query (CallerTarget
  // count) so the UI can render an accurate "no adaptations yet"
  // empty-state rather than misleadingly claiming the section is
  // ready-but-empty.
  const overrideCount = await prisma.callerTarget.count({
    where: { callerId },
  });

  return NextResponse.json({
    callerId,
    callerName: caller.name,
    playbookId: enrolment.playbookId,
    playbookName: enrolment.playbook?.name ?? null,
    whatWasAdapted: [],
    why: [],
    nextAdaptation: null,
    empty: overrideCount === 0,
  } satisfies AdaptationsResponse);
}
