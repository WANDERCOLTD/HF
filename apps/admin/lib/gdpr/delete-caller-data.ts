/**
 * Shared caller data deletion utility.
 *
 * THE canonical way to delete a Caller. Nothing else may call
 * `prisma.caller.delete` / `deleteMany` — `hf-privacy/no-bare-caller-delete`
 * enforces that, and `tests/lib/gdpr/caller-delete-coverage.test.ts` pins this
 * chain against the schema so a new Restrict FK cannot silently break erasure.
 *
 * Used by:
 * - DELETE /api/callers/:callerId (right to erasure)
 * - POST /api/admin/retention/cleanup (automated retention)
 * - POST /api/admin/bulk-delete (bulk delete)
 * - POST /api/callers/merge (source callers, after re-parenting)
 * - admin reset / cleanup routes, and every seed script that clears callers
 *
 * Two entry points over one implementation: `deleteCallersData` (batch) and
 * `deleteCallerData` (single, delegates). Callers deleting more than one row
 * should use the batch form — it is the same FK order in `in (...)` clauses
 * rather than N round-trips per caller.
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
  sessions: number;
  sequenceCounters: number;
  ownedCohortGroups: number;
  ownedCohortInvites: number;
  legacyCohortRefsCleared: number;
  identityBehaviorTargets: number;
}

/**
 * Delete all data for one or more callers in a single transaction.
 * Returns aggregate counts of deleted records per table.
 *
 * @param callerIds - The caller IDs to delete. Empty array is a no-op.
 * @param tx - Optional transaction client (for use within an outer transaction)
 */
export async function deleteCallersData(
  callerIds: string[],
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
    sessions: 0,
    sequenceCounters: 0,
    ownedCohortGroups: 0,
    ownedCohortInvites: 0,
    legacyCohortRefsCleared: 0,
    identityBehaviorTargets: 0,
  };

  const run = async (client: Prisma.TransactionClient) => {
    // Get call IDs for FK-dependent deletes
    const callIds = await client.call.findMany({
      where: { callerId: { in: callerIds } },
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
    counts.callActions = (await client.callAction.deleteMany({ where: { callerId: { in: callerIds } } })).count;

    // Delete caller-related records
    counts.callerMemories = (await client.callerMemory.deleteMany({ where: { callerId: { in: callerIds } } })).count;
    counts.callerMemorySummaries = (await client.callerMemorySummary.deleteMany({ where: { callerId: { in: callerIds } } })).count;
    counts.personalityObservations = (await client.personalityObservation.deleteMany({ where: { callerId: { in: callerIds } } })).count;
    counts.callerPersonalities = (await client.callerPersonality.deleteMany({ where: { callerId: { in: callerIds } } })).count;
    counts.callerPersonalityProfiles = (await client.callerPersonalityProfile.deleteMany({ where: { callerId: { in: callerIds } } })).count;
    counts.promptSlugSelections = (await client.promptSlugSelection.deleteMany({ where: { callerId: { in: callerIds } } })).count;
    counts.composedPrompts = (await client.composedPrompt.deleteMany({ where: { callerId: { in: callerIds } } })).count;
    counts.callerTargets = (await client.callerTarget.deleteMany({ where: { callerId: { in: callerIds } } })).count;
    counts.callerAttributes = (await client.callerAttribute.deleteMany({ where: { callerId: { in: callerIds } } })).count;

    // Delete cascade-covered tables explicitly (for count tracking)
    counts.goals = (await client.goal.deleteMany({ where: { callerId: { in: callerIds } } })).count;
    counts.artifacts = (await client.conversationArtifact.deleteMany({ where: { callerId: { in: callerIds } } })).count;
    counts.inboundMessages = (await client.inboundMessage.deleteMany({ where: { callerId: { in: callerIds } } })).count;
    counts.onboardingSessions = (await client.onboardingSession.deleteMany({ where: { callerId: { in: callerIds } } })).count;

    // Delete join tables (CASCADE-covered but explicit for count tracking)
    counts.callerPlaybooks = (await client.callerPlaybook.deleteMany({ where: { callerId: { in: callerIds } } })).count;
    counts.callerCohortMemberships = (await client.callerCohortMembership.deleteMany({ where: { callerId: { in: callerIds } } })).count;

    // Delete caller identities. `BehaviorTarget.callerIdentityId` is a
    // Restrict FK into CallerIdentity, so CALLER-scope behaviour tuning must
    // go first or the identity delete throws. These rows are per-caller
    // tuning derived from that caller's sessions — caller data, so erased.
    const identityIds = (
      await client.callerIdentity.findMany({ where: { callerId: { in: callerIds } }, select: { id: true } })
    ).map((i) => i.id);
    if (identityIds.length > 0) {
      counts.identityBehaviorTargets = (
        await client.behaviorTarget.deleteMany({
          where: { callerIdentityId: { in: identityIds } },
        })
      ).count;
    }
    counts.callerIdentities = (await client.callerIdentity.deleteMany({ where: { callerId: { in: callerIds } } })).count;

    // Delete calls
    counts.calls = (await client.call.deleteMany({ where: { callerId: { in: callerIds } } })).count;

    // Sessions (epic #1338). `Session.callerId` is onDelete: Restrict, so
    // these MUST go before caller.delete() or Postgres rejects the erasure
    // with P2003. FailureLog cascades from Session. Calls are already gone
    // above, so the Call.sessionId SetNull pass is a no-op.
    counts.sessions = (await client.session.deleteMany({ where: { callerId: { in: callerIds } } })).count;
    counts.sequenceCounters = (
      await client.callerSequenceCounter.deleteMany({ where: { callerId: { in: callerIds } } })
    ).count;

    // Cohorts this caller OWNS. `CohortGroup.ownerId` is Restrict-by-default,
    // so an owner cannot be erased while their cohorts exist. Invite also
    // holds a Restrict FK to CohortGroup and must be cleared first;
    // CohortPlaybook and CallerCohortMembership cascade.
    const ownedCohortIds = (
      await client.cohortGroup.findMany({ where: { ownerId: { in: callerIds } }, select: { id: true } })
    ).map((c) => c.id);
    if (ownedCohortIds.length > 0) {
      counts.ownedCohortInvites = (
        await client.invite.deleteMany({ where: { cohortGroupId: { in: ownedCohortIds } } })
      ).count;
    }
    if (ownedCohortIds.length > 0) {
      // `Caller.cohortGroupId` is the DEPRECATED single-membership scalar and
      // is Restrict-by-default, so a cohort cannot be deleted while ANY caller
      // still points at it — including callers other than the one being erased.
      // Sever those references rather than deleting the other callers' rows.
      counts.legacyCohortRefsCleared = (
        await client.caller.updateMany({
          where: { cohortGroupId: { in: ownedCohortIds } },
          data: { cohortGroupId: null },
        })
      ).count;
    }
    counts.ownedCohortGroups = (
      await client.cohortGroup.deleteMany({ where: { ownerId: { in: callerIds } } })
    ).count;

    // Finally delete the callers themselves.
    await client.caller.deleteMany({ where: { id: { in: callerIds } } });
  };

  if (callerIds.length === 0) return counts;

  if (tx) {
    await run(tx);
  } else {
    await prisma.$transaction(run, { timeout: 30000 });
  }

  return counts;
}

/**
 * Single-caller convenience wrapper over {@link deleteCallersData}.
 *
 * Kept because most call sites erase exactly one caller and reading
 * `deleteCallerData(id)` at those sites is clearer than `deleteCallersData([id])`.
 */
export async function deleteCallerData(
  callerId: string,
  tx?: Prisma.TransactionClient
): Promise<DeletionCounts> {
  return deleteCallersData([callerId], tx);
}
