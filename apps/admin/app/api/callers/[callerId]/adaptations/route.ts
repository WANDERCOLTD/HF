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
 * @tieredVisibility — opt-in for the
 * `hf-rbac/require-tiered-redactor` ESLint rule (Wave C5 of #1685).
 * The rule keeps this route honest about wiring
 * `visibilityTierForRole(...)` + `redactAdaptationsForTier(...)` before
 * returning.
 *
 * **Auth (Wave C3b — #1577 visibility-policy revision):**
 * `requireAuth("VIEWER")` + STUDENT path-param scope via
 * `studentAllowedToReadCaller`. The OPERATOR+ safety property from
 * the original #1577 design is preserved by **server-side response
 * redaction** (`lib/rbac/policies/adaptations.ts::redactAdaptationsForTier`):
 *
 *   - STUDENT / VIEWER / TESTER (tier `redacted`) — see parameter
 *     names + adjustment direction + a reason count. Numeric values,
 *     free-text rationale, and next-call preview are dropped.
 *   - OPERATOR / EDUCATOR / ADMIN (tier `full`) — full payload.
 *   - SUPERADMIN (tier `diagnostic`) — reserved for future debug
 *     fields; functionally same as `full` today.
 *
 * The response always carries a `viewerTier` discriminator so the
 * client knows which shape it received. Adding a new sensitive field
 * means updating the redactor's `redacted` branch — the type system
 * keeps it whitelist-default-safe.
 *
 * Single-load: the response carries the three section envelopes
 * needed for first paint. Real-data sections that grow large will
 * lazy-fetch per section in SP5-B/C/D, mirroring the Attainment
 * pattern (SP4-C's `/lo-mastery` lazy fetch on module-row click).
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import {
  studentAllowedToReadCaller,
  callerScopeMismatchResponse,
} from "@/lib/learner-scope";
import { visibilityTierForRole } from "@/lib/rbac/visibility";
import { redactAdaptationsForTier } from "@/lib/rbac/policies/adaptations";
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

/** Why the engine adapted — one entry per `targetUpdatesApplied` row
 *  inside `RewardScore` (the REWARD stage writes this per call). The
 *  rationale text is whatever the REWARD-stage writer logged on the
 *  update; the direction is derived from `newTarget - oldTarget`. */
export interface AdaptationReason {
  callId: string;
  at: string;
  /** Free-text rationale captured by the REWARD-stage writer. */
  rationale: string;
  /** Direction the engine pushed the target. */
  direction: "up" | "down" | "hold";
  parameterId: string | null;
  parameterName: string | null;
  /** Numeric delta `newTarget - oldTarget`. Null when either side is
   *  missing from the JSON. */
  delta: number | null;
}

/** What the next call's adaptation will be — one preview entry per
 *  top-3 active goal, derived from `goalAdaptationGuidance` in
 *  `lib/prompt/composition/transforms/instructions.ts`. The same band
 *  thresholds (LOW <30% / MID <70% / HIGH ≥70%) the AI will see when
 *  the next call's prompt is composed. */
export interface NextAdaptationGuidanceEntry {
  goalId: string;
  goalName: string;
  goalType: string;
  /** 0–1 current progress on the goal. */
  progress: number;
  /** Derived from `progress` against the LOW/MID/HIGH thresholds. */
  band: "low" | "mid" | "high";
  /** The exact textual guidance that will land in the next prompt. */
  guidance: string;
  isAssessmentTarget: boolean;
}

export interface AdaptationsResponse {
  callerId: string;
  callerName: string | null;
  playbookId: string | null;
  playbookName: string | null;
  whatWasAdapted: AdaptationOverride[];
  why: AdaptationReason[];
  nextAdaptation: NextAdaptationGuidanceEntry[];
  /** True when no enrolment + no overrides + no rewards exist. The UI
   *  branches on this for the empty-state copy. */
  empty: boolean;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ callerId: string }> },
) {
  const { callerId } = await params;

  // Wave C3b — VIEWER+ gate with STUDENT path-param scope. The
  // OPERATOR+ safety property is preserved via response redaction
  // (see header), not by the auth gate. STUDENT is admitted here so
  // their own adaptation summary is visible; the redactor strips the
  // sensitive fields before the response leaves the route.
  const auth = await requireAuth("VIEWER");
  if (isAuthError(auth)) return auth.error;

  if (!studentAllowedToReadCaller(auth.session, callerId)) {
    return callerScopeMismatchResponse();
  }

  const viewerTier = visibilityTierForRole(auth.session.user.role);

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
    const rawEmpty: AdaptationsResponse = {
      callerId,
      callerName: caller.name,
      playbookId: null,
      playbookName: null,
      whatWasAdapted: [],
      why: [],
      nextAdaptation: [],
      empty: true,
    };
    return NextResponse.json(redactAdaptationsForTier(rawEmpty, viewerTier));
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

  // ── SP5-C "Why" ─────────────────────────────────────────────────────────
  // Walk the most recent N calls with RewardScore.targetUpdatesApplied
  // populated; each update row produces one AdaptationReason entry.
  // Bounded fetch keeps the read O(N callers × constant) — no per-row N+1.
  const recentRewards = await prisma.rewardScore.findMany({
    where: {
      call: { callerId, playbookId },
      NOT: { targetUpdatesApplied: { equals: null as never } },
    },
    select: {
      callId: true,
      scoredAt: true,
      targetUpdatesApplied: true,
    },
    orderBy: { scoredAt: "desc" },
    take: REWARD_LOOKBACK,
  });

  const reasonParamIds = new Set<string>();
  for (const r of recentRewards) {
    const updates = parseTargetUpdates(r.targetUpdatesApplied);
    for (const u of updates) {
      if (u.parameterId) reasonParamIds.add(u.parameterId);
    }
  }
  const reasonParamNames = reasonParamIds.size
    ? await prisma.parameter.findMany({
        where: { parameterId: { in: [...reasonParamIds] } },
        select: { parameterId: true, name: true },
      })
    : [];
  const reasonNameByParam = new Map(
    reasonParamNames.map((p) => [p.parameterId, p.name]),
  );

  const why: AdaptationReason[] = [];
  for (const r of recentRewards) {
    const updates = parseTargetUpdates(r.targetUpdatesApplied);
    for (const u of updates) {
      const delta =
        typeof u.oldTarget === "number" && typeof u.newTarget === "number"
          ? u.newTarget - u.oldTarget
          : null;
      const direction: "up" | "down" | "hold" =
        delta == null || Math.abs(delta) < 0.005
          ? "hold"
          : delta > 0
            ? "up"
            : "down";
      why.push({
        callId: r.callId,
        at: r.scoredAt.toISOString(),
        rationale: u.reason ?? "(no rationale logged)",
        direction,
        parameterId: u.parameterId,
        parameterName: u.parameterId
          ? reasonNameByParam.get(u.parameterId) ?? u.parameterId
          : null,
        delta,
      });
    }
  }
  const whyTrimmed = why.slice(0, REWARD_REASONS_MAX);

  // ── SP5-D "Next call's adaptation" ──────────────────────────────────────
  // Preview the same bracket-derived guidance the AI will see when the next
  // prompt is composed (replicates the LOW/MID/HIGH logic in
  // `lib/prompt/composition/transforms/instructions.ts::goalAdaptationGuidance`
  // — small table, low drift risk; ESM import would couple this read route
  // to the composition layer for a one-time copy of 6 UX strings).
  const topGoals = await prisma.goal.findMany({
    where: { callerId, playbookId, status: { in: ["ACTIVE", "PAUSED"] } },
    select: {
      id: true,
      name: true,
      type: true,
      progress: true,
      isAssessmentTarget: true,
    },
    orderBy: [{ priority: "desc" }, { name: "asc" }],
    take: 3,
  });

  const nextAdaptation: NextAdaptationGuidanceEntry[] = topGoals.map((g) => {
    const band: "low" | "mid" | "high" =
      g.progress < 0.3 ? "low" : g.progress < 0.7 ? "mid" : "high";
    const bracketIndex = band === "low" ? 0 : band === "mid" ? 1 : 2;
    const guidance =
      (GOAL_ADAPTATION[g.type] ?? GOAL_ADAPTATION.LEARN)[bracketIndex];
    return {
      goalId: g.id,
      goalName: g.name,
      goalType: g.type,
      progress: g.progress,
      band,
      guidance,
      isAssessmentTarget: g.isAssessmentTarget,
    };
  });

  const raw: AdaptationsResponse = {
    callerId,
    callerName: caller.name,
    playbookId,
    playbookName: enrolment.playbook?.name ?? null,
    whatWasAdapted,
    why: whyTrimmed,
    nextAdaptation,
    empty:
      whatWasAdapted.length === 0 &&
      whyTrimmed.length === 0 &&
      nextAdaptation.length === 0,
  };
  return NextResponse.json(redactAdaptationsForTier(raw, viewerTier));
}

/**
 * Mirror of `GOAL_ADAPTATION` in
 * `lib/prompt/composition/transforms/instructions.ts`. **Canonical
 * source is the composition transform** — that is the one the AI
 * actually sees. This route renders a preview using the same table so
 * the educator sees what the AI WILL see on the next call's prompt.
 *
 * If the canonical table changes, update this mirror in the same PR
 * (search both paths). The drift surface is tiny (6 rows of UX copy)
 * so a structural import is overkill.
 */
const GOAL_ADAPTATION: Record<string, [low: string, mid: string, high: string]> = {
  LEARN: [
    "Introduce concepts gently, check understanding frequently",
    "Build on prior foundations, connect to what they already know",
    "Challenge with application, prepare for mastery",
  ],
  ACHIEVE: [
    "Clarify what success looks like, break into steps",
    "Track milestones, celebrate progress",
    "Focus on final steps, anticipate obstacles",
  ],
  CHANGE: [
    "Explore motivation, validate feelings",
    "Practice new behaviours, reflect on changes",
    "Reinforce new habits, plan sustainability",
  ],
  CONNECT: [
    "Build trust, find common ground",
    "Deepen relationship, share openly",
    "Maintain connection, mutual exchange",
  ],
  SUPPORT: [
    "Listen actively, understand needs",
    "Provide targeted support, check coping",
    "Evaluate effectiveness, plan independence",
  ],
  CREATE: [
    "Brainstorm freely, no judgment",
    "Iterate and refine, give constructive feedback",
    "Polish and finish, celebrate creation",
  ],
};

/** Most-recent N RewardScore rows scanned for `targetUpdatesApplied`. */
const REWARD_LOOKBACK = 12;
/** Max reason entries returned to the UI (some calls have multiple updates). */
const REWARD_REASONS_MAX = 30;

interface TargetUpdate {
  parameterId: string | null;
  oldTarget: number | null;
  newTarget: number | null;
  reason: string | null;
}

function parseTargetUpdates(value: unknown): TargetUpdate[] {
  if (!Array.isArray(value)) return [];
  const out: TargetUpdate[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    out.push({
      parameterId:
        typeof e.parameterId === "string" ? e.parameterId : null,
      oldTarget: typeof e.oldTarget === "number" ? e.oldTarget : null,
      newTarget: typeof e.newTarget === "number" ? e.newTarget : null,
      reason: typeof e.reason === "string" ? e.reason : null,
    });
  }
  return out;
}
