/**
 * apply-projection.ts
 *
 * @canonical-doc docs/CONTENT-PIPELINE.md §4 Phase 2.5
 * @canonical-doc docs/ENTITIES.md §6 I7
 *
 * Idempotent applier that turns a CourseProjection (pure data from
 * projectCourseReference) into DB writes for a given Playbook.
 *
 * Algorithm — all inside one prisma.$transaction:
 *   1. Upsert Parameter rows for every projected parameter name. Each
 *      becomes a BEHAVIOR parameter with sensible skill-section defaults.
 *   2. Diff + write BehaviorTarget rows scoped (playbookId, sourceContentId,
 *      PLAYBOOK). Targets in the projection but missing → CREATE. Targets
 *      with different targetValue → UPDATE. Targets present in DB but not
 *      in projection → DELETE (they were derived from a prior version of
 *      this same source).
 *   3. Ensure a Curriculum exists for the playbook; diff + write
 *      CurriculumModule rows tagged with sourceContentId. Same add/update/
 *      remove logic, keyed by `slug`. For each module, diff + write
 *      LearningObjective rows keyed by (moduleId, ref), derived from the
 *      module's `outcomesPrimary` × the doc's outcomes dictionary. The
 *      classifier-managed audience-split fields (originalText,
 *      learnerVisible, performanceStatement, systemRole, humanOverriddenAt)
 *      are NEVER touched by the projection — only `ref`, `description`,
 *      `sortOrder` are projection-owned. Module deletes cascade to LOs via
 *      schema FK (#365).
 *   4. Merge the projection's configPatch into Playbook.config. Goal
 *      templates are scoped by sourceContentId so the applier replaces
 *      only its own prior templates — hand-authored / wizard / legacy
 *      goals (no sourceContentId tag) are preserved.
 *
 * Re-running applyProjection() with the same projection produces zero DB
 * mutations beyond `updatedAt` bumps. Removing a source's projection (by
 * deleting the source row) leaves derived rows with `sourceContentId: null`
 * (per the FK's ON DELETE SET NULL) — they survive but lose provenance,
 * which is the documented degradation path.
 *
 * Per-Caller Goal *rows* are NOT written here. The existing
 * `instantiatePlaybookGoals()` pathway reads Playbook.config.goals templates
 * at enrolment time. Phase 5 (wizard wire-in) is responsible for calling
 * that after the projection lands, if needed.
 *
 * Issue #338 Phase 4. LearningObjective linkage added in #365.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  GoalTemplate,
  PlaybookConfig,
  ValidationWarning,
} from "@/lib/types/json-fields";
import type {
  CourseProjection,
  ProjectedBehaviorTarget,
  ProjectedCurriculumModule,
  ProjectedGoalTemplate,
  ProjectedLearningObjective,
  ProjectedParameter,
} from "./project-course-reference";

// ── Public types ────────────────────────────────────────────────────────────

export interface ApplyProjectionOptions {
  playbookId: string;
  sourceContentId: string;
}

export interface ApplyProjectionResult {
  parametersUpserted: number;
  behaviorTargetsCreated: number;
  behaviorTargetsUpdated: number;
  behaviorTargetsRemoved: number;
  curriculumModulesCreated: number;
  curriculumModulesUpdated: number;
  curriculumModulesRemoved: number;
  learningObjectivesCreated: number;
  learningObjectivesUpdated: number;
  learningObjectivesRemoved: number;
  goalTemplatesWritten: number;
  curriculumId: string;
  warnings: ValidationWarning[];
  /** True when nothing changed beyond `updatedAt` bumps. */
  noop: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

type Tx = Prisma.TransactionClient;

/**
 * Upsert all projected parameters. Returns a map from parameterName →
 * parameterId (== the slugified name, since we use it directly as the
 * stable string ID).
 */
async function upsertParameters(
  tx: Tx,
  parameters: ProjectedParameter[],
  sourceContentId: string,
): Promise<{ map: Map<string, string>; created: number }> {
  const map = new Map<string, string>();
  let created = 0;

  for (const p of parameters) {
    const existing = await tx.parameter.findUnique({
      where: { parameterId: p.name },
      select: { parameterId: true },
    });

    if (existing) {
      map.set(p.name, existing.parameterId);
      continue;
    }

    await tx.parameter.create({
      data: {
        parameterId: p.name,
        name: p.description ?? p.name,
        definition: p.description ?? `Skill behavior parameter auto-created by projection`,
        sectionId: "skill",
        domainGroup: "skill",
        scaleType: "0-1",
        directionality: "positive",
        computedBy: `course-ref:${sourceContentId}`,
        parameterType: "BEHAVIOR",
        isAdjustable: true,
      },
    });
    map.set(p.name, p.name);
    created += 1;
  }

  return { map, created };
}

interface BehaviorTargetDiff {
  created: number;
  updated: number;
  removed: number;
}

async function diffBehaviorTargets(
  tx: Tx,
  desired: ProjectedBehaviorTarget[],
  parameterMap: Map<string, string>,
  playbookId: string,
  sourceContentId: string,
): Promise<BehaviorTargetDiff> {
  const existing = await tx.behaviorTarget.findMany({
    where: { playbookId, sourceContentId, scope: "PLAYBOOK" },
    select: { id: true, parameterId: true, targetValue: true },
  });

  const desiredByParam = new Map<string, ProjectedBehaviorTarget>();
  for (const t of desired) {
    const paramId = parameterMap.get(t.parameterName);
    if (paramId) desiredByParam.set(paramId, t);
  }

  let created = 0;
  let updated = 0;
  let removed = 0;

  // Remove existing not in desired (tagged with this source but no longer projected)
  for (const e of existing) {
    if (!desiredByParam.has(e.parameterId)) {
      await tx.behaviorTarget.delete({ where: { id: e.id } });
      removed += 1;
    }
  }

  // Upsert desired
  for (const [paramId, target] of desiredByParam) {
    const existingRow = existing.find((e) => e.parameterId === paramId);
    if (existingRow) {
      if (existingRow.targetValue !== target.targetValue) {
        await tx.behaviorTarget.update({
          where: { id: existingRow.id },
          data: { targetValue: target.targetValue },
        });
        updated += 1;
      }
    } else {
      await tx.behaviorTarget.create({
        data: {
          parameterId: paramId,
          scope: "PLAYBOOK",
          playbookId,
          targetValue: target.targetValue,
          source: "SEED",
          sourceContentId,
        },
      });
      created += 1;
    }
  }

  return { created, updated, removed };
}

async function ensureCurriculum(
  tx: Tx,
  playbookId: string,
): Promise<{ id: string; created: boolean }> {
  const existing = await tx.curriculum.findFirst({
    where: { playbookId },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const created = await tx.curriculum.create({
    data: {
      slug: `course-${playbookId.slice(0, 8)}-${Date.now()}`,
      name: "Authored modules",
      playbookId,
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

interface CurriculumModuleDiff {
  created: number;
  updated: number;
  removed: number;
  loCreated: number;
  loUpdated: number;
  loRemoved: number;
}

async function diffCurriculumModules(
  tx: Tx,
  desired: ProjectedCurriculumModule[],
  curriculumId: string,
  sourceContentId: string,
): Promise<CurriculumModuleDiff> {
  const existing = await tx.curriculumModule.findMany({
    where: { curriculumId, sourceContentId },
    select: { id: true, slug: true, title: true, sortOrder: true, estimatedDurationMinutes: true },
  });

  const desiredBySlug = new Map(desired.map((m) => [m.slug, m]));

  let created = 0;
  let updated = 0;
  let removed = 0;
  let loCreated = 0;
  let loUpdated = 0;
  let loRemoved = 0;

  // Removed modules also delete their LOs via FK ON DELETE CASCADE (see
  // schema.prisma model LearningObjective), so we only count modules here.
  for (const e of existing) {
    if (!desiredBySlug.has(e.slug)) {
      await tx.curriculumModule.delete({ where: { id: e.id } });
      removed += 1;
    }
  }

  for (const m of desired) {
    const existingRow = existing.find((e) => e.slug === m.slug);
    let moduleId: string;
    if (existingRow) {
      moduleId = existingRow.id;
      const drift =
        existingRow.title !== m.title ||
        existingRow.sortOrder !== m.sortOrder ||
        existingRow.estimatedDurationMinutes !== (m.estimatedDurationMinutes ?? null);
      if (drift) {
        await tx.curriculumModule.update({
          where: { id: existingRow.id },
          data: {
            title: m.title,
            sortOrder: m.sortOrder,
            estimatedDurationMinutes: m.estimatedDurationMinutes,
            description: m.description,
          },
        });
        updated += 1;
      }
    } else {
      const createdRow = await tx.curriculumModule.create({
        data: {
          curriculumId,
          slug: m.slug,
          title: m.title,
          sortOrder: m.sortOrder,
          estimatedDurationMinutes: m.estimatedDurationMinutes,
          description: m.description,
          sourceContentId,
        },
        select: { id: true },
      });
      moduleId = createdRow.id;
      created += 1;
    }

    // Sync LearningObjective rows for this module. Key: (moduleId, ref).
    // Issue #365.
    const loDiff = await diffLearningObjectives(tx, moduleId, m.learningObjectives);
    loCreated += loDiff.created;
    loUpdated += loDiff.updated;
    loRemoved += loDiff.removed;
  }

  return { created, updated, removed, loCreated, loUpdated, loRemoved };
}

interface LearningObjectiveDiff {
  created: number;
  updated: number;
  removed: number;
}

/**
 * Diff LearningObjective rows under a single CurriculumModule. Keyed by
 * `ref` (matches OUT-NN id from the COURSE_REFERENCE doc). LOs in the
 * projection but missing → CREATE. LOs with drifted description or
 * sortOrder → UPDATE. LOs present in DB but absent from the projection →
 * DELETE (they came from a prior version of this module's outcomesPrimary).
 *
 * The classifier-managed audience-split fields (originalText,
 * learnerVisible, performanceStatement, systemRole, humanOverriddenAt)
 * are NOT touched here — only the projection-owned fields (ref,
 * description, sortOrder). Issue #365.
 */
async function diffLearningObjectives(
  tx: Tx,
  moduleId: string,
  desired: ProjectedLearningObjective[],
): Promise<LearningObjectiveDiff> {
  const existing = await tx.learningObjective.findMany({
    where: { moduleId },
    select: { id: true, ref: true, description: true, sortOrder: true },
  });

  const desiredByRef = new Map(desired.map((lo) => [lo.ref, lo]));

  let created = 0;
  let updated = 0;
  let removed = 0;

  for (const e of existing) {
    if (!desiredByRef.has(e.ref)) {
      await tx.learningObjective.delete({ where: { id: e.id } });
      removed += 1;
    }
  }

  for (const lo of desired) {
    const existingRow = existing.find((e) => e.ref === lo.ref);
    if (existingRow) {
      const drift =
        existingRow.description !== lo.description ||
        existingRow.sortOrder !== lo.sortOrder;
      if (drift) {
        await tx.learningObjective.update({
          where: { id: existingRow.id },
          data: { description: lo.description, sortOrder: lo.sortOrder },
        });
        updated += 1;
      }
    } else {
      await tx.learningObjective.create({
        data: {
          moduleId,
          ref: lo.ref,
          description: lo.description,
          sortOrder: lo.sortOrder,
        },
      });
      created += 1;
    }
  }

  return { created, updated, removed };
}

/**
 * Merge the projection's configPatch into the existing Playbook.config.
 *
 * Goal-template policy: drop existing templates tagged with THIS
 * sourceContentId, append the projection's new templates. Hand-authored /
 * wizard / legacy templates (sourceContentId undefined or different) are
 * preserved untouched.
 */
export function mergeConfig(
  existing: PlaybookConfig,
  projection: CourseProjection,
  sourceContentId: string,
): { merged: PlaybookConfig; goalTemplatesWritten: number } {
  const existingGoals = (existing.goals ?? []) as GoalTemplate[];
  const nonProjectedGoals = existingGoals.filter(
    (g) => g.sourceContentId !== sourceContentId,
  );
  const newGoals: GoalTemplate[] = projection.configPatch.goalTemplates.map(
    (g: ProjectedGoalTemplate): GoalTemplate => ({
      type: g.type,
      name: g.name,
      description: g.description,
      isAssessmentTarget: g.isAssessmentTarget,
      priority: g.priority,
      sourceContentId,
      ref: g.ref,
    }),
  );

  const merged: PlaybookConfig = { ...existing };

  // Copy projection-owned fields, only when set.
  const patch = projection.configPatch;
  if (patch.modulesAuthored !== undefined && patch.modulesAuthored !== null) {
    merged.modulesAuthored = patch.modulesAuthored;
  }
  if (patch.moduleSource) merged.moduleSource = patch.moduleSource;
  if (patch.modules) merged.modules = patch.modules;
  if (patch.moduleDefaults) merged.moduleDefaults = patch.moduleDefaults;
  if (patch.outcomes) merged.outcomes = patch.outcomes;
  if (patch.progressionMode) merged.progressionMode = patch.progressionMode;
  if (patch.moduleSourceRef) merged.moduleSourceRef = patch.moduleSourceRef;
  merged.goals = [...nonProjectedGoals, ...newGoals];

  return { merged, goalTemplatesWritten: newGoals.length };
}

// ── Public entry point ─────────────────────────────────────────────────────

export async function applyProjection(
  projection: CourseProjection,
  options: ApplyProjectionOptions,
): Promise<ApplyProjectionResult> {
  const { playbookId, sourceContentId } = options;

  return prisma.$transaction(async (tx) => {
    const { map: parameterMap, created: parametersUpserted } = await upsertParameters(
      tx,
      projection.parameters,
      sourceContentId,
    );

    const btDiff = await diffBehaviorTargets(
      tx,
      projection.behaviorTargets,
      parameterMap,
      playbookId,
      sourceContentId,
    );

    const { id: curriculumId } = await ensureCurriculum(tx, playbookId);

    const cmDiff = await diffCurriculumModules(
      tx,
      projection.curriculumModules,
      curriculumId,
      sourceContentId,
    );

    const playbook = await tx.playbook.findUnique({
      where: { id: playbookId },
      select: { config: true },
    });
    if (!playbook) {
      throw new Error(`applyProjection: playbook ${playbookId} not found`);
    }
    const existingConfig = (playbook.config ?? {}) as PlaybookConfig;
    const { merged, goalTemplatesWritten } = mergeConfig(
      existingConfig,
      projection,
      sourceContentId,
    );

    await tx.playbook.update({
      where: { id: playbookId },
      data: { config: merged as Prisma.InputJsonValue },
    });

    const noop =
      parametersUpserted === 0 &&
      btDiff.created + btDiff.updated + btDiff.removed === 0 &&
      cmDiff.created + cmDiff.updated + cmDiff.removed === 0 &&
      cmDiff.loCreated + cmDiff.loUpdated + cmDiff.loRemoved === 0 &&
      // goal templates always re-written; treat unchanged template count
      // as no-op-ish but the JSON write itself is technically idempotent
      // in Prisma — we just bump updatedAt. Caller can ignore the bump.
      goalTemplatesWritten === (existingConfig.goals ?? []).filter(
        (g: GoalTemplate) => g.sourceContentId === sourceContentId,
      ).length;

    return {
      parametersUpserted,
      behaviorTargetsCreated: btDiff.created,
      behaviorTargetsUpdated: btDiff.updated,
      behaviorTargetsRemoved: btDiff.removed,
      curriculumModulesCreated: cmDiff.created,
      curriculumModulesUpdated: cmDiff.updated,
      curriculumModulesRemoved: cmDiff.removed,
      learningObjectivesCreated: cmDiff.loCreated,
      learningObjectivesUpdated: cmDiff.loUpdated,
      learningObjectivesRemoved: cmDiff.loRemoved,
      goalTemplatesWritten,
      curriculumId,
      warnings: projection.validationWarnings,
      noop,
    };
  });
}
