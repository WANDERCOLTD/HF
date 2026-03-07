/**
 * Lesson Plan Defaults — 3-layer cascade resolver.
 *
 * Resolution order:
 *   Domain.lessonPlanDefaults (per-institution) →
 *   SystemSettings (global) →
 *   LESSON_PLAN_DEFAULTS (hardcoded fallback)
 *
 * Used by IntentStep (eager plan generation) and LessonPlanStep (intents panel).
 */

import { getLessonPlanSettings, type LessonPlanSettings } from "@/lib/system-settings";
import { prisma } from "@/lib/prisma";

export type { LessonPlanSettings };

/** Source of each resolved value — used by domain defaults UI for SYS/OVR badges. */
export type LessonPlanDefaultsWithSource = {
  [K in keyof LessonPlanSettings]: {
    value: LessonPlanSettings[K];
    source: "system" | "domain";
  };
};

/**
 * Resolve lesson plan defaults with cascade:
 *   Domain (if provided and has overrides) → SystemSettings → Hardcoded defaults.
 */
export async function getLessonPlanDefaults(
  domainId?: string | null,
): Promise<LessonPlanSettings> {
  const system = await getLessonPlanSettings();
  if (!domainId) return system;

  const domain = await prisma.domain.findUnique({
    where: { id: domainId },
    select: { lessonPlanDefaults: true },
  });

  if (!domain?.lessonPlanDefaults) return system;
  const overrides = domain.lessonPlanDefaults as Partial<LessonPlanSettings>;

  return {
    sessionCount: overrides.sessionCount ?? system.sessionCount,
    durationMins: overrides.durationMins ?? system.durationMins,
    emphasis: overrides.emphasis ?? system.emphasis,
    assessments: overrides.assessments ?? system.assessments,
    lessonPlanModel: overrides.lessonPlanModel ?? system.lessonPlanModel,
    audience: overrides.audience ?? system.audience,
  };
}

/**
 * Resolve with source badges — for domain defaults UI.
 * Shows whether each value comes from "system" or "domain" override.
 */
export async function getLessonPlanDefaultsWithSource(
  domainId: string,
): Promise<LessonPlanDefaultsWithSource> {
  const system = await getLessonPlanSettings();

  const domain = await prisma.domain.findUnique({
    where: { id: domainId },
    select: { lessonPlanDefaults: true },
  });

  const overrides = (domain?.lessonPlanDefaults as Partial<LessonPlanSettings>) ?? {};

  const keys: Array<keyof LessonPlanSettings> = [
    "sessionCount",
    "durationMins",
    "emphasis",
    "assessments",
    "lessonPlanModel",
    "audience",
  ];

  const result = {} as LessonPlanDefaultsWithSource;
  for (const key of keys) {
    const domainVal = overrides[key];
    if (domainVal != null) {
      (result as any)[key] = { value: domainVal, source: "domain" };
    } else {
      (result as any)[key] = { value: system[key], source: "system" };
    }
  }

  return result;
}
