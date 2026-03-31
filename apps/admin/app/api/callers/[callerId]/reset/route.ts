import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api POST /api/callers/:callerId/reset
 * @visibility public
 * @scope callers:write
 * @auth session
 * @tags callers, reset
 * @description Full reset for a caller — deletes ALL runtime data (calls, transcripts,
 *   scores, memories, surveys, mastery, artifacts, goals progress) while preserving the
 *   Caller record, institution/domain/cohort attachment, and playbook enrollments.
 *   After reset the learner re-enters the journey from the welcome survey.
 * @pathParam callerId string - The caller ID to reset
 * @response 200 { ok: true, message: string, deleted: Record<string, number> }
 * @response 404 { ok: false, error: "Caller not found" }
 * @response 500 { ok: false, error: "Failed to reset caller" }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ callerId: string }> },
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { callerId } = await params;

    const caller = await prisma.caller.findUnique({
      where: { id: callerId },
      select: { id: true, name: true, email: true },
    });

    if (!caller) {
      return NextResponse.json(
        { ok: false, error: "Caller not found" },
        { status: 404 },
      );
    }

    // Collect IDs needed for child deletes
    const calls = await prisma.call.findMany({
      where: { callerId },
      select: { id: true },
    });
    const callIds = calls.map((c) => c.id);

    const callerIdentities = await prisma.callerIdentity.findMany({
      where: { callerId },
      select: { id: true },
    });
    const callerIdentityIds = callerIdentities.map((ci) => ci.id);

    const result = await prisma.$transaction(async (tx) => {
      // === CALL CHILDREN (must go before calls) ===
      const callMessages = await tx.callMessage.deleteMany({
        where: { callId: { in: callIds } },
      });
      const scores = await tx.callScore.deleteMany({
        where: { callId: { in: callIds } },
      });
      const behaviorMeasurements = await tx.behaviorMeasurement.deleteMany({
        where: { callId: { in: callIds } },
      });
      const rewardScores = await tx.rewardScore.deleteMany({
        where: { callId: { in: callIds } },
      });
      const callTargets = await tx.callTarget.deleteMany({
        where: { callId: { in: callIds } },
      });
      const callArtifacts = await tx.conversationArtifact.deleteMany({
        where: { callId: { in: callIds } },
      });
      const callActions = await tx.callAction.deleteMany({
        where: { callId: { in: callIds } },
      });

      // === CALLS ===
      const callsDeleted = await tx.call.deleteMany({
        where: { callerId },
      });

      // === CALLER-LINKED ARTIFACTS ===
      const slugSelections = await tx.promptSlugSelection.deleteMany({
        where: { callerId },
      });
      const memories = await tx.callerMemory.deleteMany({
        where: { callerId },
      });
      const memorySummary = await tx.callerMemorySummary.deleteMany({
        where: { callerId },
      });
      const observations = await tx.personalityObservation.deleteMany({
        where: { callerId },
      });
      const personalityProfiles = await tx.callerPersonalityProfile.deleteMany({
        where: { callerId },
      });
      const personality = await tx.callerPersonality.deleteMany({
        where: { callerId },
      });
      const prompts = await tx.composedPrompt.deleteMany({
        where: { callerId },
      });
      const callerTargets = await tx.callerTarget.deleteMany({
        where: { callerId },
      });
      const callerAttributes = await tx.callerAttribute.deleteMany({
        where: { callerId },
      });
      const moduleProgress = await tx.callerModuleProgress.deleteMany({
        where: { callerId },
      });
      const onboardingSessions = await tx.onboardingSession.deleteMany({
        where: { callerId },
      });
      const inboundMessages = await tx.inboundMessage.deleteMany({
        where: { callerId },
      });

      // === GOALS — reset progress, keep definitions ===
      const goalsReset = await tx.goal.updateMany({
        where: { callerId },
        data: {
          progress: 0,
          progressMetrics: Prisma.DbNull,
          status: "ACTIVE",
          startedAt: null,
          completedAt: null,
        },
      });

      // === CALLER IDENTITY — clear runtime state, keep structure ===
      const behaviorTargets = await tx.behaviorTarget.deleteMany({
        where: {
          callerIdentityId: { in: callerIdentityIds },
          scope: "CALLER",
        },
      });
      const identitiesCleared = await tx.callerIdentity.updateMany({
        where: { callerId },
        data: {
          promptStackId: null,
          nextPrompt: null,
          nextPromptComposedAt: null,
          nextPromptInputs: Prisma.DbNull,
          callerPrompt: null,
          promptComposedAt: null,
          promptSnapshot: Prisma.DbNull,
          callCount: 0,
          lastCallAt: null,
        },
      });

      return {
        calls: callsDeleted.count,
        callMessages: callMessages.count,
        scores: scores.count,
        behaviorMeasurements: behaviorMeasurements.count,
        rewardScores: rewardScores.count,
        callTargets: callTargets.count,
        callArtifacts: callArtifacts.count,
        callActions: callActions.count,
        slugSelections: slugSelections.count,
        memories: memories.count,
        memorySummary: memorySummary.count,
        observations: observations.count,
        personalityProfiles: personalityProfiles.count,
        personality: personality.count,
        prompts: prompts.count,
        callerTargets: callerTargets.count,
        callerAttributes: callerAttributes.count,
        moduleProgress: moduleProgress.count,
        onboardingSessions: onboardingSessions.count,
        inboundMessages: inboundMessages.count,
        goalsReset: goalsReset.count,
        behaviorTargets: behaviorTargets.count,
        identitiesCleared: identitiesCleared.count,
      };
    });

    return NextResponse.json({
      ok: true,
      message: `Reset complete for ${caller.name || caller.email || callerId}`,
      deleted: result,
    });
  } catch (error: any) {
    console.error("Error resetting caller:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to reset caller" },
      { status: 500 },
    );
  }
}
