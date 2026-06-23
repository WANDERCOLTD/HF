/**
 * Resolves the learner-facing onboarding + journey copy bundle for the
 * FOH journey.
 *
 * Originally introduced by PR #2265 covering 2 fields (welcomeMessage +
 * onboardingClosingLine). Extended by PR #2266 S1 with 8 more fields
 * lifted out of `useJourneyChat.ts` + `WelcomeSurveyFlow.tsx` as part
 * of the "ALL settings → UI" drive.
 *
 * Cascade resolution:
 *
 *   - `welcomeMessage` — cascade-resolved via `resolveWelcomeMessage`
 *     (`Playbook.config.welcomeMessage` → `Domain.onboardingWelcome` →
 *     `institutionFallback` → `null`).
 *   - Every other field — course-only (`Playbook.config.<field>`). No
 *     upstream layer today. Cascade-classification-coverage classifies
 *     each as `course-only`.
 *
 * Failures (Prisma blip, missing playbook) are swallowed and logged —
 * the onboarding screens MUST render. Consumers fall back to the
 * hardcoded literal kept in `useJourneyChat` / `WelcomeSurveyFlow`.
 *
 * Producer ↔ consumer pairing (see `.claude/rules/registry-consumer-coverage.md`):
 * this helper is the LIB-level reader for ALL course-only learner-copy
 * knobs that flow through `/api/student/progress`. The hook + the HTML
 * onboarding wizard both consume the values from the route response.
 */

import { prisma } from "@/lib/prisma";
import { resolvePlaybookId } from "@/lib/enrollment/resolve-playbook";
import { resolveWelcomeMessage } from "@/lib/cascade/resolvers/welcome-message";
import type { PlaybookConfig } from "@/lib/types/json-fields";

export interface OnboardingWelcomeBundle {
  welcomeMessage: string | null;
  onboardingClosingLine: string | null;
  goalsPreamble: string | null;
  aboutYouIntro: string | null;
  preTestIntro: string | null;
  preTestClosing: string | null;
  postTestIntro: string | null;
  postTestClosing: string | null;
  journeyExitIntro: string | null;
  journeyExitClosing: string | null;
}

function emptyBundle(welcomeMessage: string | null): OnboardingWelcomeBundle {
  return {
    welcomeMessage,
    onboardingClosingLine: null,
    goalsPreamble: null,
    aboutYouIntro: null,
    preTestIntro: null,
    preTestClosing: null,
    postTestIntro: null,
    postTestClosing: null,
    journeyExitIntro: null,
    journeyExitClosing: null,
  };
}

export async function resolveOnboardingWelcomeForCaller(
  callerId: string,
  institutionFallback: string | null,
): Promise<OnboardingWelcomeBundle> {
  try {
    const playbookId = await resolvePlaybookId(callerId);
    if (!playbookId) {
      return emptyBundle(institutionFallback);
    }

    const [effective, playbook] = await Promise.all([
      resolveWelcomeMessage({ playbookId }),
      prisma.playbook.findUnique({
        where: { id: playbookId },
        select: { config: true },
      }),
    ]);

    const cfg = (playbook?.config ?? {}) as PlaybookConfig;
    const welcomeMessage = effective.value ?? institutionFallback;

    return {
      welcomeMessage,
      onboardingClosingLine: cfg.onboardingClosingLine ?? null,
      goalsPreamble: cfg.goalsPreamble ?? null,
      aboutYouIntro: cfg.aboutYouIntro ?? null,
      preTestIntro: cfg.preTestIntro ?? null,
      preTestClosing: cfg.preTestClosing ?? null,
      postTestIntro: cfg.postTestIntro ?? null,
      postTestClosing: cfg.postTestClosing ?? null,
      journeyExitIntro: cfg.journeyExitIntro ?? null,
      journeyExitClosing: cfg.journeyExitClosing ?? null,
    };
  } catch (err) {
    console.warn(
      "[resolve-onboarding-welcome] resolution failed:",
      (err as Error).message,
    );
    return emptyBundle(institutionFallback);
  }
}
