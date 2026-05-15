/**
 * Sync Constraints from Course Reference
 *
 * When a COURSE_REFERENCE document is extracted, any `edge_case` and
 * `teaching_rule` assertions that express prohibitions ("never", "do not",
 * "avoid") are synced to `config.constraints` on all linked Playbooks.
 *
 * Parallel to `syncGoalsFromReference` — same lookup pattern.
 *
 * Non-destructive: only adds constraints that don't already exist (by text match).
 * Does NOT remove wizard-defined constraints.
 */

import { prisma } from "@/lib/prisma";
import type { PlaybookConfig } from "@/lib/types/json-fields";

export interface SyncConstraintsResult {
  playbooksUpdated: number;
  constraintsAdded: number;
  constraintsSkipped: number;
}

/** Words that indicate a prohibition / boundary rule */
const PROHIBITION_PATTERN = /\b(never|do not|don'?t|avoid|must not|should not|shouldn'?t|forbidden|prohibited|not allowed)\b/i;

/**
 * Sync constraint-like assertions from a COURSE_REFERENCE source into
 * config.constraints on all playbooks that contain this source.
 */
export async function syncConstraintsFromReference(
  sourceId: string,
): Promise<SyncConstraintsResult> {
  const result: SyncConstraintsResult = {
    playbooksUpdated: 0,
    constraintsAdded: 0,
    constraintsSkipped: 0,
  };

  // 1. Verify this is a COURSE_REFERENCE source
  const source = await prisma.contentSource.findUnique({
    where: { id: sourceId },
    select: { id: true, documentType: true },
  });
  // #385 Slice 1 Phase 3 — accept all four COURSE_REFERENCE* values.
  if (
    !source ||
    !(
      source.documentType === "COURSE_REFERENCE" ||
      source.documentType === "COURSE_REFERENCE_CANONICAL" ||
      source.documentType === "COURSE_REFERENCE_TUTOR_BRIEFING" ||
      source.documentType === "COURSE_REFERENCE_ASSESSOR_RUBRIC"
    )
  ) return result;

  // 2. Get edge_case + teaching_rule assertions that express prohibitions
  const assertions = await prisma.contentAssertion.findMany({
    where: {
      sourceId,
      category: { in: ["edge_case", "teaching_rule"] },
      assertion: { not: "" },
    },
    orderBy: [{ depth: "asc" }, { orderIndex: "asc" }],
    select: { assertion: true },
  });

  // Filter to only prohibition-style assertions
  const constraintTexts = assertions
    .map((a) => a.assertion.trim())
    .filter((text) => PROHIBITION_PATTERN.test(text));

  if (constraintTexts.length === 0) return result;

  // 3. Find all playbooks linked to this source via PlaybookSource (direct)
  const playbookSourceLinks = await prisma.playbookSource.findMany({
    where: { sourceId },
    select: { playbookId: true },
  });
  let playbookIds = [...new Set(playbookSourceLinks.map((ps) => ps.playbookId))];

  // Fallback: legacy SubjectSource → PlaybookSubject chain
  if (playbookIds.length === 0) {
    const subjectSources = await prisma.subjectSource.findMany({
      where: { sourceId },
      select: { subjectId: true },
    });
    const playbookSubjects = await prisma.playbookSubject.findMany({
      where: { subjectId: { in: subjectSources.map((ss) => ss.subjectId) } },
      select: { playbookId: true },
    });
    playbookIds = [...new Set(playbookSubjects.map((ps) => ps.playbookId))];
  }

  if (playbookIds.length === 0) return result;

  // 4. Merge into each playbook's config.constraints (non-destructive)
  const playbooks = await prisma.playbook.findMany({
    where: { id: { in: playbookIds } },
    select: { id: true, config: true },
  });

  for (const playbook of playbooks) {
    const config = (playbook.config || {}) as PlaybookConfig;
    const existingConstraints: string[] = (config as PlaybookConfig & { constraints?: string[] }).constraints || [];

    // Match by lowercase text to avoid duplicates
    const existingSet = new Set(
      existingConstraints.map((c) => c.toLowerCase().trim()),
    );

    const toAdd = constraintTexts.filter(
      (c) => !existingSet.has(c.toLowerCase().trim()),
    );

    if (toAdd.length === 0) {
      result.constraintsSkipped += constraintTexts.length;
      continue;
    }

    const mergedConstraints = [...existingConstraints, ...toAdd];

    await prisma.playbook.update({
      where: { id: playbook.id },
      data: {
        config: JSON.parse(JSON.stringify({ ...config, constraints: mergedConstraints })),
      },
    });

    result.playbooksUpdated++;
    result.constraintsAdded += toAdd.length;
    result.constraintsSkipped += constraintTexts.length - toAdd.length;

    console.log(
      `[sync-constraints] Playbook ${playbook.id}: added ${toAdd.length} constraints from course reference`,
    );
  }

  return result;
}
