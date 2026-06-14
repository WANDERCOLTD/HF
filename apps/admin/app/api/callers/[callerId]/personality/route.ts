/**
 * @api GET /api/callers/[callerId]/personality
 *
 * "Who we think they are" data for the Snapshot v3 tab — #1665 (Epic
 * #1606 Group C Phase 3, folded A.7).
 *
 * Returns the caller's `CallerPersonalityProfile.parameterValues` joined
 * to each Parameter's `name` + `domainGroup` so the UI can label and
 * group rows without a second round-trip.
 *
 * **Decision 5 (from Group C grooming): interpretation strings stay
 * OPERATOR-only.** This route deliberately does NOT return
 * `Parameter.interpretationHigh` / `interpretationLow`. The
 * cross-cutting OPERATOR-only chip sweep ships in #1664.
 *
 * Auth: VIEWER + path-param scope (`studentAllowedToReadCaller`).
 * STUDENT may read OWN data only; OPERATOR+ may read any caller. Same
 * STUDENT-readable contract as the rest of the Snapshot tab routes
 * (`/attainment`, `/lo-mastery`, `/skills-evidence`, `/sub-skills`,
 * `/scheduler-decision`).
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import {
  studentAllowedToReadCaller,
  callerScopeMismatchResponse,
} from "@/lib/learner-scope";

export interface PersonalityParameterEntry {
  parameterId: string;
  /** Human-readable name from Parameter.name. Falls back to the
   *  parameterId when the join misses (parameter deleted but value
   *  still in the JSON). */
  name: string;
  /** Free-form domainGroup from Parameter; "other" when null. */
  domainGroup: string;
  /** Raw value from CallerPersonalityProfile.parameterValues (typically
   *  0..1; some legacy parameters use other ranges, so the UI shouldn't
   *  assume the range). */
  value: number;
}

export interface PersonalityResponse {
  ok: boolean;
  callerId: string;
  /** Null when the profile row doesn't exist yet (e.g. brand-new caller). */
  profile: {
    parameters: PersonalityParameterEntry[];
    lastUpdatedAt: string | null;
    callsUsed: number;
    specsUsed: number;
  } | null;
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ callerId: string }> },
): Promise<NextResponse<PersonalityResponse | { ok: false; error: string }>> {
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

  const profile = await prisma.callerPersonalityProfile.findUnique({
    where: { callerId },
    select: {
      parameterValues: true,
      lastUpdatedAt: true,
      callsUsed: true,
      specsUsed: true,
    },
  });

  if (!profile) {
    return NextResponse.json({ ok: true, callerId, profile: null });
  }

  const valuesObj = (profile.parameterValues ?? {}) as Record<string, unknown>;
  const parameterIds = Object.keys(valuesObj);

  // Bulk join to Parameter to pick up name + domainGroup. Skip
  // interpretationHigh/Low per Decision 5 (OPERATOR-only sweep ships in #1664).
  const params =
    parameterIds.length === 0
      ? []
      : await prisma.parameter.findMany({
          where: { parameterId: { in: parameterIds } },
          select: { parameterId: true, name: true, domainGroup: true },
        });
  const paramIndex = new Map(params.map((p) => [p.parameterId, p]));

  const parameters: PersonalityParameterEntry[] = parameterIds
    .map((pid) => {
      const raw = valuesObj[pid];
      if (typeof raw !== "number" || Number.isNaN(raw)) return null;
      const p = paramIndex.get(pid);
      return {
        parameterId: pid,
        name: p?.name ?? pid,
        domainGroup: p?.domainGroup ?? "other",
        value: raw,
      };
    })
    .filter((entry): entry is PersonalityParameterEntry => entry !== null)
    .sort((a, b) => {
      // Sort by domainGroup then by name for stable, scan-friendly output.
      if (a.domainGroup !== b.domainGroup)
        return a.domainGroup.localeCompare(b.domainGroup);
      return a.name.localeCompare(b.name);
    });

  return NextResponse.json({
    ok: true,
    callerId,
    profile: {
      parameters,
      lastUpdatedAt: profile.lastUpdatedAt
        ? profile.lastUpdatedAt.toISOString()
        : null,
      callsUsed: profile.callsUsed,
      specsUsed: profile.specsUsed,
    },
  });
}
