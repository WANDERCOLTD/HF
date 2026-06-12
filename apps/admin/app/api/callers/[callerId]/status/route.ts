import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEntityAccess, isEntityAuthError } from "@/lib/access-control";
import { studentAllowedToReadCaller, callerScopeMismatchResponse } from "@/lib/learner-scope";

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

  // HF-M IDOR (2026-06-12): STUDENT-as-bearer routes that admit STUDENT must reject
  // a foreign callerId — without this, a STUDENT can read any caller's PII by supplying
  // their callerId in the URL path. See docs/audit/HF-M-evidence-path-param-idor.md.
  if (!studentAllowedToReadCaller(authResult.session, callerId)) {
    return callerScopeMismatchResponse();
  }
  const fiveMinAgo = new Date(Date.now() - PROCESSING_WINDOW_MS);

  const [recentCalls, scoreCounts, promptCalls] = await Promise.all([
    prisma.call.findMany({
      where: { callerId, createdAt: { gte: fiveMinAgo } },
      select: { id: true, sessionId: true },
    }),
    prisma.callScore.groupBy({
      by: ["callId"],
      where: { call: { callerId, createdAt: { gte: fiveMinAgo } } },
      _count: { id: true },
    }),
    // #1344 Slice 4 — `triggerCallId` is gone; walk via parent Session.
    prisma.composedPrompt.findMany({
      where: { callerId, createdAt: { gte: fiveMinAgo } },
      select: { triggerSessionId: true },
      distinct: ["triggerSessionId"],
    }),
  ]);

  const scoreSet = new Set(scoreCounts.map((s) => s.callId));
  const triggeredSessionSet = new Set(
    promptCalls.map((p) => p.triggerSessionId).filter((id): id is string => !!id),
  );
  const promptSet = new Set(
    recentCalls
      .filter((c) => c.sessionId && triggeredSessionSet.has(c.sessionId))
      .map((c) => c.id),
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
