/**
 * Resolve Playbook — Determines which playbook (course) to use for a session.
 *
 * Priority: explicit param → isDefault enrollment → single enrollment auto-select → null (merge all).
 */

import { db, type TxClient } from "@/lib/prisma";

/**
 * Resolve which playbookId to use for a caller's session.
 *
 * @param callerId - The caller to resolve for
 * @param explicitPlaybookId - Explicitly provided playbookId (highest priority)
 * @param tx - Optional transaction client
 * @returns The resolved playbookId, or null if no single course can be determined (merge all)
 */
export async function resolvePlaybookId(
  callerId: string,
  explicitPlaybookId?: string | null,
  tx?: TxClient,
): Promise<string | null> {
  // 1. Explicit takes precedence
  if (explicitPlaybookId) return explicitPlaybookId;

  // 2. Check for a default enrollment
  const defaultEnrollment = await db(tx).callerPlaybook.findFirst({
    where: { callerId, status: "ACTIVE", isDefault: true },
    select: { playbookId: true },
  });
  if (defaultEnrollment) return defaultEnrollment.playbookId;

  // 3. If exactly one active enrollment, auto-select it
  const activeEnrollments = await db(tx).callerPlaybook.findMany({
    where: { callerId, status: "ACTIVE" },
    select: { playbookId: true },
    take: 2, // Only need to know if there's exactly 1
  });

  if (activeEnrollments.length === 1) return activeEnrollments[0].playbookId;

  // 4. Multiple enrollments, no default — caller needs explicit course selection
  return null;
}
