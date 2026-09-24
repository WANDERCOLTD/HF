/**
 * Pin the playbook's first CurriculumModule onto `Caller.lastSelectedModuleId`
 * at enrolment time so the default-module resolver doesn't race against a
 * tied-timestamps `CallerModuleProgress` population.
 *
 * Why this exists
 * ===============
 *
 * `lib/enrollment/instantiate-module-progress.ts` bulk-creates every
 * `CallerModuleProgress` row via `prisma.callerModuleProgress.createMany` —
 * `createMany` stamps the same `updatedAt` on every row, so for a fresh
 * caller every progress row's `updatedAt` ties.
 *
 * `lib/curriculum/resolve-default-module.ts::resolveDefaultModuleForCaller`
 * resolves Step 1 via `findFirst orderBy:{updatedAt:'desc'}`. With ties on
 * the leading sort key, Postgres breaks the tie by physical row order, which
 * is non-deterministic and (in practice) picks the wrong slug ~80% of the
 * time. The resolver returns a non-baseline slug → `resolveModuleByLogicalId`
 * misses → `createSession` writes `Call.curriculumModuleId = NULL`.
 *
 * Pinning `Caller.lastSelectedModuleId` to the playbook's first module by
 * `sortOrder` short-circuits the cascade in `lib/voice/create-session.ts`
 * (step 2: `Caller.lastSelectedModuleId`), so the racy Step-1 resolver is
 * never consulted on the FIRST call.
 *
 * Lattice survey (per `.claude/rules/lattice-survey.md`)
 * ======================================================
 *
 * - **Surface**: `Caller.lastSelectedModuleId` write.
 * - **Sibling writers**:
 *   - `lib/voice/route-handlers.ts` writes this after every successful
 *     VOICE_CALL end-of-call (per-call continuity — the learner picks
 *     up on the next call from where they left off). Confirmed via
 *     `qmd search "lastSelectedModuleId write"` / repo grep.
 *   - `app/api/callers/[callerId]/select-module/route.ts` writes this
 *     when the learner explicitly picks a module via the sim picker.
 *   - This helper writes it ONCE at enrolment time, AND ONLY when the
 *     row is currently `null` (the "fresh caller" case). Returning
 *     callers keep their most-recently-touched slug.
 * - **Risk shape — sibling-writer drift**: this helper sets a baseline
 *   value at enrolment; the other two writers update it over a caller's
 *   lifecycle. The `null`-guard ensures no clobber of pre-existing state.
 * - **Risk shape — convention conflict**: "first module" is unambiguous
 *   per `Playbook.config.modules[]` declared order, which the curriculum
 *   import flow projects to `CurriculumModule.sortOrder ASC`. Per BDD
 *   IELTS Unit 1 (and the structurally-equivalent first-module convention
 *   in every other published Playbook), the first module IS the baseline.
 *
 * The helper is best-effort: a failure here MUST NOT roll back the just-
 * committed enrolment. Callers wrap the call in `.catch(...)` to log-and-
 * continue, matching the pattern used by `instantiatePlaybookModuleProgress`
 * and `instantiatePlaybookTargets`.
 */

import { prisma } from "@/lib/prisma";
import { PlaybookCurriculumRole } from "@prisma/client";

export interface PinFirstModuleResult {
  pinned: boolean;
  reason:
    | "pinned"
    | "no-primary-curriculum"
    | "no-modules"
    | "already-pinned"
    | "caller-missing";
  moduleId?: string;
}

/**
 * Pin `Caller.lastSelectedModuleId` to the playbook's first
 * `CurriculumModule` by `sortOrder` if (and only if) the caller's
 * `lastSelectedModuleId` is currently `null`.
 *
 * Idempotent — re-runs are no-ops for callers that already have a
 * `lastSelectedModuleId` set (returning callers' module continuity is
 * preserved).
 */
export async function pinFirstModuleForCaller(
  callerId: string,
  playbookId: string,
): Promise<PinFirstModuleResult> {
  if (!callerId || !playbookId) {
    return { pinned: false, reason: "caller-missing" };
  }

  // Don't clobber a previously-set value — returning callers landing here
  // (e.g. magic-link to a course they were already enrolled in) keep their
  // module continuity. The null-guard is the structural sibling-writer
  // safety per the Lattice survey above.
  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { lastSelectedModuleId: true },
  });
  if (!caller) {
    return { pinned: false, reason: "caller-missing" };
  }
  if (caller.lastSelectedModuleId !== null) {
    return {
      pinned: false,
      reason: "already-pinned",
      moduleId: caller.lastSelectedModuleId,
    };
  }

  // Resolve the playbook's primary Curriculum via the canonical join row.
  // Mirrors the lookup shape in `lib/enrollment/instantiate-module-progress.ts`.
  const playbook = await prisma.playbook.findUnique({
    where: { id: playbookId },
    select: {
      playbookCurricula: {
        where: { role: PlaybookCurriculumRole.primary },
        select: { curriculumId: true },
        take: 1,
      },
    },
  });
  const primaryCurriculumId = playbook?.playbookCurricula[0]?.curriculumId;
  if (!primaryCurriculumId) {
    return { pinned: false, reason: "no-primary-curriculum" };
  }

  // First module by sortOrder — the canonical entry point per the
  // wizard's projection convention.
  const firstModule = await prisma.curriculumModule.findFirst({
    where: { curriculumId: primaryCurriculumId },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });
  if (!firstModule) {
    return { pinned: false, reason: "no-modules" };
  }

  await prisma.caller.update({
    where: { id: callerId },
    data: { lastSelectedModuleId: firstModule.id },
  });

  return { pinned: true, reason: "pinned", moduleId: firstModule.id };
}
