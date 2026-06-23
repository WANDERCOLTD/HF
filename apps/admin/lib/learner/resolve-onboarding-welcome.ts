/**
 * Resolves the learner-facing onboarding welcome bundle for the FOH journey.
 *
 * Two values, two layers:
 *
 *   - `welcomeMessage` — cascade-resolved (`Playbook.config.welcomeMessage`
 *     wins, then `Domain.onboardingWelcome`, then the supplied
 *     `institutionFallback`, then `null`). Reuses the canonical
 *     `resolveWelcomeMessage` resolver to avoid divergence with the
 *     Inspector's cascade chip rendering of the same knob.
 *   - `onboardingClosingLine` — course-only (`Playbook.config.onboardingClosingLine`).
 *     No upstream layer today; cascade-classification-coverage classifies
 *     this contract as `course-only`.
 *
 * Producer ↔ consumer pairing (see `.claude/rules/registry-consumer-coverage.md`):
 * this helper is the LIB-level reader for both `welcomeMessage` and
 * `onboardingClosingLine`. The route at `app/api/student/progress/route.ts`
 * imports it and forwards the values into the progress response;
 * `hooks/useJourneyChat.ts::loadOnboardingPhase` reads them from the response
 * and renders the FOH onboarding bubbles.
 *
 * Failures (Prisma blips, missing playbook) are swallowed and logged —
 * the onboarding screen MUST render, falling back to the institution-level
 * welcome and then to the hardcoded literal in `useJourneyChat`.
 */

import { prisma } from "@/lib/prisma";
import { resolvePlaybookId } from "@/lib/enrollment/resolve-playbook";
import { resolveWelcomeMessage } from "@/lib/cascade/resolvers/welcome-message";
import type { PlaybookConfig } from "@/lib/types/json-fields";

export interface OnboardingWelcomeBundle {
  welcomeMessage: string | null;
  onboardingClosingLine: string | null;
}

export async function resolveOnboardingWelcomeForCaller(
  callerId: string,
  institutionFallback: string | null,
): Promise<OnboardingWelcomeBundle> {
  try {
    const playbookId = await resolvePlaybookId(callerId);
    if (!playbookId) {
      return { welcomeMessage: institutionFallback, onboardingClosingLine: null };
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
    const onboardingClosingLine = cfg.onboardingClosingLine ?? null;

    return { welcomeMessage, onboardingClosingLine };
  } catch (err) {
    console.warn(
      "[resolve-onboarding-welcome] resolution failed:",
      (err as Error).message,
    );
    return { welcomeMessage: institutionFallback, onboardingClosingLine: null };
  }
}
