/**
 * Shared caller data deletion utility.
 *
 * Used by:
 * - DELETE /api/callers/:callerId (right to erasure)
 * - POST /api/admin/retention/cleanup (automated retention)
 * - POST /api/admin/bulk-delete (bulk delete)
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export interface DeletionCounts {
  callScores: number;
  behaviorMeasurements: number;
  callTargets: number;
  rewardScores: number;
  callMessages: number;
  callActions: number;
  callerMemories: number;
  callerMemorySummaries: number;
  personalityObservations: number;
  callerPersonalities: number;
  callerPersonalityProfiles: number;
  promptSlugSelections: number;
  composedPrompts: number;
  callerTargets: number;
  callerAttributes: number;
  callerIdentities: number;
  callerPlaybooks: number;
  callerCohortMemberships: number;
  goals: number;
  artifacts: number;
  inboundMessages: number;
  onboardingSessions: number;
  calls: number;
}

/**
 * Delete all data for a caller in a single transaction.
 * Returns counts of deleted records per table.
 *
 * @param callerId - The caller ID to delete
 * @param tx - Optional transaction client (for use within an outer transaction)
 */
export async function deleteCallerData(
  callerId: string,
  tx?: Prisma.TransactionClient
): Promise<DeletionCounts> {
  const counts: DeletionCounts = {
    callScores: 0,
    behaviorMeasurements: 0,
    callTargets: 0,
    rewardScores: 0,
    callMessages: 0,
    callActions: 0,
    callerMemories: 0,
    callerMemorySummaries: 0,
    personalityObservations: 0,
    callerPersonalities: 0,
    callerPersonalityProfiles: 0,
    promptSlugSelections: 0,
    composedPrompts: 0,
    callerTargets: 0,
    callerAttributes: 0,
    callerIdentities: 0,
    callerPlaybooks: 0,
    callerCohortMemberships: 0,
    goals: 0,
    artifacts: 0,
    inboundMessages: 0,
    onboardingSessions: 0,
    calls: 0,
  };

  const run = async (client: Prisma.TransactionClient) => {
    // Get call IDs for FK-dependent deletes
    const callIds = await client.call.findMany({
      where: { callerId },
      select: { id: true },
    });
    const callIdList = callIds.map((c) => c.id);

    // Delete call-related records first
    if (callIdList.length > 0) {
      counts.callScores = (await client.callScore.deleteMany({ where: { callId: { in: callIdList } } })).count;
      counts.behaviorMeasurements = (await client.behaviorMeasurement.deleteMany({ where: { callId: { in: callIdList } } })).count;
      counts.callTargets = (await client.callTarget.deleteMany({ where: { callId: { in: callIdList } } })).count;
      counts.rewardScores = (await client.rewardScore.deleteMany({ where: { callId: { in: callIdList } } })).count;
      counts.callMessages = (await client.callMessage.deleteMany({ where: { callId: { in: callIdList } } })).count;
    }

    // Delete caller-scoped action items (CallAction.callerId is required FK)
    counts.callActions = (await client.callAction.deleteMany({ where: { callerId } })).count;

    // Delete caller-related records
    counts.callerMemories = (await client.callerMemory.deleteMany({ where: { callerId } })).count;
    counts.callerMemorySummaries = (await client.callerMemorySummary.deleteMany({ where: { callerId } })).count;
    counts.personalityObservations = (await client.personalityObservation.deleteMany({ where: { callerId } })).count;
    counts.callerPersonalities = (await client.callerPersonality.deleteMany({ where: { callerId } })).count;
    counts.callerPersonalityProfiles = (await client.callerPersonalityProfile.deleteMany({ where: { callerId } })).count;
    counts.promptSlugSelections = (await client.promptSlugSelection.deleteMany({ where: { callerId } })).count;
    counts.composedPrompts = (await client.composedPrompt.deleteMany({ where: { callerId } })).count;
    counts.callerTargets = (await client.callerTarget.deleteMany({ where: { callerId } })).count;
    counts.callerAttributes = (await client.callerAttribute.deleteMany({ where: { callerId } })).count;

    // Delete cascade-covered tables explicitly (for count tracking)
    counts.goals = (await client.goal.deleteMany({ where: { callerId } })).count;
    counts.artifacts = (await client.conversationArtifact.deleteMany({ where: { callerId } })).count;
    counts.inboundMessages = (await client.inboundMessage.deleteMany({ where: { callerId } })).count;
    counts.onboardingSessions = (await client.onboardingSession.deleteMany({ where: { callerId } })).count;

    // Delete join tables (CASCADE-covered but explicit for count tracking)
    counts.callerPlaybooks = (await client.callerPlaybook.deleteMany({ where: { callerId } })).count;
    counts.callerCohortMemberships = (await client.callerCohortMembership.deleteMany({ where: { callerId } })).count;

    // Delete caller identities
    counts.callerIdentities = (await client.callerIdentity.deleteMany({ where: { callerId } })).count;

    // Delete calls
    counts.calls = (await client.call.deleteMany({ where: { callerId } })).count;

    // Finally delete the caller
    await client.caller.delete({ where: { id: callerId } });
  };

  if (tx) {
    await run(tx);
  } else {
    await prisma.$transaction(run, { timeout: 30000 });
  }

  return counts;
}
