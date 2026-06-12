// Canonical wizard phase-id mapping. Used to build sessionFlow.onboarding.phases
// from the four welcome booleans (#383). Phase ids match the existing
// sessionFlow.intake key names for consistency. The resolver at
// session-flow/resolver.ts::resolveOnboarding reads sessionFlow.onboarding
// first (Priority 1); pedagogy.ts::computeSessionPedagogy reads the legacy
// Playbook.config.onboardingFlowPhases (Priority 2 in both paths). The wizard
// mirrors both so it wins regardless of which resolver path runs.
export const WELCOME_PHASE_DEFINITIONS: Array<{
  key: "welcomeAiIntro" | "welcomeGoals" | "welcomeAboutYou" | "welcomeKnowledgeCheck";
  phase: string;
  duration: string;
  goals: string[];
}> = [
  { key: "welcomeAiIntro",        phase: "aiIntro",        duration: "1-2 min", goals: ["Tutor introduces itself and the session frame"] },
  { key: "welcomeGoals",          phase: "goals",          duration: "2-3 min", goals: ["Share the course goals with the learner"] },
  { key: "welcomeAboutYou",       phase: "aboutYou",       duration: "2-3 min", goals: ["Discover learner background, motivation, and context"] },
  { key: "welcomeKnowledgeCheck", phase: "knowledgeCheck", duration: "3-5 min", goals: ["Brief diagnostic to gauge starting level"] },
];
