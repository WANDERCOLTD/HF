/**
 * Wizard onboarding-phases mirror — #383 regression suite.
 *
 * Verifies applyStudentExperienceConfig writes both
 * Playbook.config.sessionFlow.onboarding.phases (Priority 1 in the new
 * resolver) AND Playbook.config.onboardingFlowPhases (Priority 2 in both
 * resolver paths) from the four welcome booleans — so the runtime resolver
 * cascade never silently falls through to INIT-001's recommended set.
 *
 * Covers AC-1, AC-3, AC-4, AC-7 from #383.
 */

import { describe, it, expect } from "vitest";
import { applyStudentExperienceConfig } from "@/lib/chat/wizard-tool-executor";

type ConfigShape = {
  sessionFlow?: {
    onboarding?: { phases?: Array<{ phase: string; duration: string; goals: string[] }> };
  };
  onboardingFlowPhases?: { phases?: Array<{ phase: string; duration: string; goals: string[] }> };
};

function run(setupData: Record<string, unknown> | undefined): ConfigShape {
  const configUpdate: Record<string, unknown> = {};
  applyStudentExperienceConfig(setupData, configUpdate, "test", "test-id");
  return configUpdate as ConfigShape;
}

describe("applyStudentExperienceConfig — onboarding-phases mirror (#383)", () => {
  it("AC-1 — all four welcomes off → both shapes write phases: []", () => {
    const cfg = run({
      welcomeGoals: false,
      welcomeAboutYou: false,
      welcomeKnowledgeCheck: false,
      welcomeAiIntro: false,
    });
    expect(cfg.sessionFlow?.onboarding?.phases).toEqual([]);
    expect(cfg.onboardingFlowPhases?.phases).toEqual([]);
  });

  it("AC-3 — only welcomeGoals=true → phases contains exactly the goals phase", () => {
    const cfg = run({
      welcomeGoals: true,
      welcomeAboutYou: false,
      welcomeKnowledgeCheck: false,
      welcomeAiIntro: false,
    });
    expect(cfg.sessionFlow?.onboarding?.phases).toHaveLength(1);
    expect(cfg.sessionFlow?.onboarding?.phases?.[0].phase).toBe("goals");
    expect(cfg.onboardingFlowPhases?.phases).toHaveLength(1);
    expect(cfg.onboardingFlowPhases?.phases?.[0].phase).toBe("goals");
  });

  it("AC-4 — all four welcomes on → four phases in canonical order", () => {
    const cfg = run({
      welcomeGoals: true,
      welcomeAboutYou: true,
      welcomeKnowledgeCheck: true,
      welcomeAiIntro: true,
    });
    const phaseIds = cfg.sessionFlow?.onboarding?.phases?.map((p) => p.phase);
    expect(phaseIds).toEqual(["aiIntro", "goals", "aboutYou", "knowledgeCheck"]);
    // Both shapes must carry the same payload — mirror invariant.
    expect(cfg.onboardingFlowPhases?.phases).toEqual(cfg.sessionFlow?.onboarding?.phases);
  });

  it("AC-7 — no welcome keys → DEFAULT_WELCOME_CONFIG defaults drive the phases", () => {
    // Defaults: goals=true, aboutYou=true, knowledgeCheck=false, aiIntroCall=false.
    // Empty setupData triggers the fallback warning AND should still produce
    // a non-empty phases list reflecting the defaults so Priority 1 wins.
    const cfg = run({});
    const phaseIds = cfg.sessionFlow?.onboarding?.phases?.map((p) => p.phase);
    expect(phaseIds).toEqual(["goals", "aboutYou"]);
    expect(cfg.onboardingFlowPhases?.phases).toEqual(cfg.sessionFlow?.onboarding?.phases);
  });

  it("mirror invariant — phases identical between sessionFlow.onboarding and onboardingFlowPhases across all cases", () => {
    const cases = [
      { welcomeGoals: false, welcomeAboutYou: false, welcomeKnowledgeCheck: false, welcomeAiIntro: false },
      { welcomeGoals: true,  welcomeAboutYou: false, welcomeKnowledgeCheck: true,  welcomeAiIntro: false },
      { welcomeGoals: true,  welcomeAboutYou: true,  welcomeKnowledgeCheck: true,  welcomeAiIntro: true  },
    ];
    for (const c of cases) {
      const cfg = run(c);
      expect(cfg.onboardingFlowPhases?.phases).toEqual(cfg.sessionFlow?.onboarding?.phases);
    }
  });

  it("phase objects carry duration + goals[] so the resolver returns a usable structure", () => {
    const cfg = run({ welcomeGoals: true });
    const phase = cfg.sessionFlow?.onboarding?.phases?.[0];
    expect(phase?.phase).toBe("goals");
    expect(typeof phase?.duration).toBe("string");
    expect(phase?.duration.length).toBeGreaterThan(0);
    expect(Array.isArray(phase?.goals)).toBe(true);
    expect(phase?.goals.length).toBeGreaterThan(0);
  });
});
