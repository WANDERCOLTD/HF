import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEntityAccess, isEntityAuthError } from "@/lib/access-control";
import { auditLog, AuditAction } from "@/lib/audit";
import { studentAllowedToReadCaller, callerScopeMismatchResponse } from "@/lib/learner-scope";

/**
 * @api GET /api/callers/:callerId/export
 * @visibility internal
 * @scope callers:read
 * @auth session
 * @tags callers, gdpr
 * @description Export all data for a caller (GDPR Subject Access Request).
 *   Returns a structured JSON document with all caller data.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ callerId: string }> }
) {
  try {
    const authResult = await requireEntityAccess("callers", "R");
    if (isEntityAuthError(authResult)) return authResult.error;

    const { callerId } = await params;


    // HF-M IDOR (2026-06-12): STUDENT-as-bearer routes that admit STUDENT must reject
    // a foreign callerId — without this, a STUDENT can read any caller's PII by supplying
    // their callerId in the URL path. See docs/audit/HF-M-evidence-path-param-idor.md.
    if (!studentAllowedToReadCaller(authResult.session, callerId)) {
      return callerScopeMismatchResponse();
    }
    const caller = await prisma.caller.findUnique({
      where: { id: callerId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        externalId: true,
        createdAt: true,
        domain: { select: { id: true, name: true } },
      },
    });

    if (!caller) {
      return NextResponse.json(
        { ok: false, error: "Caller not found" },
        { status: 404 }
      );
    }

    // Run all queries in parallel
    const [
      calls,
      memories,
      memorySummary,
      personalityProfile,
      personalityObservations,
      callerTargets,
      goals,
      artifacts,
      inboundMessages,
      identities,
      composedPrompts,
      attributes,
      onboardingSessions,
    ] = await Promise.all([
      prisma.call.findMany({
        where: { callerId },
        select: {
          id: true,
          transcript: true,
          source: true,
          externalId: true,
          createdAt: true,
          // #1344 Slice 4 — `callSequence` gone; walk via Session FK.
          session: { select: { learnerFacingNumber: true } },
          scores: {
            select: {
              parameterId: true,
              score: true,
              confidence: true,
              evidence: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.callerMemory.findMany({
        where: { callerId },
        select: {
          category: true,
          key: true,
          value: true,
          confidence: true,
          evidence: true,
          extractedAt: true,
          expiresAt: true,
          supersededById: true,
        },
        orderBy: { extractedAt: "desc" },
      }),
      prisma.callerMemorySummary.findUnique({
        where: { callerId },
        select: {
          keyFacts: true,
          preferences: true,
          topTopics: true,
          factCount: true,
          preferenceCount: true,
          eventCount: true,
          topicCount: true,
        },
      }),
      prisma.callerPersonalityProfile.findUnique({
        where: { callerId },
        select: { parameterValues: true, lastUpdatedAt: true },
      }),
      prisma.personalityObservation.findMany({
        where: { callerId },
        select: {
          openness: true,
          conscientiousness: true,
          extraversion: true,
          agreeableness: true,
          neuroticism: true,
          confidence: true,
          observedAt: true,
          parameterValues: true,
        },
        orderBy: { observedAt: "desc" },
      }),
      prisma.callerTarget.findMany({
        where: { callerId },
        select: {
          parameterId: true,
          targetValue: true,
          callsUsed: true,
          createdAt: true,
        },
      }),
      prisma.goal.findMany({
        where: { callerId },
        select: {
          type: true,
          name: true,
          description: true,
          status: true,
          progress: true,
          progressMetrics: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.conversationArtifact.findMany({
        where: { callerId },
        select: {
          title: true,
          content: true,
          type: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.inboundMessage.findMany({
        where: { callerId },
        select: {
          content: true,
          type: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.callerIdentity.findMany({
        where: { callerId },
        select: {
          externalId: true,
          name: true,
          callCount: true,
          lastCallAt: true,
        },
      }),
      prisma.composedPrompt.findMany({
        where: { callerId },
        select: {
          prompt: true,
          composedAt: true,
          status: true,
          triggerType: true,
        },
        orderBy: { composedAt: "desc" },
      }),
      prisma.callerAttribute.findMany({
        where: { callerId },
        select: {
          key: true,
          valueType: true,
          stringValue: true,
          numberValue: true,
          booleanValue: true,
          jsonValue: true,
          scope: true,
          createdAt: true,
        },
      }),
      prisma.onboardingSession.findMany({
        where: { callerId },
        select: {
          domainId: true,
          completedPhases: true,
          isComplete: true,
          createdAt: true,
        },
      }),
    ]);

    const exportData = {
      exportedAt: new Date().toISOString(),
      dataSubject: caller,
      calls,
      memories,
      memorySummary,
      personalityProfile,
      personalityObservations,
      goals,
      targets: callerTargets,
      artifacts,
      messages: inboundMessages,
      identities,
      composedPrompts,
      attributes,
      onboardingSessions,
    };

    // Audit the export
    auditLog({
      userId: authResult.session.user.id,
      userEmail: authResult.session.user.email,
      action: AuditAction.EXPORTED_CALLER_DATA,
      entityType: "Caller",
      entityId: callerId,
      metadata: {
        callCount: calls.length,
        memoryCount: memories.length,
        goalCount: goals.length,
      },
    });

    return NextResponse.json({ ok: true, export: exportData });
  } catch (error: any) {
    console.error("Error exporting caller data:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to export caller data" },
      { status: 500 }
    );
  }
}
