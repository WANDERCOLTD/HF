/**
 * Resolves the parent `Playbook.id`(s) for a curriculum-side write site, so
 * the caller can invoke `bumpPlaybookComposeTimestamp` for each one and
 * propagate compose-input staleness across all sibling Playbooks sharing
 * the Curriculum.
 *
 * Four resolution paths exist depending on what FK the writer holds:
 *
 *   1. From a `curriculumId` — every PlaybookCurriculum row pointing at
 *      this curriculum (one Curriculum may be shared by N Playbooks).
 *   2. From a `curriculumModuleId` — `CurriculumModule → Curriculum →`
 *      then resolve as (1).
 *   3. From a `sourceId` — every `PlaybookSource` row pointing at this
 *      source (one source can be linked to multiple playbooks).
 *   4. From a `specId` (AnalysisSpec) — every `PlaybookItem` row linking
 *      this spec.
 *
 * **All paths return `string[]`** so callers always iterate:
 *
 *     const ids = await resolvePlaybookIdForCurriculum(curriculumId);
 *     for (const id of ids) await bumpPlaybookComposeTimestamp(id);
 *
 * Pre-#1034 paths (1) and (2) returned `string | null`. After #1034 they
 * return `string[]` because variant Playbooks (CC-B fanout) require every
 * sibling to receive the staleness bump.
 *
 * #834 — Story 8 of EPIC #832.
 * #1034 — CC-B fanout: variant Playbooks share a Curriculum via
 *         `PlaybookCurriculum`; mutations must fan out to all siblings.
 */

import { prisma } from "@/lib/prisma";

/**
 * Returns every `Playbook.id` linked to this Curriculum via `PlaybookCurriculum`
 * (siblings sharing the Curriculum). Single source of truth — the legacy
 * `Curriculum.playbookId` fallback was removed in batch 4 (#1177 Slice 5)
 * after the 20260606152557 backfill migration ensured every Curriculum has
 * a canonical primary join row on hf-dev (FK probe: 0 orphans).
 *
 * Signature changed from `string | null` to `string[]` in #1034 so a
 * single Curriculum mutation can bump compose staleness on all siblings.
 * Empty array when no playbook is linked.
 */
export async function resolvePlaybookIdForCurriculum(
  curriculumId: string,
): Promise<string[]> {
  if (!curriculumId) return [];

  const joins = await prisma.playbookCurriculum.findMany({
    where: { curriculumId },
    select: { playbookId: true },
  });
  return joins.map((j) => j.playbookId);
}

/**
 * Returns every `Playbook.id` linked to the Curriculum that owns this
 * CurriculumModule (siblings sharing the Curriculum).
 *
 * Signature changed from `string | null` to `string[]` in #1034.
 */
export async function resolvePlaybookIdForCurriculumModule(
  curriculumModuleId: string,
): Promise<string[]> {
  if (!curriculumModuleId) return [];

  const row = await prisma.curriculumModule.findUnique({
    where: { id: curriculumModuleId },
    select: { curriculumId: true },
  });
  if (!row?.curriculumId) return [];

  return resolvePlaybookIdForCurriculum(row.curriculumId);
}

export async function resolvePlaybookIdsForContentSource(
  sourceId: string,
): Promise<string[]> {
  if (!sourceId) return [];
  const rows = await prisma.playbookSource.findMany({
    where: { sourceId },
    select: { playbookId: true },
  });
  return rows.map((r) => r.playbookId);
}

/**
 * Resolve every playbook that links the given AnalysisSpec via a
 * PlaybookItem row. Used by background jobs (curriculum-enricher) that
 * mutate a CONTENT spec which may be attached to one or more playbooks.
 */
export async function resolvePlaybookIdsForAnalysisSpec(
  specId: string,
): Promise<string[]> {
  if (!specId) return [];
  const rows = await prisma.playbookItem.findMany({
    where: { specId },
    select: { playbookId: true },
  });
  // PlaybookItem.playbookId may be null in legacy data — filter.
  return rows
    .map((r) => r.playbookId)
    .filter((id): id is string => Boolean(id));
}
