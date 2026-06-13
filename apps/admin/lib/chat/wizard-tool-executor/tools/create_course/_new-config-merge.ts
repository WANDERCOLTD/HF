/**
 * Stage 5 sub-helper — build the `configUpdate` object the new-path
 * persists via `updatePlaybookConfig`.
 *
 * Mirrors `_reuse-config-merge.ts` but additionally folds the
 * assessment-target → ACHIEVE-goal projection and the learning-outcome
 * → LEARN-goal projection (with #447 rubric-prose guard) onto the
 * config's `goals` array. Pure function in terms of DB access; takes
 * the existing config plus context and returns the merged shape.
 *
 * Behaviour-preserving relative to the pre-#1544 inline block at
 * create_course.ts L182-290 (new-path branch).
 */

import type { ResolvedCreateCourseContext } from "./_context";

interface BuildNewConfigUpdateOptions {
  existingConfig: Record<string, unknown>;
  ctx: ResolvedCreateCourseContext;
}

interface GoalShape {
  type: string;
  name: string;
  isAssessmentTarget?: boolean;
  isDefault?: boolean;
  priority?: number;
  ref?: string;
  sourceContentId?: string;
}

export interface BuildNewConfigUpdateResult {
  configUpdate: Record<string, unknown>;
  guardSummary?: { droppedCount: number; skippedByGate: boolean; gateReason?: string };
}

export async function buildNewConfigUpdate(
  options: BuildNewConfigUpdateOptions,
): Promise<BuildNewConfigUpdateResult> {
  const { existingConfig, ctx } = options;
  const { input, setupData, subjectDiscipline, interactionPattern } = ctx;
  const configUpdate: Record<string, unknown> = { ...existingConfig };

  if (interactionPattern) configUpdate.interactionPattern = interactionPattern;
  const newTeachingMode = (input.teachingMode as string) || (setupData?.teachingMode as string);
  if (newTeachingMode) configUpdate.teachingMode = newTeachingMode;
  if (subjectDiscipline) configUpdate.subjectDiscipline = subjectDiscipline;
  const newWelcomeMessage = (input.welcomeMessage as string) || (setupData?.welcomeMessage as string);
  if (newWelcomeMessage) configUpdate.welcomeMessage = newWelcomeMessage;
  const newSessionCount = input.sessionCount ?? setupData?.sessionCount;
  if (newSessionCount) configUpdate.sessionCount = Number(newSessionCount);
  const newDurationMins = input.durationMins ?? setupData?.durationMins;
  if (newDurationMins) configUpdate.durationMins = Number(newDurationMins);
  const newPlanEmphasis = (input.planEmphasis as string) || (setupData?.planEmphasis as string);
  if (newPlanEmphasis) configUpdate.planEmphasis = newPlanEmphasis;
  const newAudience = (input.audience as string) || (setupData?.audience as string);
  if (newAudience) configUpdate.audience = newAudience;
  const newLessonPlanModel = (input.lessonPlanModel as string) || (setupData?.lessonPlanModel as string);
  if (newLessonPlanModel) configUpdate.lessonPlanModel = newLessonPlanModel;

  // #253 follow-up: progressionMode → modulesAuthored mirror. The reuse-path
  // branch carried this from day one; the new-path branch was missing it,
  // surfacing a "Mode not set" pill on the course page.
  const newProgressionMode =
    (input.progressionMode as string) || (setupData?.progressionMode as string);
  if (newProgressionMode === "learner-picks") {
    configUpdate.modulesAuthored = true;
  } else if (newProgressionMode === "ai-led") {
    configUpdate.modulesAuthored = false;
  }
  const newPhysicalMaterials = (input.physicalMaterials as string) || (setupData?.physicalMaterials as string);
  if (newPhysicalMaterials) configUpdate.physicalMaterials = newPhysicalMaterials;
  const newCourseContext = (input.courseContext as string) || (setupData?.courseContext as string);
  if (newCourseContext) configUpdate.courseContext = newCourseContext;
  const newConstraints = (input.constraints as string[]) || (setupData?.constraints as string[]);
  if (newConstraints) configUpdate.constraints = newConstraints;

  // #167 — pedagogy carryover (mirror of reuse-path).
  const newPedagogy = setupData?.coursePedagogy as {
    lessonPlanMode?: "structured" | "continuous" | null;
    cadenceMinutesPerCall?: number | null;
    suggestedSessionCount?: number | null;
  } | undefined;
  if (newPedagogy?.lessonPlanMode) configUpdate.lessonPlanMode = newPedagogy.lessonPlanMode;
  if (newPedagogy?.cadenceMinutesPerCall && !newDurationMins) {
    configUpdate.durationMins = newPedagogy.cadenceMinutesPerCall;
  }
  if (newPedagogy?.suggestedSessionCount && !newSessionCount) {
    configUpdate.sessionCount = newPedagogy.suggestedSessionCount;
  }

  // Map assessment targets into goal templates.
  if (input.assessmentTargets) {
    const existingGoals = (configUpdate.goals as GoalShape[]) || [];
    const newAssessmentGoals: GoalShape[] = (input.assessmentTargets as string[]).map((t) => ({
      type: "ACHIEVE",
      name: t,
      isAssessmentTarget: true,
      isDefault: true,
      priority: 8,
    }));
    configUpdate.goals = [
      ...existingGoals.filter((g) => !g.isAssessmentTarget),
      ...newAssessmentGoals,
    ];
  }

  // Map learning outcomes into LEARN goals — #447 rubric-prose guard.
  // The wizard's bare LEARN templates carry no `ref` and no
  // `sourceContentId`, so applyProjection() can't diff them away later.
  // The guard runs the AI list through a regex filter + a soft gate that
  // defers entirely to projection when OUT-NN templates already exist.
  let guardSummary: BuildNewConfigUpdateResult["guardSummary"];
  const learningOutcomes = (input.learningOutcomes as string[])
    || (setupData?.learningOutcomes as string[]);
  if (learningOutcomes && learningOutcomes.length > 0) {
    const existingGoals = (configUpdate.goals as GoalShape[]) || [];
    const { guardAILearningOutcomes } = await import("@/lib/chat/wizard-ai-output-guard");
    const guard = guardAILearningOutcomes(learningOutcomes, existingGoals);
    for (const dropped of guard.filtered) {
      console.warn(
        `[wizard:guard] dropped LO "${dropped.value.slice(0, 80)}" — matches rubric pattern ${dropped.pattern}`,
      );
    }
    if (guard.skippedByGate) {
      console.log(
        `[wizard:guard] skipped AI learning-outcome extraction — ${guard.gateReason}`,
      );
    }
    if (guard.accepted.length > 0) {
      const existingNames = new Set(existingGoals.map((g) => g.name?.toLowerCase().trim()));
      const newLOGoals: GoalShape[] = guard.accepted
        .filter((lo: string) => !existingNames.has(lo.toLowerCase().trim()))
        .map((lo: string) => ({
          type: "LEARN",
          name: lo,
          isDefault: true,
          priority: 5,
        }));
      if (newLOGoals.length > 0) {
        configUpdate.goals = [...existingGoals, ...newLOGoals];
      }
    }
    guardSummary = {
      droppedCount: guard.filtered.length,
      skippedByGate: guard.skippedByGate,
      gateReason: guard.gateReason,
    };
  }

  return { configUpdate, guardSummary };
}
