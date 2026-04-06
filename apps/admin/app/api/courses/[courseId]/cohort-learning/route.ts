/**
 * @api GET /api/courses/:courseId/cohort-learning
 * @visibility public
 * @scope courses:read
 * @auth session
 * @tags courses, learning, measurement
 * @description Returns cohort-level learning aggregate for a course — before (survey) vs after (session scores), competency band distribution, parameter averages, checkpoint pass rates.
 * @pathParam courseId string - The playbook (course) ID
 * @response 200 { ok: true, data: CohortAggregateData }
 * @response 200 { ok: true, data: null } — No learning data (knowledge profile or no enrolled learners)
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

const PARAM_LABELS: Record<string, string> = {
  COMP_RETRIEVAL: "Retrieval", COMP_INFERENCE: "Inference", COMP_VOCABULARY: "Vocabulary",
  COMP_LANGUAGE: "Language", COMP_EVALUATION: "Evaluation", COMP_RECALL: "Recall",
  DISC_PERSPECTIVE: "Perspective", DISC_ARGUMENT: "Argument", DISC_SHIFT: "Position Shift", DISC_REFLECTION: "Reflection",
  COACH_CLARITY: "Goal Clarity", COACH_ACTION: "Action", COACH_AWARENESS: "Self-Awareness", COACH_FOLLOWUP: "Follow-Through",
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
): Promise<NextResponse> {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const { courseId } = await params;

  // Resolve teaching profile for this course
  const subjects = await prisma.playbookSubject.findMany({
    where: { playbookId: courseId },
    select: { subject: { select: { teachingProfile: true } } },
    take: 1,
  });

  const profile = subjects[0]?.subject?.teachingProfile;
  if (!profile || !PROFILE_PREFIXES[profile]) {
    return NextResponse.json({ ok: true, data: null });
  }

  const prefix = PROFILE_PREFIXES[profile];
  const aggScope = AGG_SCOPES[profile];

  // Get enrolled caller IDs
  const enrollments = await prisma.callerPlaybook.findMany({
    where: { playbookId: courseId, status: "ACTIVE" },
    select: { callerId: true },
  });
  const callerIds = enrollments.map((e) => e.callerId);

  if (callerIds.length === 0) {
    return NextResponse.json({ ok: true, data: null });
  }

  // Pre-survey confidence average
  const confidenceAttrs = await prisma.callerAttribute.findMany({
    where: { callerId: { in: callerIds }, scope: "PRE_SURVEY", key: "confidence" },
    select: { numberValue: true },
  });
  const confidenceValues = confidenceAttrs.filter((a) => a.numberValue != null).map((a) => a.numberValue!);
  const avgPreConfidence = confidenceValues.length > 0
    ? confidenceValues.reduce((s, v) => s + v, 0) / confidenceValues.length
    : null;

  // Post-survey confidence average (re-asked at end of course)
  const postConfidenceAttrs = await prisma.callerAttribute.findMany({
    where: { callerId: { in: callerIds }, scope: "POST_SURVEY", key: "confidence" },
    select: { numberValue: true },
  });
  const postConfidenceValues = postConfidenceAttrs.filter((a) => a.numberValue != null).map((a) => a.numberValue!);
  const avgPostConfidence = postConfidenceValues.length > 0
    ? postConfidenceValues.reduce((s, v) => s + v, 0) / postConfidenceValues.length
    : null;

  // Competency band distribution
  const competencyAttrs = await prisma.callerAttribute.findMany({
    where: { callerId: { in: callerIds }, scope: aggScope, key: "competency_level" },
    select: { stringValue: true },
  });
  const bandCounts = new Map<string, number>();
  for (const a of competencyAttrs) {
    const band = a.stringValue ?? "no_evidence";
    bandCounts.set(band, (bandCounts.get(band) || 0) + 1);
  }
  const bandDistribution = ["mastery", "secure", "developing", "emerging", "no_evidence"]
    .map((band) => ({
      band,
      count: bandCounts.get(band) || 0,
      pct: callerIds.length > 0 ? ((bandCounts.get(band) || 0) / callerIds.length) * 100 : 0,
    }));

  // Per-parameter averages (latest score per caller per param)
  const latestScores = await prisma.callScore.findMany({
    where: {
      call: { callerPlaybook: { callerId: { in: callerIds } } },
      parameter: { parameterId: { startsWith: prefix } },
    },
    select: {
      score: true,
      parameter: { select: { parameterId: true, name: true } },
      call: { select: { callerPlaybook: { select: { callerId: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  // Take latest per caller per param
  const latestByCallerParam = new Map<string, number>();
  for (const s of latestScores) {
    const cid = s.call.callerPlaybook?.callerId;
    if (!cid) continue;
    const key = `${cid}:${s.parameter.parameterId}`;
    if (!latestByCallerParam.has(key)) {
      latestByCallerParam.set(key, s.score);
    }
  }

  // Aggregate by param
  const paramSums = new Map<string, { sum: number; count: number; name: string }>();
  for (const [key, score] of latestByCallerParam) {
    const paramId = key.split(":")[1];
    const paramName = latestScores.find((s) => s.parameter.parameterId === paramId)?.parameter.name ?? paramId;
    if (!paramSums.has(paramId)) paramSums.set(paramId, { sum: 0, count: 0, name: paramName });
    const entry = paramSums.get(paramId)!;
    entry.sum += score;
    entry.count++;
  }

  const paramAverages = Array.from(paramSums.entries()).map(([parameterId, data]) => ({
    parameterId,
    label: PARAM_LABELS[parameterId] ?? data.name,
    avg: data.count > 0 ? data.sum / data.count : 0,
  }));

  // Checkpoint pass rates
  const checkpointAttrs = await prisma.callerAttribute.findMany({
    where: { callerId: { in: callerIds }, scope: "CHECKPOINT" },
    select: { key: true, stringValue: true },
  });

  const cpCounts = new Map<string, { passed: number; total: number }>();
  for (const a of checkpointAttrs) {
    if (!cpCounts.has(a.key)) cpCounts.set(a.key, { passed: 0, total: 0 });
    const entry = cpCounts.get(a.key)!;
    entry.total++;
    if (a.stringValue === "PASSED") entry.passed++;
  }

  const checkpointRates = Array.from(cpCounts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, data]) => ({
      key,
      passRate: data.total > 0 ? data.passed / data.total : 0,
    }));

  return NextResponse.json({
    ok: true,
    data: {
      profile,
      profileLabel: PROFILE_LABELS[profile] ?? profile,
      learnerCount: callerIds.length,
      avgPreConfidence,
      avgPostConfidence,
      bandDistribution,
      paramAverages,
      checkpointRates,
    },
  });
}
