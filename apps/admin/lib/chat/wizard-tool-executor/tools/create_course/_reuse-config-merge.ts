/**
 * Stage 4 sub-helper — build the `configUpdate` object the reuse-path
 * persists via `updatePlaybookConfig`.
 *
 * Walks the `(input.<field> || setupData?.<field>)` cascade for every
 * field the wizard surfaces on the existing-course branch and threads
 * Stage 3's resolved subjectDiscipline + Stage 4's interactionPattern
 * through. Returns the merged object; the caller hands it to
 * `updatePlaybookConfig`.
 *
 * Behaviour-preserving relative to the pre-#1544 inline block at
 * create_course.ts L73-129. Pure function — no DB access, no imports
 * beyond types.
 */

import type { ResolvedCreateCourseContext } from "./_context";

export function buildReuseConfigUpdate(
  existingConfig: Record<string, unknown>,
  ctx: ResolvedCreateCourseContext,
): Record<string, unknown> {
  const { input, setupData, subjectDiscipline, interactionPattern } = ctx;
  const configUpdate: Record<string, unknown> = { ...existingConfig };

  if (interactionPattern) configUpdate.interactionPattern = interactionPattern;
  const teachingMode = (input.teachingMode as string) || (setupData?.teachingMode as string);
  if (teachingMode) configUpdate.teachingMode = teachingMode;
  if (subjectDiscipline) configUpdate.subjectDiscipline = subjectDiscipline;
  const welcomeMessage = (input.welcomeMessage as string) || (setupData?.welcomeMessage as string);
  if (welcomeMessage) configUpdate.welcomeMessage = welcomeMessage;
  const sessionCount = input.sessionCount ?? setupData?.sessionCount;
  if (sessionCount) configUpdate.sessionCount = Number(sessionCount);
  const durationMins = input.durationMins ?? setupData?.durationMins;
  if (durationMins) configUpdate.durationMins = Number(durationMins);
  const planEmphasis = (input.planEmphasis as string) || (setupData?.planEmphasis as string);
  if (planEmphasis) configUpdate.planEmphasis = planEmphasis;
  const audience = (input.audience as string) || (setupData?.audience as string);
  if (audience) configUpdate.audience = audience;
  const lessonPlanModel = (input.lessonPlanModel as string) || (setupData?.lessonPlanModel as string);
  if (lessonPlanModel) configUpdate.lessonPlanModel = lessonPlanModel;
  const physicalMaterials = (input.physicalMaterials as string) || (setupData?.physicalMaterials as string);
  if (physicalMaterials) configUpdate.physicalMaterials = physicalMaterials;
  const courseContext = (input.courseContext as string) || (setupData?.courseContext as string);
  if (courseContext) configUpdate.courseContext = courseContext;
  const constraints = (input.constraints as string[]) || (setupData?.constraints as string[]);
  if (constraints) configUpdate.constraints = constraints;

  // #253: progressionMode — wizard's mandatory choice between AI-led teaching
  // (scheduler picks each call) and learner-picks (picker shows authored
  // modules). Maps to PlaybookConfig.modulesAuthored.
  const progressionMode =
    (input.progressionMode as string) || (setupData?.progressionMode as string);
  if (progressionMode === "learner-picks") {
    configUpdate.modulesAuthored = true;
  } else if (progressionMode === "ai-led") {
    configUpdate.modulesAuthored = false;
  }

  // #167 — Carry through pedagogy detected from an uploaded course reference.
  //   lessonPlanMode "continuous" lets the scheduler decide per call.
  //   cadenceMinutesPerCall overrides durationMins. suggestedSessionCount
  //   overrides sessionCount when set.
  const pedagogy = setupData?.coursePedagogy as {
    lessonPlanMode?: "structured" | "continuous" | null;
    cadenceMinutesPerCall?: number | null;
    suggestedSessionCount?: number | null;
  } | undefined;
  if (pedagogy?.lessonPlanMode) {
    configUpdate.lessonPlanMode = pedagogy.lessonPlanMode;
  }
  if (pedagogy?.cadenceMinutesPerCall && !durationMins) {
    configUpdate.durationMins = pedagogy.cadenceMinutesPerCall;
  }
  if (pedagogy?.suggestedSessionCount && !sessionCount) {
    configUpdate.sessionCount = pedagogy.suggestedSessionCount;
  }

  return configUpdate;
}
