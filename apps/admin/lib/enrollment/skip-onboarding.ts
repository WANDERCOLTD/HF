import { prisma } from "@/lib/prisma";
import { SURVEY_SCOPES, PRE_SURVEY_KEYS, POST_SURVEY_KEYS } from "@/lib/learner/survey-keys";
// initializeLessonPlanSession removed — scheduler replaces session tracking

/**
 * Skip onboarding for a caller: marks OnboardingSession complete,
 * marks pre/post surveys as submitted, and initializes lesson plan
 * to the first teaching session.
 *
 * Shared by POST /api/callers and POST /api/sim/setup.
 */
export async function applySkipOnboarding(
  callerId: string,
  domainId: string,
): Promise<void> {
  await prisma.onboardingSession.upsert({
    where: { callerId_domainId: { callerId, domainId } },
    create: {
      callerId,
      domainId,
      isComplete: true,
      wasSkipped: true,
      completedAt: new Date(),
    },
    update: {
      isComplete: true,
      wasSkipped: true,
      completedAt: new Date(),
    },
  });

  // Mark all survey scopes as submitted so journey-position skips them.
  // journey-position requires: PERSONALITY submitted_at + PRE_TEST (submitted or skipped) + PRE + POST
  const now = new Date().toISOString();
  const markers: Array<{ scope: string; key: string; value: string }> = [
    { scope: SURVEY_SCOPES.PRE, key: PRE_SURVEY_KEYS.SUBMITTED_AT, value: now },
    { scope: SURVEY_SCOPES.POST, key: POST_SURVEY_KEYS.SUBMITTED_AT, value: now },
    { scope: SURVEY_SCOPES.PERSONALITY, key: "submitted_at", value: now },
    { scope: SURVEY_SCOPES.PRE_TEST, key: "skipped", value: "true" },
  ];
  for (const { scope, key, value } of markers) {
    await prisma.callerAttribute.upsert({
      where: { callerId_key_scope: { callerId, key, scope } },
      create: {
        callerId,
        key,
        scope,
        valueType: "STRING",
        stringValue: value,
      },
      update: { stringValue: value },
    });
  }

  console.log(`[skip-onboarding] Skipped onboarding for ${callerId}`);
}

/**
 * Reset onboarding for a caller: clears OnboardingSession so they
 * can re-experience the full journey.
 */
export async function resetOnboarding(
  callerId: string,
  domainId: string,
): Promise<void> {
  await prisma.onboardingSession.upsert({
    where: { callerId_domainId: { callerId, domainId } },
    create: {
      callerId,
      domainId,
      isComplete: false,
      wasSkipped: false,
    },
    update: {
      isComplete: false,
      wasSkipped: false,
      currentPhase: null,
      completedPhases: [],
      completedAt: null,
    },
  });

  // Remove all survey submission markers so surveys appear again
  await prisma.callerAttribute.deleteMany({
    where: {
      callerId,
      OR: [
        { scope: SURVEY_SCOPES.PRE, key: PRE_SURVEY_KEYS.SUBMITTED_AT },
        { scope: SURVEY_SCOPES.POST, key: POST_SURVEY_KEYS.SUBMITTED_AT },
        { scope: SURVEY_SCOPES.PERSONALITY, key: "submitted_at" },
        { scope: SURVEY_SCOPES.PRE_TEST, key: "skipped" },
      ],
    },
  });

  console.log(`[skip-onboarding] Reset onboarding for ${callerId}`);
}
