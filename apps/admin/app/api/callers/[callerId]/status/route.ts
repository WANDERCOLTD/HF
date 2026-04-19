import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEntityAccess, isEntityAuthError } from "@/lib/access-control";

const PROCESSING_WINDOW_MS = 5 * 60 * 1000;

/**
 * @api GET /api/callers/:callerId/status
 * @visibility internal
 * @scope callers:read
 * @auth bearer
 * @tags callers
 * @description Lightweight endpoint for polling call analysis status.
 *   Returns only recent calls (< 5 min old) with hasScores/hasPrompt flags.
 *   Used by CallerDetailPage polling instead of refetching the full caller endpoint.
 * @pathParam callerId string - Caller UUID
 * @response 200 { ok: true, calls: [{ id, hasScores, hasPrompt }] }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ callerId: string }> },
): Promise<NextResponse> {
  const authResult = await requireEntityAccess("callers", "R");
  if (isEntityAuthError(authResult)) return authResult.error;

  const { callerId } = await params;
  const fiveMinAgo = new Date(Date.now() - PROCESSING_WINDOW_MS);

  const [recentCalls, scoreCounts, promptCalls] = await Promise.all([
    prisma.call.findMany({
      where: { callerId, createdAt: { gte: fiveMinAgo } },
      select: { id: true },
    }),
    prisma.callScore.groupBy({
      by: ["callId"],
      where: { call: { callerId, createdAt: { gte: fiveMinAgo } } },
      _count: { id: true },
    }),
    prisma.composedPrompt.findMany({
      where: { callerId, createdAt: { gte: fiveMinAgo } },
      select: { triggerCallId: true },
      distinct: ["triggerCallId"],
    }),
  ]);

  const scoreSet = new Set(scoreCounts.map((s) => s.callId));
  const promptSet = new Set(
    promptCalls.map((p) => p.triggerCallId).filter(Boolean),
  );

  return NextResponse.json({
    ok: true,
    calls: recentCalls.map((c) => ({
      id: c.id,
      hasScores: scoreSet.has(c.id),
      hasPrompt: promptSet.has(c.id),
    })),
  });
}
