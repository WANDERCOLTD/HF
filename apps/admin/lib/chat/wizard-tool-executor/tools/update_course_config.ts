import { updatePlaybookConfig } from "@/lib/playbook/update-playbook-config";
import { updateDomainConfig } from "@/lib/domain/update-domain-config";
import type { WizardToolExec } from "../_shared/types";
import { validUuid } from "../_shared/valid-uuid";

export async function execute(
  input: Record<string, unknown>,
  _userId: string,
  setupData?: Record<string, unknown>,
): Promise<WizardToolExec> {
  // Server-side: persist config changes to an existing course (post-creation tweaks)
  try {
    const { prisma } = await import("@/lib/prisma");
    const { applyBehaviorTargets } = await import("@/lib/domain/agent-tuning");

    const domainId = validUuid(input.domainId)
      || validUuid(setupData?.existingDomainId)
      || validUuid(setupData?.draftDomainId);
    const playbookId = validUuid(input.playbookId)
      || validUuid(setupData?.draftPlaybookId);

    if (!domainId || !playbookId) {
      return {
        content: JSON.stringify({ ok: false, error: "Invalid domainId or playbookId. Use the IDs from create_course result." }),
        is_error: true,
      };
    }

    // 1. Persist welcome message to Domain
    // #828 — central helper; update_course_config is post-creation
    // educator tuning, so timestamp bumps and fans staleness to all
    // playbooks in domain.
    const welcomeMessage = input.welcomeMessage as string | undefined;
    if (welcomeMessage) {
      await updateDomainConfig(
        domainId,
        (d) => ({ ...d, onboardingWelcome: welcomeMessage }),
        { reason: "wizard update_course_config — welcome" },
      );
    }

    // 2. Persist behavior targets to Domain + BehaviorTarget rows
    const behaviorTargets = input.behaviorTargets as Record<string, number> | undefined;
    if (behaviorTargets && Object.keys(behaviorTargets).length > 0) {
      const wrapped: Record<string, { value: number; confidence: number }> = {};
      for (const [paramId, value] of Object.entries(behaviorTargets)) {
        wrapped[paramId] = { value, confidence: 0.5 };
      }
      await updateDomainConfig(
        domainId,
        (d) => ({ ...d, onboardingDefaultTargets: wrapped }),
        { reason: "wizard update_course_config — onboardingDefaultTargets" },
      );
      await applyBehaviorTargets(playbookId, behaviorTargets);
    }

    // 3. Persist onboarding flow phases to Domain (attachment changes)
    if (input.onboardingFlowPhases) {
      await updateDomainConfig(
        domainId,
        (d) => ({ ...d, onboardingFlowPhases: JSON.parse(JSON.stringify(input.onboardingFlowPhases)) }),
        { reason: "wizard update_course_config — onboardingFlowPhases" },
      );
    }

    // 4. Merge session settings + lesson plan into playbook config
    const pb = await prisma.playbook.findUnique({
      where: { id: playbookId },
      select: { config: true },
    });
    const existingConfig = (pb?.config as Record<string, unknown>) || {};
    const configUpdate: Record<string, unknown> = { ...existingConfig };

    if (input.sessionCount) configUpdate.sessionCount = Number(input.sessionCount);
    if (input.durationMins) configUpdate.durationMins = Number(input.durationMins);
    if (input.planEmphasis) configUpdate.planEmphasis = input.planEmphasis;
    if (input.lessonPlanModel) configUpdate.lessonPlanModel = input.lessonPlanModel;
    if (welcomeMessage) configUpdate.welcomeMessage = welcomeMessage;
    if (input.courseContext) configUpdate.courseContext = input.courseContext;

    // #253: progressionMode → modulesAuthored mapping (also handled at
    // create_course; mirror here for update_course_config paths).
    const updateProgressionMode =
      (input.progressionMode as string) || (setupData?.progressionMode as string);
    if (updateProgressionMode === "learner-picks") {
      configUpdate.modulesAuthored = true;
    } else if (updateProgressionMode === "ai-led") {
      configUpdate.modulesAuthored = false;
    }

    // #826 — central helper. update_course_config is hit AFTER
    // playbook creation, possibly with enrolled callers — timestamp
    // bump marks downstream prompts as stale when COMPOSE-affecting
    // keys changed.
    await updatePlaybookConfig(
      playbookId,
      () => configUpdate,
      { reason: "wizard update_course_config" },
    );

    return {
      content: JSON.stringify({ ok: true, message: "Course configuration updated" }),
    };
  } catch (err) {
    return {
      content: JSON.stringify({ ok: false, error: String(err) }),
      is_error: true,
    };
  }
}
