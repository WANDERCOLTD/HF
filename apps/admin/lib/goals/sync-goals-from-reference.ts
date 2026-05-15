/**
 * Sync Goals from Course Reference
 *
 * When a COURSE_REFERENCE document is extracted, any `assessment_approach`
 * assertions are synced to `config.goals` on all linked Playbooks.
 *
 * This bridges course reference success criteria → Playbook GoalTemplates →
 * per-caller Goal records (created on enrollment).
 *
 * Non-destructive: only adds goals that don't already exist (by name match).
 * Does NOT remove wizard-defined goals.
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { GoalTemplate, PlaybookConfig } from "@/lib/types/json-fields";

export interface SyncGoalsResult {
  playbooksUpdated: number;
  goalsAdded: number;
  goalsSkipped: number;
}

/**
 * Sync assessment_approach assertions from a source into config.goals
 * on all playbooks that contain this source (via subject → playbookSubject).
 */
export async function syncGoalsFromReference(
  sourceId: string,
): Promise<SyncGoalsResult> {
  const result: SyncGoalsResult = {
    playbooksUpdated: 0,
    goalsAdded: 0,
    goalsSkipped: 0,
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

  // 2. Get assessment_approach assertions from this source
  const assertions = await prisma.contentAssertion.findMany({
    where: {
      sourceId,
      category: "assessment_approach",
      assertion: { not: "" },
    },
    orderBy: [{ depth: "asc" }, { orderIndex: "asc" }],
    select: {
      assertion: true,
      chapter: true,
      section: true,
    },
  });

  if (assertions.length === 0) return result;

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

  // 4. Build GoalTemplates from assertions
  const newGoals: GoalTemplate[] = assertions.map((a) => {
    // Infer goal type from tier/section
    const tier = (a.section || a.chapter || "").toLowerCase();
    const isFail = tier.includes("fail");

    return {
      type: "ACHIEVE",
      name: a.assertion,
      description: isFail ? "Fail condition" : (a.section || a.chapter || undefined),
      isDefault: true,
      isAssessmentTarget: !isFail, // Fail conditions are not targets, they're guardrails
      assessmentConfig: isFail ? undefined : { threshold: 0.8 },
    };
  });

  // 5. Merge into each playbook's config.goals (non-destructive)
  const playbooks = await prisma.playbook.findMany({
    where: { id: { in: playbookIds } },
    select: { id: true, config: true },
  });

  for (const playbook of playbooks) {
    const config = (playbook.config || {}) as PlaybookConfig;
    const existingGoals = config.goals || [];

    // Match by name (case-insensitive) to avoid duplicates
    const existingNames = new Set(
      existingGoals.map((g) => g.name.toLowerCase().trim()),
    );

    const toAdd = newGoals.filter(
      (g) => !existingNames.has(g.name.toLowerCase().trim()),
    );

    if (toAdd.length === 0) {
      result.goalsSkipped += newGoals.length;
      continue;
    }

    const mergedGoals = [...existingGoals, ...toAdd];

    await prisma.playbook.update({
      where: { id: playbook.id },
      data: {
        config: { ...config, goals: mergedGoals } as Prisma.InputJsonValue,
      },
    });

    result.playbooksUpdated++;
    result.goalsAdded += toAdd.length;
    result.goalsSkipped += newGoals.length - toAdd.length;

    console.log(
      `[sync-goals] Playbook ${playbook.id}: added ${toAdd.length} goals from course reference`,
    );
  }

  return result;
}
