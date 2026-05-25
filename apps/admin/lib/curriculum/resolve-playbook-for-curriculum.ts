/**
 * Resolves the parent `Playbook.id` for a curriculum-side write site, so
 * the caller can invoke `bumpPlaybookComposeTimestamp` and propagate
 * compose-input staleness.
 *
 * Three resolution paths exist depending on what FK the writer already
 * holds:
 *
 *   1. From a `curriculumId` — `Curriculum.playbookId` (single FK).
 *   2. From a `curriculumModuleId` — `CurriculumModule → Curriculum →
 *      playbookId`.
 *   3. From a `sourceId` — every `PlaybookSource` row pointing at this
 *      source (one source can be linked to multiple playbooks).
 *
 * Returns `string[]` for paths (3) and a single `string | null` for
 * paths (1) + (2). Callers always loop `for (const id of ids) await
 * bumpPlaybookComposeTimestamp(id)` — single-bump callers pass `[id]`.
 *
 * #834 — Story 8 of EPIC #832.
 */

import { prisma } from "@/lib/prisma";

export async function resolvePlaybookIdForCurriculum(
  curriculumId: string,
): Promise<string | null> {
  if (!curriculumId) return null;
  const row = await prisma.curriculum.findUnique({
    where: { id: curriculumId },
    select: { playbookId: true },
  });
  return row?.playbookId ?? null;
}

export async function resolvePlaybookIdForCurriculumModule(
  curriculumModuleId: string,
): Promise<string | null> {
  if (!curriculumModuleId) return null;
  const row = await prisma.curriculumModule.findUnique({
    where: { id: curriculumModuleId },
    select: { curriculum: { select: { playbookId: true } } },
  });
  return row?.curriculum?.playbookId ?? null;
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
