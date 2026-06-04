/**
 * Curriculum mutation fanout — CC-B (#1034).
 *
 * When a Curriculum-affecting mutation lands (LO write, module rename,
 * assertion edit, lesson plan change), the compose-input staleness signal
 * must reach EVERY sibling Playbook sharing the Curriculum via
 * `PlaybookCurriculum`, not just the primary owner.
 *
 * Variant Playbooks (Pop Quiz, Revision Aid, Exam Assessment built from
 * one Curriculum) all read the same `CurriculumModule.id` rows; when the
 * teacher edits an LO, every variant's next call must recompose with the
 * new content. Without fanout, only the primary Playbook would see the
 * change and learners on the variants would receive stale prompts until
 * an unrelated bump arrived.
 *
 * Extends the #825 stamp-on-write pattern documented in
 * `lib/compose/staleness.ts` and `docs/chain-contracts.md` (Link 3
 * sub-contract). Pipeline-internal writes do NOT bump (carve-out in
 * `lib/compose/bump-timestamp.ts`) — only teacher / wizard / admin
 * mutations call this fanout helper.
 *
 * Use this in NEW Curriculum-affecting write sites. Existing callers
 * (#1034 Task 3) inline the equivalent resolve-then-loop pattern; they
 * can migrate opportunistically.
 */

import {
  resolvePlaybookIdForCurriculum,
  resolvePlaybookIdForCurriculumModule,
} from "@/lib/curriculum/resolve-playbook-for-curriculum";
import { bumpPlaybookComposeTimestamp } from "./bump-timestamp";

export interface FanoutResult {
  /** Number of sibling Playbooks whose composeInputsUpdatedAt was bumped. */
  count: number;
  /** Representative Playbook (primary by ordering) — useful as the pendingChange.scopeId. */
  representativePlaybookId: string | null;
}

/**
 * Bump composeInputsUpdatedAt on every sibling Playbook linked to this
 * Curriculum via `PlaybookCurriculum`. Falls back to the deprecated
 * `Curriculum.playbookId` column when no join rows exist (transition).
 */
export async function bumpCurriculumComposeFanout(
  curriculumId: string,
): Promise<FanoutResult> {
  const ids = await resolvePlaybookIdForCurriculum(curriculumId);
  for (const id of ids) await bumpPlaybookComposeTimestamp(id);
  return {
    count: ids.length,
    representativePlaybookId: ids[0] ?? null,
  };
}

/**
 * Bump composeInputsUpdatedAt on every sibling Playbook linked to the
 * Curriculum that owns this CurriculumModule. Used by write sites that
 * hold a `moduleId` (e.g. LO writes, module-scoped behaviour edits).
 */
export async function bumpCurriculumModuleComposeFanout(
  moduleId: string,
): Promise<FanoutResult> {
  const ids = await resolvePlaybookIdForCurriculumModule(moduleId);
  for (const id of ids) await bumpPlaybookComposeTimestamp(id);
  return {
    count: ids.length,
    representativePlaybookId: ids[0] ?? null,
  };
}
