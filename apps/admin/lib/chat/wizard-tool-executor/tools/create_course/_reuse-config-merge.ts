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
import {
  isTeachingMode,
  isInteractionPattern,
  isAudience,
  isPlanEmphasis,
  isLessonPlanModel,
  isLessonPlanMode,
  isProgressionMode,
} from "@/lib/content-trust/resolve-config";

/** #1995 — log-and-skip helper (mirror of `_new-config-merge.ts`). */
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

export function buildReuseConfigUpdate(
  existingConfig: Record<string, unknown>,
  ctx: ResolvedCreateCourseContext,
): Record<string, unknown> {
  const { input, setupData, subjectDiscipline, interactionPattern } = ctx;
  const configUpdate: Record<string, unknown> = { ...existingConfig };

  // #1995 — enum-validated writes (mirror of `_new-config-merge.ts`).
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
  const teachingMode = input.teachingMode ?? setupData?.teachingMode;
  if (teachingMode !== undefined && teachingMode !== null && teachingMode !== "") {
    if (isTeachingMode(teachingMode)) {
      configUpdate.teachingMode = teachingMode;
    } else {
      logSkipInvalidEnum(
        "teachingMode",
        teachingMode,
        "recall|comprehension|practice|syllabus",
      );
    }
  }
  if (subjectDiscipline) configUpdate.subjectDiscipline = subjectDiscipline;
  const welcomeMessage = (input.welcomeMessage as string) || (setupData?.welcomeMessage as string);
  if (welcomeMessage) configUpdate.welcomeMessage = welcomeMessage;
  const sessionCount = input.sessionCount ?? setupData?.sessionCount;
  if (sessionCount) configUpdate.sessionCount = Number(sessionCount);
  const durationMins = input.durationMins ?? setupData?.durationMins;
  if (durationMins) configUpdate.durationMins = Number(durationMins);
  const planEmphasis = input.planEmphasis ?? setupData?.planEmphasis;
  if (planEmphasis !== undefined && planEmphasis !== null && planEmphasis !== "") {
    if (isPlanEmphasis(planEmphasis)) {
      // configUpdate is a free-form object; assignment site is enum-typed via PlaybookConfig
      (configUpdate as Record<string, unknown>).planEmphasis = planEmphasis;
    } else {
      logSkipInvalidEnum("planEmphasis", planEmphasis, "breadth|balanced|depth");
    }
  }
  const audience = input.audience ?? setupData?.audience;
  if (audience !== undefined && audience !== null && audience !== "") {
    if (isAudience(audience)) {
      configUpdate.audience = audience;
    } else {
      logSkipInvalidEnum(
        "audience",
        audience,
        "primary|secondary|sixth-form|higher-ed|adult-professional|adult-casual|mixed",
      );
    }
  }
  const lessonPlanModel = input.lessonPlanModel ?? setupData?.lessonPlanModel;
  if (lessonPlanModel !== undefined && lessonPlanModel !== null && lessonPlanModel !== "") {
    if (isLessonPlanModel(lessonPlanModel)) {
      configUpdate.lessonPlanModel = lessonPlanModel;
    } else {
      logSkipInvalidEnum(
        "lessonPlanModel",
        lessonPlanModel,
        "direct_instruction|socratic|5e|spiral|mastery|project",
      );
    }
  }
  const physicalMaterials = (input.physicalMaterials as string) || (setupData?.physicalMaterials as string);
  if (physicalMaterials) configUpdate.physicalMaterials = physicalMaterials;
  const courseContext = (input.courseContext as string) || (setupData?.courseContext as string);
  if (courseContext) configUpdate.courseContext = courseContext;
  const constraints = (input.constraints as string[]) || (setupData?.constraints as string[]);
  if (constraints) configUpdate.constraints = constraints;

  // #253: progressionMode — wizard's mandatory choice between AI-led teaching
  // (scheduler picks each call) and learner-picks (picker shows authored
  // modules). Maps to PlaybookConfig.modulesAuthored.
  const progressionMode = input.progressionMode ?? setupData?.progressionMode;
  if (progressionMode !== undefined && progressionMode !== null && progressionMode !== "") {
    if (isProgressionMode(progressionMode)) {
      if (progressionMode === "learner-picks") {
        configUpdate.modulesAuthored = true;
      } else if (progressionMode === "ai-led") {
        configUpdate.modulesAuthored = false;
      }
    } else {
      logSkipInvalidEnum("progressionMode", progressionMode, "learner-picks|ai-led");
    }
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
  if (pedagogy?.lessonPlanMode && isLessonPlanMode(pedagogy.lessonPlanMode)) {
    configUpdate.lessonPlanMode = pedagogy.lessonPlanMode;
  } else if (pedagogy?.lessonPlanMode) {
    logSkipInvalidEnum(
      "lessonPlanMode",
      pedagogy.lessonPlanMode,
      "structured|continuous",
    );
  } else if (configUpdate.lessonPlanMode === undefined) {
    // Reuse-path inference: when modules are already authored on the
    // existing playbook (the canonical signal that the course IS
    // structured), default to `"structured"`. Prevents the admin
    // Modules tab from hiding authored modules under a default-deny
    // `lessonPlanMode === undefined → "continuous"` fall-through.
    // The pipeline runtime contract (`lib/pipeline/course-style.ts`
    // strict `=== "structured"` default-deny) is unaffected; this is
    // wizard authoring inference at write time.
    const existingModules = Array.isArray(existingConfig.modules)
      ? existingConfig.modules
      : null;
    if (existingModules && existingModules.length > 0) {
      configUpdate.lessonPlanMode = "structured";
    } else if (pedagogy !== undefined) {
      // Course-ref upload but no explicit pedagogy.lessonPlanMode and
      // no modules yet on the playbook — still default to "structured"
      // for the same reason as the new-path: course-ref upload is the
      // operator's canonical declaration of course shape.
      configUpdate.lessonPlanMode = "structured";
    }
  }
  if (pedagogy?.cadenceMinutesPerCall && !durationMins) {
    configUpdate.durationMins = pedagogy.cadenceMinutesPerCall;
  }
  if (pedagogy?.suggestedSessionCount && !sessionCount) {
    configUpdate.sessionCount = pedagogy.suggestedSessionCount;
  }

  return configUpdate;
}
