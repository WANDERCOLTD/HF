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
import { updatePlaybookConfig } from "@/lib/playbook/update-playbook-config";
import { assertValidLoRefBatch } from "@/lib/curriculum/validate-lo-refs";
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
  ProjectedMeasureSpec,
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
  /** #417 — id of the upserted MEASURE spec, null when projection has no skills. */
  measureSpecId: string | null;
  /** #417 — count of trigger rows attached to the MEASURE spec after upsert. */
  measureTriggerCount: number;
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
    // #500 PR-2 — persist bandThresholds on Parameter.config when present.
    // Sprint 2 SP2-B+ (2026-06-13) — also persist tierScheme + tiers so the
    // Skills Framework Inspector lens reads the rubric directly from
    // Parameter.config without a ContentAssertion-text fallback.
    const configEntries: Record<string, unknown> = {};
    if (p.bandThresholds && Object.keys(p.bandThresholds).length > 0) {
      configEntries.bandThresholds = p.bandThresholds;
    }
    if (p.tierScheme && p.tierScheme.length > 0) {
      configEntries.tierScheme = [...p.tierScheme];
    }
    if (p.tiers && Object.keys(p.tiers).length > 0) {
      configEntries.tiers = p.tiers;
    }
    const config = Object.keys(configEntries).length > 0 ? configEntries : undefined;

    const existing = await tx.parameter.findUnique({
      where: { parameterId: p.name },
      select: { parameterId: true, config: true },
    });

    if (existing) {
      map.set(p.name, existing.parameterId);
      // Keep config in sync if the doc gained or changed any of the merged keys.
      // Merge rather than replace so prior `bandThresholds` from the rubric pass
      // aren't blown away when the main projection runs without them.
      if (config) {
        const merged = { ...((existing.config as Record<string, unknown>) ?? {}), ...config };
        await tx.parameter.update({
          where: { parameterId: p.name },
          data: { config: merged as any },
        });
      }
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
        ...(config ? { config: config as any } : {}),
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
    select: { id: true, parameterId: true, targetValue: true, skillRef: true },
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
      // #417: persist skillRef even on updates (existing rows pre-#417 have NULL).
      if (
        existingRow.targetValue !== target.targetValue ||
        existingRow.skillRef !== target.skillRef
      ) {
        await tx.behaviorTarget.update({
          where: { id: existingRow.id },
          data: {
            targetValue: target.targetValue,
            skillRef: target.skillRef,
          },
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
          // #417: persist skillRef so Goal.ref → BehaviorTarget.skillRef →
          // parameterId resolution works at goal-progress time.
          skillRef: target.skillRef,
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
  // #1034 / #1177 Slice 6 — canonical PlaybookCurriculum join only.
  // Variant Playbooks may already be linked to the parent's Curriculum via
  // a `linked` row; in that case the wizard projection should target the
  // SHARED Curriculum, not create a fork. The deprecated
  // Curriculum.playbookId fallback was removed in #1038 (backfill ensured
  // 100% join-row coverage).
  const existingLink = await tx.playbookCurriculum.findFirst({
    where: { playbookId },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: { curriculumId: true },
  });
  if (existingLink) return { id: existingLink.curriculumId, created: false };

  // #1081 Slice 2B.2 — anchor-aware sibling-link. Before minting a fresh
  // Curriculum, see if this Playbook's domain already hosts a Curriculum
  // teaching the same regulated qualification. If so, LINK the new Playbook
  // via PlaybookCurriculum(role: "linked") and reuse the shared Curriculum.
  // Mastery sharing flows naturally from the shared CurriculumModule UUIDs
  // (CC-E in docs/chain-contracts.md).
  //
  // We pull qualification metadata from the Playbook's primary Subject
  // (Subject.qualificationBody + Subject.qualificationRef) — that's the
  // existing source-of-truth for Curriculum.qualificationBody /
  // qualificationNumber. See app/api/subjects/[subjectId]/curriculum
  // route.ts:228-230.
  const { deriveQualificationAnchor, isAnchorSafe } = await import(
    "@/lib/curriculum/qualification-anchor"
  );
  const { findCurriculumByAnchor, QualificationAnchorAmbiguity } = await import(
    "@/lib/curriculum/find-sibling-curricula"
  );

  const playbookForAnchor = await tx.playbook.findUnique({
    where: { id: playbookId },
    select: {
      domainId: true,
      subjects: {
        orderBy: { createdAt: "asc" },
        take: 1,
        select: {
          subject: {
            select: {
              qualificationBody: true,
              qualificationRef: true,
            },
          },
        },
      },
    },
  });

  const subjectForAnchor = playbookForAnchor?.subjects[0]?.subject;
  const derivedAnchor = subjectForAnchor
    ? deriveQualificationAnchor(
        subjectForAnchor.qualificationBody,
        subjectForAnchor.qualificationRef,
      )
    : null;

  // Anchor-aware sibling lookup — only when derived anchor passes the
  // AI-to-DB safety guard. Unsafe anchors fall through to mint-fresh with
  // the anchor still stamped for labelling.
  if (derivedAnchor && isAnchorSafe(derivedAnchor) && playbookForAnchor?.domainId) {
    try {
      // findCurriculumByAnchor uses the outer prisma client, not tx — sibling
      // search reads committed state, not in-flight tx data. That's correct
      // here: we want to avoid linking to a Curriculum being created in
      // a racing transaction.
      const sibling = await findCurriculumByAnchor(
        derivedAnchor,
        playbookForAnchor.domainId,
      );
      if (sibling) {
        // Link the new Playbook to the existing sibling Curriculum.
        await tx.playbookCurriculum.create({
          data: {
            playbookId,
            curriculumId: sibling.id,
            role: "linked",
          },
        });
        console.log(
          `[apply-projection] Linked playbook ${playbookId} to sibling ` +
            `Curriculum ${sibling.id} via qualificationAnchor="${derivedAnchor}"`,
        );
        return { id: sibling.id, created: false };
      }
    } catch (err: unknown) {
      if (err instanceof QualificationAnchorAmbiguity) {
        // Refuse to guess — surface to caller.
        throw err;
      }
      throw err;
    }
  } else if (derivedAnchor && !isAnchorSafe(derivedAnchor)) {
    console.warn(
      `[apply-projection] derived qualificationAnchor failed safety check, ` +
        `treating as null for sibling lookup (still stamped for labelling): ` +
        `"${derivedAnchor}"`,
    );
  }

  const created = await tx.curriculum.create({
    data: {
      slug: `course-${playbookId.slice(0, 8)}-${Date.now()}`,
      name: "Authored modules",
      // #1081 Slice 2B.2 — stamp the derived anchor on the new Curriculum
      // so subsequent siblings in the same domain find it. Null when no
      // qualification metadata is available.
      qualificationAnchor: derivedAnchor,
    },
    select: { id: true },
  });
  // #1177 Slice 6 / #1038 — Curriculum.playbookId column dropped. Ownership
  // lives entirely in PlaybookCurriculum (primary join row written below).
  await tx.playbookCurriculum.create({
    data: {
      playbookId,
      curriculumId: created.id,
      role: "primary",
    },
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
    select: { id: true, slug: true, title: true, sortOrder: true, estimatedDurationMinutes: true, coversModules: true },
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
      const desiredCovers = m.coversModules ?? [];
      const existingCovers = existingRow.coversModules ?? [];
      const coversDrift =
        desiredCovers.length !== existingCovers.length ||
        desiredCovers.some((s, i) => s !== existingCovers[i]);
      const drift =
        existingRow.title !== m.title ||
        existingRow.sortOrder !== m.sortOrder ||
        existingRow.estimatedDurationMinutes !== (m.estimatedDurationMinutes ?? null) ||
        coversDrift;
      if (drift) {
        await tx.curriculumModule.update({
          where: { id: existingRow.id },
          data: {
            title: m.title,
            sortOrder: m.sortOrder,
            estimatedDurationMinutes: m.estimatedDurationMinutes,
            description: m.description,
            coversModules: desiredCovers,
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
          coversModules: m.coversModules ?? [],
        },
        select: { id: true },
      });
      moduleId = createdRow.id;
      created += 1;
    }

    // Sync LearningObjective rows for this module. Key: (moduleId, ref).
    // Issue #365.
    const loDiff = await diffLearningObjectives(tx, moduleId, m.learningObjectives, m.slug);
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
  moduleSlug?: string,
): Promise<LearningObjectiveDiff> {
  // #1117 — reject placeholder refs + duplicates before any DB write.
  // Applies to both CERTIFIED and UNCERTIFIED courses (anchor-agnostic).
  assertValidLoRefBatch(desired.map((lo) => lo.ref), moduleSlug);

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
      // #444 — pass authored strategy through to Playbook.config.goals[]
      // so instantiate-goals.ts copies it onto the Goal row verbatim.
      progressStrategy: g.progressStrategy,
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
  // #UI-followup Gap 1 — write scoringMode through so event-gate can
  // auto-detect evidence-first playbooks.
  if (patch.scoringMode) (merged as Record<string, unknown>).scoringMode = patch.scoringMode;

  // #1253 — persist detected lessonPlanMode so the runtime pipeline can
  // resolve courseStyle without re-deriving from heuristics. NEVER overwrite
  // an explicit operator setting — detect-pedagogy is advisory, not
  // authoritative. The default-deny rule in `getCourseStyle` means a
  // missing value resolves to "continuous", so we only write when the
  // detector found something AND no value is currently set.
  if (
    projection.pedagogy?.lessonPlanMode &&
    existing.lessonPlanMode === undefined
  ) {
    merged.lessonPlanMode = projection.pedagogy.lessonPlanMode;
  }

  merged.goals = [...nonProjectedGoals, ...newGoals];

  return { merged, goalTemplatesWritten: newGoals.length };
}

/**
 * #417 Phase B — upsert the per-playbook MEASURE spec that scores
 * `skill_*` parameters on each call.
 *
 * Update-in-place by slug (`skill-measure-<playbookId-prefix>`). Triggers
 * and actions are replaced wholesale on every projection — the spec row
 * itself stays put so `CallScore.analysisSpecId` history is preserved
 * (FK is `onDelete: SetNull` but we'd rather not churn it).
 *
 * Side effects:
 *   • Spec is marked `isDirty: false` + `compiledAt: NOW()` so the
 *     spec-loader includes it (`specs-loader.ts:147-152` filters on
 *     `isDirty: false`).
 *   • A `PlaybookItem` row is upserted linking the spec to the playbook
 *     with `itemType: SPEC, isEnabled: true` — without this row the
 *     spec-loader's playbook scope filter excludes the spec entirely.
 *
 * Returns null when the projection has no skills (no spec to write).
 */
async function upsertMeasureSpec(
  tx: Tx,
  measureSpec: ProjectedMeasureSpec | undefined,
  parameterMap: Map<string, string>,
  playbookId: string,
  sourceContentId: string,
): Promise<{ specId: string | null; triggerCount: number }> {
  if (!measureSpec || measureSpec.triggers.length === 0) {
    return { specId: null, triggerCount: 0 };
  }

  // Look up the playbook's domain so the spec is filterable by
  // domain-scoped queries (the spec-loader path uses both PlaybookItem
  // membership AND domain match).
  const playbook = await tx.playbook.findUnique({
    where: { id: playbookId },
    select: { domainId: true },
  });
  if (!playbook) {
    throw new Error(`upsertMeasureSpec: playbook ${playbookId} not found`);
  }
  const domain = await tx.domain.findUnique({
    where: { id: playbook.domainId },
    select: { slug: true },
  });

  const slug = `skill-measure-${playbookId.slice(0, 8)}`;
  const now = new Date();

  // Upsert the spec itself. Deterministic generation — mark clean.
  const spec = await tx.analysisSpec.upsert({
    where: { slug },
    create: {
      slug,
      name: measureSpec.name,
      description: measureSpec.description,
      scope: "DOMAIN",
      outputType: "MEASURE",
      specType: "DOMAIN",
      specRole: "MEASURE",
      domain: domain?.slug ?? null,
      priority: 10,
      isActive: true,
      isDirty: false,
      compiledAt: now,
    },
    update: {
      name: measureSpec.name,
      description: measureSpec.description,
      domain: domain?.slug ?? null,
      isActive: true,
      isDirty: false,
      compiledAt: now,
    },
    select: { id: true },
  });

  // Replace triggers + actions wholesale. Cleaner than diffing per-skill;
  // the spec is small (4 triggers for IELTS) so this is cheap.
  await tx.analysisTrigger.deleteMany({ where: { specId: spec.id } });
  for (let i = 0; i < measureSpec.triggers.length; i++) {
    const trig = measureSpec.triggers[i];
    await tx.analysisTrigger.create({
      data: {
        specId: spec.id,
        name: trig.name,
        given: trig.given,
        when: trig.when,
        then: trig.then,
        sortOrder: i,
        // Notes carry the skillRef so it's available without joining BehaviorTarget
        // — useful for debugging and for any AI prompt that wants to surface it.
        notes: `skillRef:${trig.skillRef} (#417)`,
        actions: {
          create: trig.actions.map((act, j) => {
            const paramId = parameterMap.get(act.parameterName);
            if (!paramId) {
              throw new Error(
                `upsertMeasureSpec: parameter "${act.parameterName}" not found in parameterMap. ` +
                  `Did the projection emit a BehaviorTarget for it first?`,
              );
            }
            return {
              description: act.description,
              parameterId: paramId,
              weight: act.weight,
              sortOrder: j,
            };
          }),
        },
      },
    });
  }

  // Link the spec to the playbook so specs-loader picks it up. No
  // composite unique on (playbookId, specId), so emulate upsert with a
  // findFirst + create/update.
  const existingLink = await tx.playbookItem.findFirst({
    where: { playbookId, specId: spec.id },
    select: { id: true, isEnabled: true },
  });
  if (existingLink) {
    if (!existingLink.isEnabled) {
      await tx.playbookItem.update({
        where: { id: existingLink.id },
        data: { isEnabled: true },
      });
    }
  } else {
    await tx.playbookItem.create({
      data: {
        playbookId,
        specId: spec.id,
        itemType: "SPEC",
        isEnabled: true,
        groupId: "SKILL_MEASURE",
        groupLabel: "Per-skill scoring (#417)",
        sortOrder: 100,
      },
    });
  }

  // (sourceContentId is intentionally unused here — the spec is shared
  // per-playbook regardless of which source produced it; dedup is by slug.)
  void sourceContentId;

  return { specId: spec.id, triggerCount: measureSpec.triggers.length };
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

    // #417 Phase B — upsert the per-playbook MEASURE spec for `skill_*`
    // scoring. Must run AFTER BehaviorTarget diff so the parameterMap is
    // populated; the spec's actions reference parameters by id.
    const specUpsert = await upsertMeasureSpec(
      tx,
      projection.measureSpec,
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

    // #827 (Story 3) — config write LIFTED OUT of the transaction (see
    // post-tx block below). The helper does its own findUnique + update
    // which can't participate in this interactive transaction's tx client.
    //
    // Trade-off: if the post-tx config write fails, parameter/behaviorTarget/
    // module rows are committed but config + timestamp lag. applyProjection
    // is idempotent (per file header) — re-running brings config back in
    // line. The orphan-state window is the network round-trip between
    // tx commit and the helper's update.
    //
    // Stash merged config + count in the tx return so the post-tx block
    // can apply it.
    const _mergedConfigForPostTx = merged;
    const _goalTemplatesWrittenForPostTx = goalTemplatesWritten;

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
      measureSpecId: specUpsert.specId,
      measureTriggerCount: specUpsert.triggerCount,
      warnings: projection.validationWarnings,
      noop,
      // #827 — pass merged config out of the tx for the post-commit
      // updatePlaybookConfig call below.
      __postTxMergedConfig: _mergedConfigForPostTx,
    };
  }).then(async (txResult) => {
    // #827 — post-tx config write + composeInputsUpdatedAt bump via the
    // central helper. See lifted-out comment inside the tx for trade-off
    // rationale (orphan-state window if this fails — re-run is idempotent).
    await updatePlaybookConfig(
      playbookId,
      () => txResult.__postTxMergedConfig as PlaybookConfig,
      { reason: "apply-projection post-tx config write" },
    );
    // Strip the internal carry-out before returning.
    const { __postTxMergedConfig: _drop, ...publicResult } = txResult;
    return publicResult;
  });
}


// ── Rubric band-thresholds writer (#564) ────────────────────────────────────

/**
 * Mapping from rubric criterion code (e.g. "fc") to its band → descriptor
 * lookup. Built by parseRubricBands() and consumed by writeBandThresholds()
 * to update Parameter.config on existing skill parameters.
 */
export type RubricBandMap = Map<string, Record<string, string>>;

export interface WriteBandThresholdsResult {
  parametersUpdated: number;
  /** Codes for which no matching skill parameter was found. */
  unmatchedCodes: string[];
}

/**
 * Apply per-band descriptor maps to existing skill Parameter rows.
 *
 * Matching strategy: for each criterion code (e.g. "fc"), find the unique
 * skill parameter whose `parameterId` ends with `_<code>` (case-insensitive),
 * scoped to `parameterId LIKE 'skill_%'` to avoid false positives.
 *
 * Idempotent: re-running with the same input produces no changes beyond
 * `updatedAt`. Never creates new parameters — matches against existing
 * ones written by the main projection pass.
 *
 * Issue #564.
 */
export async function writeBandThresholds(
  options: {
    playbookId: string;
    sourceContentId: string;
    /**
     * Optional per-code criterion name from the rubric heading. When the
     * suffix-match fails (e.g. fresh-course Parameters that lack the
     * `_fc`/`_lr` suffix), the matcher falls back to slugifying this name
     * and looking for `skill_<slug>`. Passing this map widens compatibility
     * to current-projection courses where `skillNameToParameterName()`
     * produced unsuffixed IDs.
     */
    criterionByCode?: Record<string, string>;
  },
  bandMap: RubricBandMap,
): Promise<WriteBandThresholdsResult> {
  if (bandMap.size === 0) {
    return { parametersUpdated: 0, unmatchedCodes: [] };
  }

  const result: WriteBandThresholdsResult = {
    parametersUpdated: 0,
    unmatchedCodes: [],
  };

  // Pull all skill parameters in one query — small set (≤ a dozen rows).
  const skillParams = await prisma.parameter.findMany({
    where: { parameterId: { startsWith: "skill_" } },
    select: { parameterId: true, config: true },
  });

  const slugifySkillName = (name: string) =>
    name
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

  for (const [code, bands] of bandMap) {
    const suffix = `_${code.toLowerCase()}`;
    // Strategy 1: suffix match (legacy projection output e.g. _fc / _lr).
    let match = skillParams.find((p) => p.parameterId.toLowerCase().endsWith(suffix));

    // Strategy 2: name-derived match for fresh courses where the projection
    // wrote unsuffixed Parameter IDs. Requires the caller to pass the
    // criterion-name lookup keyed by code.
    if (!match && options.criterionByCode?.[code]) {
      const target = `skill_${slugifySkillName(options.criterionByCode[code])}`;
      match = skillParams.find((p) => p.parameterId.toLowerCase() === target);
    }

    if (!match) {
      result.unmatchedCodes.push(code);
      continue;
    }

    const existing = (match.config as Record<string, unknown> | null) ?? {};
    const merged = {
      ...existing,
      bandThresholds: bands,
    };

    await prisma.parameter.update({
      where: { parameterId: match.parameterId },
      data: { config: merged as Prisma.InputJsonValue },
    });
    result.parametersUpdated += 1;
  }

  if (result.unmatchedCodes.length > 0) {
    console.warn(
      `[apply-projection] writeBandThresholds: no skill parameter matched RUB codes ` +
        `[${result.unmatchedCodes.join(", ")}] (playbook=${options.playbookId} source=${options.sourceContentId})`,
    );
  }

  return result;
}
