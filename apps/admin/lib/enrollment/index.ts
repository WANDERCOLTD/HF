/**
 * Enrollment — Manages CallerPlaybook relationships (class roster model).
 *
 * All functions accept an optional Prisma transaction client (`tx`) so they
 * can be composed inside existing transactions (e.g. invite accept, domain switch).
 */

import { db, type TxClient } from "@/lib/prisma";
import type { Prisma, CallerPlaybook, CohortPlaybook } from "@prisma/client";

/**
 * Enroll a caller in a specific playbook. Upserts — safe to call multiple times.
 * If the caller was previously DROPPED/PAUSED, re-activates the enrollment.
 */
export async function enrollCaller(
  callerId: string,
  playbookId: string,
  source: string,
  tx?: TxClient
): Promise<CallerPlaybook> {
  const p = db(tx);
  const enrollment = await p.callerPlaybook.upsert({
    where: { callerId_playbookId: { callerId, playbookId } },
    create: {
      callerId,
      playbookId,
      status: "ACTIVE",
      enrolledBy: source,
    },
    update: {
      status: "ACTIVE",
      enrolledBy: source,
      pausedAt: null,
      droppedAt: null,
    },
  });

  // Auto-set isDefault if this is the only active enrollment
  const activeCount = await p.callerPlaybook.count({
    where: { callerId, status: "ACTIVE" },
  });
  if (activeCount === 1) {
    await p.callerPlaybook.update({
      where: { id: enrollment.id },
      data: { isDefault: true },
    });
    enrollment.isDefault = true;
  }

  return enrollment;
}

/**
 * Smart single-playbook enrollment — resolves ONE playbook for the domain.
 *
 * Resolution order:
 * 1. Explicit playbookId provided → enroll in that one
 * 2. Domain has exactly 1 PUBLISHED playbook → auto-select
 * 3. Multiple playbooks → return null (caller must choose)
 *
 * Use this instead of enrollCallerInDomainPlaybooks() for all new code.
 */
export async function resolveAndEnrollSingle(
  callerId: string,
  domainId: string,
  source: string,
  explicitPlaybookId?: string | null,
  tx?: TxClient
): Promise<CallerPlaybook | null> {
  // 1. Explicit takes priority
  if (explicitPlaybookId) {
    return enrollCaller(callerId, explicitPlaybookId, source, tx);
  }

  // 2. Count published playbooks in domain
  const published = await db(tx).playbook.findMany({
    where: { domainId, status: "PUBLISHED" },
    select: { id: true },
    orderBy: { sortOrder: "asc" },
  });

  // Single playbook → auto-select
  if (published.length === 1) {
    return enrollCaller(callerId, published[0].id, source, tx);
  }

  // 0 or multiple playbooks → cannot auto-resolve
  return null;
}

/**
 * @deprecated Use resolveAndEnrollSingle() instead. This function enrolls in ALL
 * domain playbooks and should only be used for explicit bulk enrollment scenarios.
 *
 * Auto-enroll a caller in all PUBLISHED playbooks for a domain.
 */
export async function enrollCallerInDomainPlaybooks(
  callerId: string,
  domainId: string,
  source: string,
  tx?: TxClient
): Promise<CallerPlaybook[]> {
  const playbooks = await db(tx).playbook.findMany({
    where: { domainId, status: "PUBLISHED" },
    select: { id: true },
  });

  const results: CallerPlaybook[] = [];
  for (const pb of playbooks) {
    const enrollment = await enrollCaller(callerId, pb.id, source, tx);
    results.push(enrollment);
  }
  return results;
}

/**
 * Drop a caller's enrollment in a playbook (explicit withdrawal).
 */
export async function unenrollCaller(
  callerId: string,
  playbookId: string,
  tx?: TxClient
): Promise<CallerPlaybook> {
  return db(tx).callerPlaybook.update({
    where: { callerId_playbookId: { callerId, playbookId } },
    data: { status: "DROPPED", droppedAt: new Date() },
  });
}

/**
 * Get all ACTIVE enrollments for a caller (with playbook data).
 */
export async function getActiveEnrollments(
  callerId: string,
  tx?: TxClient
): Promise<CallerPlaybook[]> {
  return db(tx).callerPlaybook.findMany({
    where: { callerId, status: "ACTIVE" },
    orderBy: { enrolledAt: "asc" },
  });
}

/**
 * Get all enrollments for a caller (any status), with playbook details.
 */
export async function getAllEnrollments(
  callerId: string,
  tx?: TxClient
) {
  return db(tx).callerPlaybook.findMany({
    where: { callerId },
    include: {
      playbook: { select: { id: true, name: true, status: true, domainId: true } },
    },
    orderBy: { enrolledAt: "asc" },
  });
}

/**
 * Mark an enrollment as completed.
 */
export async function completeEnrollment(
  callerId: string,
  playbookId: string,
  tx?: TxClient
): Promise<CallerPlaybook> {
  return db(tx).callerPlaybook.update({
    where: { callerId_playbookId: { callerId, playbookId } },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
}

/**
 * Pause an enrollment.
 */
export async function pauseEnrollment(
  callerId: string,
  playbookId: string,
  tx?: TxClient
): Promise<CallerPlaybook> {
  return db(tx).callerPlaybook.update({
    where: { callerId_playbookId: { callerId, playbookId } },
    data: { status: "PAUSED", pausedAt: new Date() },
  });
}

/**
 * Resume a paused enrollment.
 */
export async function resumeEnrollment(
  callerId: string,
  playbookId: string,
  tx?: TxClient
): Promise<CallerPlaybook> {
  return db(tx).callerPlaybook.update({
    where: { callerId_playbookId: { callerId, playbookId } },
    data: { status: "ACTIVE", pausedAt: null },
  });
}

/**
 * Drop all ACTIVE enrollments for a caller (used during domain switch).
 */
export async function dropAllActiveEnrollments(
  callerId: string,
  tx?: TxClient
): Promise<Prisma.BatchPayload> {
  return db(tx).callerPlaybook.updateMany({
    where: { callerId, status: "ACTIVE" },
    data: { status: "DROPPED", droppedAt: new Date() },
  });
}

/**
 * Get enrolled caller IDs for a playbook (roster view).
 */
export async function getPlaybookRoster(
  playbookId: string,
  status?: "ACTIVE" | "COMPLETED" | "PAUSED" | "DROPPED",
  tx?: TxClient
) {
  return db(tx).callerPlaybook.findMany({
    where: {
      playbookId,
      ...(status ? { status } : {}),
    },
    include: {
      caller: { select: { id: true, name: true, email: true, phone: true } },
    },
    orderBy: { enrolledAt: "asc" },
  });
}

// ─── Cohort-Level Enrollment ─────────────────────────────────────────────────

/**
 * Get playbook IDs assigned to a cohort.
 */
export async function getCohortPlaybookIds(
  cohortGroupId: string,
  tx?: TxClient
): Promise<string[]> {
  const assignments = await db(tx).cohortPlaybook.findMany({
    where: { cohortGroupId },
    select: { playbookId: true },
  });
  return assignments.map((a) => a.playbookId);
}

/**
 * Enroll a caller in playbooks assigned to their cohort(s).
 * Accepts a single cohortGroupId or an array for multi-cohort.
 * Takes the UNION of all cohort playbooks across all memberships.
 * Falls back to domain-wide enrollment if no cohort playbooks found.
 */
export async function enrollCallerInCohortPlaybooks(
  callerId: string,
  cohortGroupId: string | string[],
  domainId: string,
  source: string,
  tx?: TxClient
): Promise<CallerPlaybook[]> {
  const cohortIds = Array.isArray(cohortGroupId) ? cohortGroupId : [cohortGroupId];

  // Union all playbook IDs across all cohort memberships
  const allPlaybookIds = new Set<string>();
  for (const cid of cohortIds) {
    const ids = await getCohortPlaybookIds(cid, tx);
    ids.forEach((id) => allPlaybookIds.add(id));
  }

  if (allPlaybookIds.size > 0) {
    const results: CallerPlaybook[] = [];
    for (const playbookId of allPlaybookIds) {
      const enrollment = await enrollCaller(callerId, playbookId, source, tx);
      results.push(enrollment);
    }
    return results;
  }

  // Fallback: no cohort playbooks assigned → try smart single enrollment
  const single = await resolveAndEnrollSingle(callerId, domainId, source, null, tx);
  return single ? [single] : [];
}

/**
 * Assign a playbook to a cohort. Optionally auto-enroll all existing members.
 */
export async function assignPlaybookToCohort(
  cohortGroupId: string,
  playbookId: string,
  assignedBy: string,
  autoEnrollMembers: boolean,
  tx?: TxClient
): Promise<{ assignment: CohortPlaybook; enrolled: number }> {
  const assignment = await db(tx).cohortPlaybook.upsert({
    where: { cohortGroupId_playbookId: { cohortGroupId, playbookId } },
    create: { cohortGroupId, playbookId, assignedBy },
    update: { assignedBy },
  });

  let enrolled = 0;
  if (autoEnrollMembers) {
    const result = await enrollCohortMembersInPlaybook(cohortGroupId, playbookId, "cohort-assign", tx);
    enrolled = result.enrolled;
  }

  return { assignment, enrolled };
}

/**
 * Remove a playbook from a cohort. Optionally drop member enrollments.
 */
export async function removePlaybookFromCohort(
  cohortGroupId: string,
  playbookId: string,
  dropMemberEnrollments: boolean,
  tx?: TxClient
): Promise<{ removed: boolean; dropped: number }> {
  await db(tx).cohortPlaybook.delete({
    where: { cohortGroupId_playbookId: { cohortGroupId, playbookId } },
  });

  let dropped = 0;
  if (dropMemberEnrollments) {
    const memberships = await db(tx).callerCohortMembership.findMany({
      where: { cohortGroupId },
      select: { callerId: true },
    });

    if (memberships.length > 0) {
      const result = await db(tx).callerPlaybook.updateMany({
        where: {
          playbookId,
          callerId: { in: memberships.map((m) => m.callerId) },
          status: "ACTIVE",
        },
        data: { status: "DROPPED", droppedAt: new Date() },
      });
      dropped = result.count;
    }
  }

  return { removed: true, dropped };
}

/**
 * Enroll all current cohort members in a specific playbook (sync operation).
 * Uses CallerCohortMembership join table for member lookup.
 */
export async function enrollCohortMembersInPlaybook(
  cohortGroupId: string,
  playbookId: string,
  source: string,
  tx?: TxClient
): Promise<{ enrolled: number; errors: string[] }> {
  const memberships = await db(tx).callerCohortMembership.findMany({
    where: { cohortGroupId },
    select: { callerId: true },
  });
  const members = memberships.map((m) => ({ id: m.callerId }));

  let enrolled = 0;
  const errors: string[] = [];

  for (const member of members) {
    try {
      await enrollCaller(member.id, playbookId, source, tx);
      enrolled++;
    } catch (err: any) {
      errors.push(`${member.id}: ${err?.message || "Failed"}`);
    }
  }

  return { enrolled, errors };
}

/**
 * Set a specific enrollment as the default for a caller.
 * Unsets any existing default first (only one default per caller).
 */
export async function setDefaultEnrollment(
  callerId: string,
  playbookId: string,
  tx?: TxClient
): Promise<CallerPlaybook> {
  const p = db(tx);

  // Unset existing defaults for this caller
  await p.callerPlaybook.updateMany({
    where: { callerId, isDefault: true },
    data: { isDefault: false },
  });

  // Set the new default
  return p.callerPlaybook.update({
    where: { callerId_playbookId: { callerId, playbookId } },
    data: { isDefault: true },
  });
}
