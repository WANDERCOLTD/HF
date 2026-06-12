import { WELCOME_PHASE_DEFINITIONS } from "./welcome-phases";

/**
 * Build the student-experience portion of a Playbook.config from wizard
 * setupData. Writes BOTH the legacy shape (`welcome` / `nps` / `surveys`)
 * AND the new canonical `sessionFlow.intake` shape (#216 mirror pattern).
 *
 * Mutates `configUpdate` in place. Skips fields already present (idempotent).
 *
 * Bag keys (stable contract):
 *   welcomeGoals / welcomeAboutYou / welcomeKnowledgeCheck / welcomeAiIntro: boolean
 *   welcomeKnowledgeCheckMode: "mcq" | "socratic"  (NEW for #222)
 *   npsEnabled: boolean
 *
 * @param setupData wizard flow-bag (record of values keyed by bag key)
 * @param configUpdate mutable Playbook.config working copy
 * @param contextLabel string used in observability warnings ("create_course (existing)" etc.)
 * @param entityId    playbookId / courseId for observability
 */
export function applyStudentExperienceConfig(
  setupData: Record<string, unknown> | undefined,
  configUpdate: Record<string, unknown>,
  contextLabel: string,
  entityId: string,
): void {
  // ── Welcome (legacy) — always written by wizard until Phase 5 cleanup. ──
  if (!configUpdate.welcome) {
    const welcomeKeysSet = ["welcomeGoals", "welcomeAboutYou", "welcomeKnowledgeCheck", "welcomeAiIntro"]
      .filter((k) => setupData?.[k] !== undefined).length;
    if (welcomeKeysSet === 0) {
      console.warn(
        `[wizard-tool-executor] ${contextLabel} called without explicit welcome flags — falling back to DEFAULT_WELCOME_CONFIG. id=${entityId}`,
      );
    }
    configUpdate.welcome = {
      goals: { enabled: setupData?.welcomeGoals !== false },
      aboutYou: { enabled: setupData?.welcomeAboutYou !== false },
      knowledgeCheck: { enabled: setupData?.welcomeKnowledgeCheck === true },
      aiIntroCall: { enabled: setupData?.welcomeAiIntro === true },
    };
  }

  // ── sessionFlow.intake (new shape) — mirror of welcome plus deliveryMode. ──
  // Always set so the resolver / editor see the same source of truth. The
  // mirror layer is removed in Phase 5 (#220) once legacy fields are dropped.
  const existingSessionFlow = (configUpdate.sessionFlow as Record<string, unknown> | undefined) ?? {};
  const welcome = configUpdate.welcome as {
    goals: { enabled: boolean };
    aboutYou: { enabled: boolean };
    knowledgeCheck: { enabled: boolean };
    aiIntroCall: { enabled: boolean };
  };
  const deliveryMode: "mcq" | "socratic" =
    setupData?.welcomeKnowledgeCheckMode === "socratic" ? "socratic" : "mcq";

  // ── sessionFlow.onboarding.phases + onboardingFlowPhases mirror (#383). ──
  // The first-call structural template resolver reads sessionFlow.onboarding
  // first (new path) or Playbook.config.onboardingFlowPhases (old path); both
  // must be written so the educator's welcome-phase choice actually fires at
  // runtime. Empty array when all four are off — the resolver's truthy-object
  // check still wins Priority 1, so we don't fall through to INIT-001.
  const welcomeEnabledMap: Record<string, boolean> = {
    welcomeGoals: welcome.goals.enabled,
    welcomeAboutYou: welcome.aboutYou.enabled,
    welcomeKnowledgeCheck: welcome.knowledgeCheck.enabled,
    welcomeAiIntro: welcome.aiIntroCall.enabled,
  };
  const onboardingPhases = WELCOME_PHASE_DEFINITIONS
    .filter((def) => welcomeEnabledMap[def.key])
    .map((def) => ({ phase: def.phase, duration: def.duration, goals: [...def.goals] }));

  configUpdate.sessionFlow = {
    ...existingSessionFlow,
    intake: {
      goals: { enabled: welcome.goals.enabled },
      aboutYou: { enabled: welcome.aboutYou.enabled },
      knowledgeCheck: { enabled: welcome.knowledgeCheck.enabled, deliveryMode },
      aiIntroCall: { enabled: welcome.aiIntroCall.enabled },
    },
    onboarding: { phases: onboardingPhases },
  };
  configUpdate.onboardingFlowPhases = { phases: onboardingPhases };

  // ── NPS — top-level config field, mirrored to surveys.post.enabled for
  // structured-mode rail compatibility (existing pattern). ──
  if (!configUpdate.nps) {
    configUpdate.nps = {
      enabled: setupData?.npsEnabled !== false,
      trigger: "mastery" as const,
      threshold: 80,
    };
  }
  if (!configUpdate.surveys) {
    const nps = configUpdate.nps as { enabled: boolean };
    configUpdate.surveys = {
      post: { enabled: nps.enabled },
    };
  }
}
