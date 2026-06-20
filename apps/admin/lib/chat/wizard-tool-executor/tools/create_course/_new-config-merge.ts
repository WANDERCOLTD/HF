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
import {
  isTeachingMode,
  isInteractionPattern,
  isAudience,
  isPlanEmphasis,
  isLessonPlanModel,
  isProgressionMode,
} from "@/lib/content-trust/resolve-config";

/**
 * #1995 — log-and-skip helper for invalid enum-bearing wizard fields.
 *
 * The chat-tool merge paths used to accept whatever string the AI
 * returned and write it straight to `Playbook.config`. The live IELTS
 * Speaking Practice incident (2026-06-18) showed this fails silently —
 * `teachingMode = "directive"` reached the DB and crashed every
 * ComposedPrompt build. We now reject (with structured log) rather
 * than crash: the merge proceeds for valid fields, the invalid field
 * is dropped, and the operator's other edits land cleanly.
 */
function logSkipInvalidEnum(
  field: string,
  value: unknown,
  validValues: string,
): void {
  console.warn(
    `[wizard:guard] dropped ${field} write — invalid value ${JSON.stringify(value)} ` +
      `not in {${validValues}}. ` +
      `Story #1995 — chat-tool enum validation. The AI returned a value outside the ` +
      `union; merge proceeds for the other fields.`,
  );
}

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

  // #1995 — enum-validated writes. The pre-#1995 path took whatever string
  // the AI returned and cast to `string`. The live IELTS Speaking Practice
  // incident on hf_sandbox showed that the AI sometimes returns a value
  // from the wrong union (e.g. `teachingMode = "directive"`, which is an
  // `interactionPattern` value). Every assignment below is now guarded.
  if (interactionPattern) {
    if (isInteractionPattern(interactionPattern)) {
      configUpdate.interactionPattern = interactionPattern;
    } else {
      logSkipInvalidEnum(
        "interactionPattern",
        interactionPattern,
        "socratic|directive|advisory|coaching|companion|facilitation|reflective|open|conversational-guide",
      );
    }
  }
  const newTeachingMode = input.teachingMode ?? setupData?.teachingMode;
  if (newTeachingMode !== undefined && newTeachingMode !== null && newTeachingMode !== "") {
    if (isTeachingMode(newTeachingMode)) {
      configUpdate.teachingMode = newTeachingMode;
    } else {
      logSkipInvalidEnum(
        "teachingMode",
        newTeachingMode,
        "recall|comprehension|practice|syllabus",
      );
    }
  }
  if (subjectDiscipline) configUpdate.subjectDiscipline = subjectDiscipline;
  const newWelcomeMessage = (input.welcomeMessage as string) || (setupData?.welcomeMessage as string);
  if (newWelcomeMessage) configUpdate.welcomeMessage = newWelcomeMessage;
  const newSessionCount = input.sessionCount ?? setupData?.sessionCount;
  if (newSessionCount) configUpdate.sessionCount = Number(newSessionCount);
  const newDurationMins = input.durationMins ?? setupData?.durationMins;
  if (newDurationMins) configUpdate.durationMins = Number(newDurationMins);
  const newPlanEmphasis = input.planEmphasis ?? setupData?.planEmphasis;
  if (newPlanEmphasis !== undefined && newPlanEmphasis !== null && newPlanEmphasis !== "") {
    if (isPlanEmphasis(newPlanEmphasis)) {
      (configUpdate as Record<string, unknown>).planEmphasis = newPlanEmphasis;
    } else {
      logSkipInvalidEnum("planEmphasis", newPlanEmphasis, "breadth|balanced|depth");
    }
  }
  const newAudience = input.audience ?? setupData?.audience;
  if (newAudience !== undefined && newAudience !== null && newAudience !== "") {
    if (isAudience(newAudience)) {
      configUpdate.audience = newAudience;
    } else {
      logSkipInvalidEnum(
        "audience",
        newAudience,
        "primary|secondary|sixth-form|higher-ed|adult-professional|adult-casual|mixed",
      );
    }
  }
  const newLessonPlanModel = input.lessonPlanModel ?? setupData?.lessonPlanModel;
  if (newLessonPlanModel !== undefined && newLessonPlanModel !== null && newLessonPlanModel !== "") {
    if (isLessonPlanModel(newLessonPlanModel)) {
      configUpdate.lessonPlanModel = newLessonPlanModel;
    } else {
      logSkipInvalidEnum(
        "lessonPlanModel",
        newLessonPlanModel,
        "direct_instruction|socratic|5e|spiral|mastery|project",
      );
    }
  }

  // #253 follow-up: progressionMode → modulesAuthored mirror. The reuse-path
  // branch carried this from day one; the new-path branch was missing it,
  // surfacing a "Mode not set" pill on the course page.
  const newProgressionMode = input.progressionMode ?? setupData?.progressionMode;
  if (newProgressionMode !== undefined && newProgressionMode !== null && newProgressionMode !== "") {
    if (isProgressionMode(newProgressionMode)) {
      if (newProgressionMode === "learner-picks") {
        configUpdate.modulesAuthored = true;
      } else if (newProgressionMode === "ai-led") {
        configUpdate.modulesAuthored = false;
      }
    } else {
      logSkipInvalidEnum(
        "progressionMode",
        newProgressionMode,
        "learner-picks|ai-led",
      );
    }
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existingGoals = (configUpdate.goals as any[]) || [];
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existingNames = new Set(existingGoals.map((g: any) => g.name?.toLowerCase().trim()));
      const newLOGoals = guard.accepted
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
