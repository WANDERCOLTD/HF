/**
 * Shared playbook data deletion utility.
 *
 * Handles ALL FK relationships — including nullable FKs that Prisma
 * doesn't auto-cascade. Prevents orphaned records.
 *
 * Used by:
 * - DELETE /api/playbooks/:playbookId (single delete)
 * - POST /api/admin/bulk-delete (bulk delete)
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export interface PlaybookDeletionCounts {
  callerPlaybooks: number;
  cohortPlaybooks: number;
  goalsNullified: number;
  callsNullified: number;
  composedPromptsNullified: number;
  behaviorTargetsNullified: number;
  invitesNullified: number;
  childVersionsNullified: number;
  playbookItems: number;
  playbookSubjects: number;
}

/**
 * Delete a playbook and handle ALL FK relationships in a single transaction.
 *
 * - Required FKs: CallerPlaybook, CohortPlaybook (must delete — would cause FK error)
 * - Nullable FKs: Goal, Call, ComposedPrompt, BehaviorTarget, Invite (set to null)
 * - Self-ref: Playbook.parentVersionId (nullify child versions)
 * - Cascade-covered: PlaybookItem, PlaybookSubject (explicit for count tracking)
 *
 * @param playbookId - The playbook ID to delete
 * @param tx - Optional transaction client (for use within an outer transaction)
 */
export async function deletePlaybookData(
  playbookId: string,
  tx?: Prisma.TransactionClient
): Promise<PlaybookDeletionCounts> {
  const counts: PlaybookDeletionCounts = {
    callerPlaybooks: 0,
    cohortPlaybooks: 0,
    goalsNullified: 0,
    callsNullified: 0,
    composedPromptsNullified: 0,
    behaviorTargetsNullified: 0,
    invitesNullified: 0,
    childVersionsNullified: 0,
    playbookItems: 0,
    playbookSubjects: 0,
  };

  const run = async (client: Prisma.TransactionClient) => {
    // 1. Delete required-FK join tables (would cause FK constraint error if skipped)
    counts.callerPlaybooks = (
      await client.callerPlaybook.deleteMany({ where: { playbookId } })
    ).count;
    counts.cohortPlaybooks = (
      await client.cohortPlaybook.deleteMany({ where: { playbookId } })
    ).count;

    // 2. Nullify nullable FKs (SET NULL — don't delete the parent records)
    counts.goalsNullified = (
      await client.goal.updateMany({ where: { playbookId }, data: { playbookId: null } })
    ).count;
    counts.callsNullified = (
      await client.call.updateMany({ where: { playbookId }, data: { playbookId: null } })
    ).count;
    counts.composedPromptsNullified = (
      await client.composedPrompt.updateMany({ where: { playbookId }, data: { playbookId: null } })
    ).count;
    counts.behaviorTargetsNullified = (
      await client.behaviorTarget.updateMany({ where: { playbookId }, data: { playbookId: null } })
    ).count;
    counts.invitesNullified = (
      await client.invite.updateMany({ where: { playbookId }, data: { playbookId: null } })
    ).count;

    // 3. Nullify self-referential child versions
    counts.childVersionsNullified = (
      await client.playbook.updateMany({
        where: { parentVersionId: playbookId },
        data: { parentVersionId: null },
      })
    ).count;

    // 4. Delete cascade-covered tables explicitly (for count tracking)
    counts.playbookItems = (
      await client.playbookItem.deleteMany({ where: { playbookId } })
    ).count;
    counts.playbookSubjects = (
      await client.playbookSubject.deleteMany({ where: { playbookId } })
    ).count;

    // 5. Delete the playbook itself
    await client.playbook.delete({ where: { id: playbookId } });
  };

  if (tx) {
    await run(tx);
  } else {
    await prisma.$transaction(run, { timeout: 30000 });
  }

  return counts;
}
