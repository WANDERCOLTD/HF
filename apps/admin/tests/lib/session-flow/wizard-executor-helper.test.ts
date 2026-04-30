/**
 * Tests for applyStudentExperienceConfig — the wizard-tool-executor
 * helper that writes welcome (legacy) + sessionFlow.intake (new) +
 * nps + surveys to Playbook.config from wizard setupData.
 *
 * Covers:
 *   - All four intake toggles map correctly to welcome + sessionFlow.intake
 *   - knowledgeCheck deliveryMode (mcq | socratic) lands on intake
 *   - Defaults applied when setupData empty
 *   - nps + surveys.post mirror pair
 *   - Idempotent — does not overwrite existing configUpdate fields
 *
 * @see lib/chat/wizard-tool-executor.ts
 * @see GitHub issue #219
 */

import { describe, it, expect, vi } from "vitest";
import { applyStudentExperienceConfig } from "@/lib/chat/wizard-tool-executor";

// Silence the observability warning so test output is clean.
vi.spyOn(console, "warn").mockImplementation(() => {});

type WelcomeShape = {
  goals: { enabled: boolean };
  aboutYou: { enabled: boolean };
  knowledgeCheck: { enabled: boolean };
  aiIntroCall: { enabled: boolean };
};
type IntakeShape = WelcomeShape & {
  knowledgeCheck: { enabled: boolean; deliveryMode: "mcq" | "socratic" };
};
type NpsShape = { enabled: boolean; trigger: string; threshold: number };
type SurveysShape = { post: { enabled: boolean } };
type ConfigShape = {
  welcome?: WelcomeShape;
  sessionFlow?: { intake?: IntakeShape };
  nps?: NpsShape;
  surveys?: SurveysShape;
};

function applyAndCast(
  setupData: Record<string, unknown> | undefined,
  initial: Record<string, unknown> = {},
): ConfigShape {
  const config = { ...initial };
  applyStudentExperienceConfig(setupData, config, "test", "test-id");
  return config as ConfigShape;
}

describe("applyStudentExperienceConfig — welcome (legacy) shape", () => {
  it("applies all four toggles when set in setupData", () => {
    const c = applyAndCast({
      welcomeGoals: true,
      welcomeAboutYou: false,
      welcomeKnowledgeCheck: true,
      welcomeAiIntro: false,
    });
    expect(c.welcome).toEqual({
      goals: { enabled: true },
      aboutYou: { enabled: false },
      knowledgeCheck: { enabled: true },
      aiIntroCall: { enabled: false },
    });
  });

  it("falls back to DEFAULT_WELCOME_CONFIG (goals + aboutYou on, KC + intro off)", () => {
    const c = applyAndCast({});
    expect(c.welcome).toEqual({
      goals: { enabled: true },
      aboutYou: { enabled: true },
      knowledgeCheck: { enabled: false },
      aiIntroCall: { enabled: false },
    });
  });

  it("respects explicit welcomeGoals=false (does not default to true)", () => {
    const c = applyAndCast({ welcomeGoals: false });
    expect(c.welcome?.goals.enabled).toBe(false);
  });

  it("respects explicit welcomeKnowledgeCheck=true", () => {
    const c = applyAndCast({ welcomeKnowledgeCheck: true });
    expect(c.welcome?.knowledgeCheck.enabled).toBe(true);
  });

  it("does not overwrite welcome if already present (idempotent)", () => {
    const existing = {
      welcome: {
        goals: { enabled: false },
        aboutYou: { enabled: false },
        knowledgeCheck: { enabled: false },
        aiIntroCall: { enabled: false },
      },
    };
    const c = applyAndCast({ welcomeGoals: true, welcomeAboutYou: true }, existing);
    expect(c.welcome?.goals.enabled).toBe(false); // preserved
  });
});

describe("applyStudentExperienceConfig — sessionFlow.intake (new shape mirror)", () => {
  it("mirrors welcome to sessionFlow.intake with default deliveryMode=mcq", () => {
    const c = applyAndCast({
      welcomeGoals: true,
      welcomeAboutYou: true,
      welcomeKnowledgeCheck: true,
      welcomeAiIntro: false,
    });
    expect(c.sessionFlow?.intake).toEqual({
      goals: { enabled: true },
      aboutYou: { enabled: true },
      knowledgeCheck: { enabled: true, deliveryMode: "mcq" },
      aiIntroCall: { enabled: false },
    });
  });

  it("respects welcomeKnowledgeCheckMode=socratic", () => {
    const c = applyAndCast({
      welcomeKnowledgeCheck: true,
      welcomeKnowledgeCheckMode: "socratic",
    });
    expect(c.sessionFlow?.intake?.knowledgeCheck).toEqual({
      enabled: true,
      deliveryMode: "socratic",
    });
  });

  it("normalises invalid deliveryMode values to mcq", () => {
    const c = applyAndCast({
      welcomeKnowledgeCheck: true,
      welcomeKnowledgeCheckMode: "garbage",
    });
    expect(c.sessionFlow?.intake?.knowledgeCheck.deliveryMode).toBe("mcq");
  });

  it("preserves existing sessionFlow keys other than intake", () => {
    const existing = {
      sessionFlow: {
        offboarding: { triggerAfterCalls: 7, phases: [] },
      },
    };
    const c = applyAndCast({}, existing);
    expect(c.sessionFlow).toMatchObject({
      offboarding: { triggerAfterCalls: 7 },
      intake: { goals: { enabled: true } },
    });
  });
});

describe("applyStudentExperienceConfig — nps + surveys mirror", () => {
  it("npsEnabled true → nps + surveys.post both enabled", () => {
    const c = applyAndCast({ npsEnabled: true });
    expect(c.nps).toEqual({ enabled: true, trigger: "mastery", threshold: 80 });
    expect(c.surveys).toEqual({ post: { enabled: true } });
  });

  it("npsEnabled false → nps + surveys.post both disabled", () => {
    const c = applyAndCast({ npsEnabled: false });
    expect(c.nps?.enabled).toBe(false);
    expect(c.surveys?.post.enabled).toBe(false);
  });

  it("nps absent in setupData → defaults enabled=true", () => {
    const c = applyAndCast({});
    expect(c.nps?.enabled).toBe(true);
  });

  it("does not overwrite nps if already present (idempotent)", () => {
    const existing = {
      nps: { enabled: false, trigger: "session_count", threshold: 5 },
    };
    const c = applyAndCast({ npsEnabled: true }, existing);
    expect(c.nps).toEqual({ enabled: false, trigger: "session_count", threshold: 5 });
  });
});
