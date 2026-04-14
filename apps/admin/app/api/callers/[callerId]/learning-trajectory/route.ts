/**
 * @api GET /api/callers/:callerId/learning-trajectory
 * @visibility public
 * @scope callers:read
 * @auth session
 * @tags callers, learning, measurement
 * @description Returns learning outcome trajectory for a caller — per-parameter scores across sessions, competency level, and checkpoint status. Only returns data for non-knowledge teaching profiles (comprehension-led, discussion-led, coaching-led).
 * @pathParam callerId string - The caller ID
 * @response 200 { ok: true, data: { profile, profileLabel, competencyLevel, parameters, checkpoints } }
 * @response 200 { ok: true, data: null } — No learning trajectory (knowledge profile or no scores)
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

const PROFILE_LABELS: Record<string, string> = {
  "comprehension-led": "Comprehension Skills",
  "discussion-led": "Discussion Skills",
  "coaching-led": "Coaching Progress",
};

const PROFILE_PREFIXES: Record<string, string> = {
  "comprehension-led": "COMP_",
  "discussion-led": "DISC_",
  "coaching-led": "COACH_",
};

const AGG_SCOPES: Record<string, string> = {
  "comprehension-led": "COMP-AGG-001",
  "discussion-led": "DISC-AGG-001",
  "coaching-led": "COACH-AGG-001",
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ callerId: string }> },
): Promise<NextResponse> {
  const auth = await requireAuth("VIEWER");
  if (isAuthError(auth)) return auth.error;

  const { callerId } = await params;

  // Resolve teaching profile: caller → enrollment → playbook → subject
  const enrollment = await prisma.callerPlaybook.findFirst({
    where: { callerId, status: "ACTIVE" },
    select: {
      playbook: {
        select: {
          subjects: {
            select: { subject: { select: { teachingProfile: true } } },
            take: 1,
          },
        },
      },
    },
  });

  const profile = enrollment?.playbook?.subjects?.[0]?.subject?.teachingProfile;
  if (!profile || !PROFILE_PREFIXES[profile]) {
    return NextResponse.json({ ok: true, data: null });
  }

  const prefix = PROFILE_PREFIXES[profile];
  const aggScope = AGG_SCOPES[profile];

  // Load CallScores for this profile's parameters across all calls (most recent first)
  const scores = await prisma.callScore.findMany({
    where: {
      call: { callerId },
      parameter: { parameterId: { startsWith: prefix } },
    },
    select: {
      score: true,
      createdAt: true,
      parameter: { select: { parameterId: true, name: true } },
      call: { select: { createdAt: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  if (scores.length === 0) {
    return NextResponse.json({ ok: true, data: null });
  }

  // Group scores by parameter
  const paramMap = new Map<string, { name: string; scores: number[]; callDates: string[] }>();
  for (const s of scores) {
    const pid = s.parameter.parameterId;
    if (!paramMap.has(pid)) {
      paramMap.set(pid, { name: s.parameter.name, scores: [], callDates: [] });
    }
    const entry = paramMap.get(pid)!;
    entry.scores.push(s.score);
    entry.callDates.push(s.call.createdAt.toISOString().split("T")[0]);
  }

  const parameters = Array.from(paramMap.entries()).map(([parameterId, data]) => ({
    parameterId,
    name: data.name,
    scores: data.scores,
    latest: data.scores[data.scores.length - 1],
    callDates: data.callDates,
  }));

  // Load aggregated competency level
  const competencyAttr = await prisma.callerAttribute.findFirst({
    where: { callerId, scope: aggScope, key: "competency_level" },
    select: { stringValue: true },
  });

  // Load checkpoints
  const checkpoints = await prisma.callerAttribute.findMany({
    where: { callerId, scope: "CHECKPOINT" },
    select: { key: true, stringValue: true, numberValue: true },
    orderBy: { key: "asc" },
  });

  return NextResponse.json({
    ok: true,
    data: {
      profile,
      profileLabel: PROFILE_LABELS[profile] ?? profile,
      competencyLevel: competencyAttr?.stringValue ?? null,
      parameters,
      checkpoints: checkpoints.map((cp) => ({
        key: cp.key,
        status: cp.stringValue ?? "PENDING",
        score: cp.numberValue,
      })),
    },
  });
}
