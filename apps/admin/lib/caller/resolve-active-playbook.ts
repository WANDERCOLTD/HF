/**
 * resolveActivePlaybookId — canonical fallback chain for "which playbook is
 * this caller talking about RIGHT NOW?" used by every learner-facing page
 * that mounts a session on a Playbook.
 *
 * Resolution order (matches L9 chain contract in `docs/CHAIN-CONTRACTS.md`):
 *
 *   1. `urlOverride` — when the URL passed `?playbookId=<id>` (deep-link from
 *      picker / wizard / preview). URL always wins, even if the id points at
 *      a non-ACTIVE enrollment, because legitimate deep-links exist for
 *      paused-but-being-viewed playbooks.
 *
 *   2. Single ACTIVE `CallerPlaybook` enrollment → that `playbookId`.
 *
 *   3. Multiple ACTIVE → most-recently-enrolled wins (`ORDER BY enrolledAt
 *      DESC`). Same tie-break rule as `CallerDetailPage.tsx:386-398`.
 *
 *   4. Zero ACTIVE enrollments → `null`. The page is responsible for
 *      rendering a learner-readable empty state (NOT a silent no-op — the
 *      whole point of contract L9 is preventing silent unreachability).
 *
 * Non-ACTIVE enrollment statuses (`PAUSED`, `COMPLETED`, `DROPPED`, etc.) are
 * excluded from the candidate pool at the SQL layer.
 *
 * Issue: #948 — extracted from `app/x/sim/[callerId]/page.tsx` (and the
 * sibling auto-pick rule in `components/callers/CallerDetailPage.tsx`) so the
 * arch-checker rule has a single import to point at.
 */

import { prisma } from "@/lib/prisma";

/**
 * Resolve the playbookId a caller's session should mount on.
 *
 * @param callerId - The caller whose enrollments to inspect.
 * @param urlOverride - Optional `?playbookId=` query-param value. Wins when
 *   non-empty. Pass `null` or `undefined` to fall through to enrollments.
 * @returns The resolved `playbookId`, or `null` when no enrollment exists
 *   and the URL didn't pass one.
 */
export async function resolveActivePlaybookId(
  callerId: string,
  urlOverride?: string | null,
): Promise<string | null> {
  // 1. URL wins — even if it points at a non-ACTIVE enrollment. Deep-link
  // semantics are the caller's responsibility, not ours.
  if (typeof urlOverride === "string" && urlOverride.length > 0) {
    return urlOverride;
  }

  // 2-4. Fall through to enrollment lookup.
  const enrollments = await prisma.callerPlaybook.findMany({
    where: { callerId, status: "ACTIVE" },
    orderBy: { enrolledAt: "desc" },
    select: { playbookId: true },
  });

  if (enrollments.length === 0) {
    // No ACTIVE enrollments — page must render a learner-readable empty
    // state (NOT silently swallow the missing picker).
    return null;
  }

  // length === 1: that single ACTIVE enrollment.
  // length >= 2: most-recently-enrolled wins (orderBy desc returns it
  // first). Identical tie-break to CallerDetailPage:393-398 — so the same
  // caller behaves the same way on either page.
  return enrollments[0].playbookId;
}
