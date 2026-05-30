import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { resolveCallerScopeForReading, isScopeError } from "@/lib/learner-scope";

/**
 * @api GET /api/calls
 * @visibility public
 * @scope calls:read
 * @auth session
 * @tags calls
 * @description List calls with optional filtering by caller. Returns calls with scores, memories, behavior measurements, triggered prompts, and pipeline status.
 * @query limit number - Max number of calls to return (default: 100)
 * @query callerId string - Filter calls by caller ID
 * @response 200 { ok: true, calls: Call[], count: number }
 * @response 500 { ok: false, error: "Failed to fetch calls" }
 */
export async function GET(req: Request) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") || "100");
    const requestedCallerId = url.searchParams.get("callerId");

    const scope = await resolveCallerScopeForReading(authResult.session, requestedCallerId);
    if (isScopeError(scope)) return scope.error;
    const callerId = scope.scopedCallerId;

    const calls = await prisma.call.findMany({
      where: callerId ? { callerId } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        caller: {
          select: { id: true, name: true, email: true },
        },
        scores: {
          select: {
            id: true,
            parameterId: true,
            score: true,
            analysisSpecId: true,
            analysisSpec: {
              select: {
                slug: true,
                name: true,
                outputType: true,
              },
            },
          },
        },
        extractedMemories: {
          select: {
            id: true,
            category: true,
            key: true,
            value: true,
          },
        },
        behaviorMeasurements: {
          select: { id: true },
        },
        triggeredPrompts: {
          select: { id: true, composedAt: true },
          take: 1,
          orderBy: { composedAt: "desc" },
        },
        _count: {
          select: { scores: true, extractedMemories: true, behaviorMeasurements: true },
        },
      },
    });

    // Also check if caller has nextPrompt set for each call
    const callsWithPromptStatus = await Promise.all(
      calls.map(async (call) => {
        let hasNextPrompt = false;
        if (call.callerId) {
          const identity = await prisma.callerIdentity.findFirst({
            where: { callerId: call.callerId },
            select: { nextPrompt: true, nextPromptComposedAt: true },
          });
          hasNextPrompt = !!identity?.nextPrompt;
        }
        return {
          ...call,
          hasNextPrompt,
          // Derive pipeline status
          pipelineStatus: {
            prepComplete: (call._count?.scores || 0) > 0 && (call._count?.behaviorMeasurements || 0) > 0,
            promptComposed: call.triggeredPrompts.length > 0 || hasNextPrompt,
          },
        };
      })
    );

    return NextResponse.json({ ok: true, calls: callsWithPromptStatus, count: calls.length });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to fetch calls" },
      { status: 500 }
    );
  }
}
