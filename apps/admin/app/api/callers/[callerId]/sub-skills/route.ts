/**
 * @api GET /api/callers/[callerId]/sub-skills
 *
 * Sub-skill cards for the Snapshot v3 tab — #1662 (Epic #1606 Group C
 * Phase 2). Surfaces every non-`skill_*` `CallerTarget` the caller
 * carries, partitioned by `Parameter.domainGroup`, so the educator can
 * see at a glance the trait/coaching/communication scores that sit
 * alongside the skill bands.
 *
 * Decision baked in (from #1662 grooming):
 *   - **Source: `Parameter.domainGroup` direct.** Partition CallerTarget
 *     rows by the joined `Parameter.domainGroup` value. We do NOT read
 *     from AGG-spec `CallerAttribute` outputs (DISC-AGG-001 / COACH-AGG-001
 *     / COMP-AGG-001); the BA flagged that as out-of-scope complexity.
 *   - **Exclude `skill_*` parameters.** Those render in the Skill Bands
 *     section of the Snapshot (and Attainment tab). Sub-skills covers
 *     "everything else with a CallerTarget".
 *   - **Tier mapping via `scoreToTier`.** Same `[0, 1]` range + default
 *     mapping as Skill Bands, so the cold→hot palette is consistent
 *     across surfaces.
 *
 * Auth: VIEWER + path-param scope (`studentAllowedToReadCaller`). STUDENT
 * may read OWN data only; OPERATOR+ may read any caller. Locked per
 * master epic #1577 — Snapshot is STUDENT-readable; sub-skills inherits.
 *
 * Sister of:
 *   - `/api/callers/[callerId]/attainment` (skill bands + modules + goals)
 *   - `/api/callers/[callerId]/lo-mastery` (per-LO drill)
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import {
  studentAllowedToReadCaller,
  callerScopeMismatchResponse,
} from "@/lib/learner-scope";
import { scoreToTier } from "@/lib/goals/track-progress";

export interface SubSkillEntry {
  parameterId: string;
  name: string;
  /** Latest demonstrated score 0..1; null when no scoring evidence yet */
  currentScore: number | null;
  /** Educator's target value */
  targetValue: number;
  /** True when currentScore > targetValue */
  exceedsTarget: boolean;
  /** Resolved tier label ("emerging" / "developing" / "secure"); null when no score */
  tier: string | null;
  /** How many calls fed the score */
  callsUsed: number;
}

export interface SubSkillGroup {
  /** Raw `Parameter.domainGroup` value (e.g. "communication", "empathy", "DISC") */
  domainGroup: string;
  parameters: SubSkillEntry[];
}

export interface SubSkillsResponse {
  ok: boolean;
  callerId: string;
  groups: SubSkillGroup[];
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ callerId: string }> },
): Promise<NextResponse<SubSkillsResponse | { ok: false; error: string }>> {
  const auth = await requireAuth("VIEWER");
  if (isAuthError(auth)) return auth.error;

  const { callerId } = await context.params;
  if (!studentAllowedToReadCaller(auth.session, callerId)) {
    return callerScopeMismatchResponse();
  }

  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { id: true },
  });
  if (!caller) {
    return NextResponse.json(
      { ok: false, error: "Caller not found" },
      { status: 404 },
    );
  }

  const targets = await prisma.callerTarget.findMany({
    where: { callerId },
    select: {
      parameterId: true,
      targetValue: true,
      currentScore: true,
      callsUsed: true,
      parameter: {
        select: { name: true, domainGroup: true, parameterId: true },
      },
    },
  });

  // Group + filter in JS (avoids a complex Prisma where on relation fields).
  const byGroup = new Map<string, SubSkillEntry[]>();
  for (const t of targets) {
    const p = t.parameter;
    if (!p) continue;
    const pid = p.parameterId ?? t.parameterId;
    // Exclude skill-domain parameters — those render in the Skill Bands
    // section (Attainment tab + Snapshot Skill Bands). Sub-skills covers
    // everything else.
    if (pid.startsWith("skill_")) continue;

    const score = t.currentScore;
    const tier =
      score === null ? null : scoreToTier(score).tier.toLowerCase();
    const entry: SubSkillEntry = {
      parameterId: pid,
      name: p.name ?? pid,
      currentScore: score,
      targetValue: t.targetValue,
      exceedsTarget: score !== null && score > t.targetValue,
      tier,
      callsUsed: t.callsUsed,
    };

    const group = p.domainGroup ?? "other";
    const bucket = byGroup.get(group);
    if (bucket) bucket.push(entry);
    else byGroup.set(group, [entry]);
  }

  const groups: SubSkillGroup[] = Array.from(byGroup.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([domainGroup, parameters]) => ({
      domainGroup,
      parameters: parameters.sort((a, b) => a.name.localeCompare(b.name)),
    }));

  return NextResponse.json({ ok: true, callerId, groups });
}
