/**
 * Resolve Default Module — Call.requestedModuleId backfill (G6 / #1154)
 *
 * Auto-resolves a default `CurriculumModule` for a caller's next call when
 * the caller doesn't supply one via the module picker. Eliminates the
 * 61% null `Call.requestedModuleId` rate on IELTS V1.0 observed in the
 * 2026-06 audit, which silently bypassed the #1006 / I-C1 module-lock
 * invariant.
 *
 * Resolution chain (first hit wins):
 *   1. Latest `CallerModuleProgress` row for this caller+playbook
 *      (the module the caller most recently touched — natural continuation)
 *   2. The playbook's first `CurriculumModule` by `order` ascending
 *      (the canonical entry point for a fresh learner)
 *   3. null (no curriculum attached — caller path stays unscoped)
 *
 * Per CHAIN-CONTRACTS.md Link 3 sub-contract I-C1: when this resolver returns
 * non-null, the invariant has a concrete `requestedModuleId` to enforce
 * against `pedagogy.flow.moduleToReview`. When it returns null, I-C1 falls
 * through cleanly (no module-lock to honour).
 *
 * @see docs/audit/pipeline-measure-adapt-2026-06.md §6 G6
 * @see docs/epic-100-chain-walk.md Link 3
 */

import { prisma } from "@/lib/prisma";
import { resolveCurriculumIdForPlaybook } from "@/lib/curriculum/resolve-module";

export interface DefaultModuleResolution {
  /** Slug suitable for `Call.requestedModuleId`. */
  moduleSlug: string;
  /** `CurriculumModule.id` suitable for `Call.curriculumModuleId`. */
  curriculumModuleId: string;
  /** Which rung of the resolution chain hit. */
  source: "caller_progress" | "playbook_first_module";
}

export async function resolveDefaultModuleForCaller(
  callerId: string,
  playbookId: string,
): Promise<DefaultModuleResolution | null> {
  if (!callerId || !playbookId) return null;

  const curriculumId = await resolveCurriculumIdForPlaybook(playbookId);
  if (!curriculumId) return null;

  // Step 1: most-recently-touched module for this caller in this curriculum.
  // Note: CallerModuleProgress is keyed by (callerId, moduleId) per CC-E —
  // mastery is intentionally cross-Playbook for sibling Curricula. Filtering
  // by curriculumId on the module side gives us per-curriculum continuation
  // without breaking the variant funnel's shared-mastery property.
  const latestProgress = await prisma.callerModuleProgress.findFirst({
    where: {
      callerId,
      module: { curriculumId },
    },
    select: {
      module: { select: { id: true, slug: true } },
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  if (latestProgress?.module?.slug) {
    return {
      moduleSlug: latestProgress.module.slug,
      curriculumModuleId: latestProgress.module.id,
      source: "caller_progress",
    };
  }

  // Step 2: playbook's first CurriculumModule by sortOrder.
  const firstModule = await prisma.curriculumModule.findFirst({
    where: { curriculumId },
    select: { id: true, slug: true },
    orderBy: { sortOrder: "asc" },
  });
  if (firstModule?.slug) {
    return {
      moduleSlug: firstModule.slug,
      curriculumModuleId: firstModule.id,
      source: "playbook_first_module",
    };
  }

  return null;
}
