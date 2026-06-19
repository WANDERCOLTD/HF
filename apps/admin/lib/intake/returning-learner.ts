/**
 * Returning-learner detection for the intake-skip gate (#2050).
 *
 * A caller is "returning" — for the purpose of `PlaybookConfig.skipIntakeIfReturning`
 * — when ANY of the following hold:
 *
 *   1. The learner has a `submitted_at` CallerAttribute under scope
 *      `PERSONALITY` or `PRE_SURVEY` (i.e. they completed the welcome
 *      flow on this or any prior playbook). Same-caller signal.
 *
 *   2. The learner has any CallerAttribute under scope `INTAKE_CHAT` —
 *      these rows are projected from the EnrollmentIntake bootstrap
 *      (`/api/join/[token]` for existing users) via `writeIntakeQAProjections`.
 *      Re-enrolment signal.
 *
 * Both shapes are caller-scoped (not playbook-scoped), which matches the
 * educator intent surfaced by the contract label "Skip intake for
 * returning learners" — once the learner has done it once, don't make
 * them do it again on a sibling course.
 *
 * Producer side: the `intakeSkipIfReturning` JourneySettingContract
 * (storagePath: `config.skipIntakeIfReturning`).
 * Consumer side: `app/api/student/survey-config/route.ts` — the route
 * sets `skipIntake: true` when this helper resolves true AND the flag
 * is set, and `WelcomeSurveyFlow.tsx` short-circuits to `onAlreadyDone()`.
 */

import type { PrismaClient } from "@prisma/client";

const SURVEY_DONE_SCOPES = ["PERSONALITY", "PRE_SURVEY"] as const;
const INTAKE_CHAT_SCOPE = "INTAKE_CHAT";

/**
 * Detect whether `callerId` has prior intake history. Returns true when at
 * least one shape (completed welcome survey OR prior intake-chat projection)
 * is present.
 */
export async function isReturningLearner(
  prisma: Pick<PrismaClient, "callerAttribute">,
  callerId: string,
): Promise<boolean> {
  // Cheap existence-only probe — count > 0 is enough.
  const matches = await prisma.callerAttribute.count({
    where: {
      callerId,
      OR: [
        { scope: { in: [...SURVEY_DONE_SCOPES] }, key: "submitted_at" },
        { scope: INTAKE_CHAT_SCOPE },
      ],
    },
  });
  return matches > 0;
}
