/**
 * @api GET /api/testimony/specs/[specId]
 * @auth OPERATOR
 * @desc Deep spec stats: per-parameter averages, score distribution, top evidence quotes, caller summary
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ specId: string }> }
) {
  const authResult = await requireAuth("OPERATOR");
  if (isAuthError(authResult)) return authResult.error;

  const { specId } = await params;
  const domainId = request.nextUrl.searchParams.get("domainId");

  const spec = await prisma.analysisSpec.findUnique({
    where: { id: specId },
    select: { id: true, slug: true, name: true, specRole: true },
  });

  if (!spec) {
    return NextResponse.json(
      { ok: false, error: "Spec not found" },
      { status: 404 }
    );
  }

  const scoreWhere: Record<string, unknown> = { analysisSpecId: specId };
  if (domainId) {
    scoreWhere.call = { caller: { domainId } };
  }

  // Fetch all scores for this spec
  const scores = await prisma.callScore.findMany({
    where: scoreWhere,
    select: {
      id: true,
      parameterId: true,
      score: true,
      confidence: true,
      evidence: true,
      callerId: true,
      callId: true,
      scoredAt: true,
      call: {
        select: {
          caller: {
            select: { id: true, name: true },
          },
        },
      },
    },
    orderBy: { scoredAt: "desc" },
  });

  // Per-parameter averages
  const paramMap = new Map<
    string,
    { scores: number[]; confidences: number[] }
  >();
  for (const s of scores) {
    if (!paramMap.has(s.parameterId)) {
      paramMap.set(s.parameterId, { scores: [], confidences: [] });
    }
    const entry = paramMap.get(s.parameterId)!;
    entry.scores.push(s.score);
    entry.confidences.push(s.confidence);
  }

  const parameterAverages = [...paramMap.entries()].map(
    ([parameterId, data]) => ({
      parameterId,
      avgScore:
        Math.round(
          (data.scores.reduce((a, b) => a + b, 0) / data.scores.length) * 100
        ) / 100,
      avgConfidence:
        Math.round(
          (data.confidences.reduce((a, b) => a + b, 0) /
            data.confidences.length) *
            100
        ) / 100,
      count: data.scores.length,
    })
  );
  parameterAverages.sort((a, b) => b.count - a.count);

  // Score distribution (5 buckets)
  const distribution = [0, 0, 0, 0, 0]; // [0-0.2, 0.2-0.4, 0.4-0.6, 0.6-0.8, 0.8-1.0]
  for (const s of scores) {
    const bucket = Math.min(4, Math.floor(s.score * 5));
    distribution[bucket]++;
  }

  // Top evidence quotes (highest confidence, with evidence text)
  const evidenceQuotes = scores
    .filter((s) => s.evidence && s.evidence.length > 0)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10)
    .map((s) => ({
      evidence: s.evidence[0],
      score: s.score,
      confidence: s.confidence,
      callerName: s.call?.caller?.name ?? null,
      callId: s.callId,
      scoredAt: s.scoredAt,
    }));

  // Caller summary
  const callerMap = new Map<
    string,
    { name: string; scores: number[]; callCount: Set<string> }
  >();
  for (const s of scores) {
    if (!s.callerId) continue;
    if (!callerMap.has(s.callerId)) {
      callerMap.set(s.callerId, {
        name: s.call?.caller?.name ?? "(unnamed)",
        scores: [],
        callCount: new Set(),
      });
    }
    const entry = callerMap.get(s.callerId)!;
    entry.scores.push(s.score);
    if (s.callId) entry.callCount.add(s.callId);
  }

  const callerSummary = [...callerMap.entries()].map(
    ([callerId, data]) => ({
      callerId,
      name: data.name,
      avgScore:
        Math.round(
          (data.scores.reduce((a, b) => a + b, 0) / data.scores.length) * 100
        ) / 100,
      totalScores: data.scores.length,
      callCount: data.callCount.size,
    })
  );
  callerSummary.sort((a, b) => b.totalScores - a.totalScores);

  return NextResponse.json({
    ok: true,
    spec: {
      id: spec.id,
      slug: spec.slug,
      name: spec.name,
      specRole: spec.specRole,
    },
    totalScores: scores.length,
    parameterAverages,
    distribution: {
      labels: ["0-0.2", "0.2-0.4", "0.4-0.6", "0.6-0.8", "0.8-1.0"],
      values: distribution,
    },
    evidenceQuotes,
    callerSummary,
  });
}
