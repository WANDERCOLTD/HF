/**
 * Tests for resolveSessionFlow() — the canonical Session Flow resolver.
 *
 * Covers:
 *   - Defaults applied when nothing is configured
 *   - New shape (sessionFlow) wins over legacy fields
 *   - Legacy fields read correctly when no sessionFlow
 *   - Three-source pre-test precedence (sessionFlow.stops > welcome > assessment)
 *   - Onboarding cascade (sessionFlow > playbook > domain > INIT-001)
 *   - Stops synthesis from legacy NPS / pre-test / post-test config
 *   - Welcome message cascade
 *   - Source provenance reported accurately
 *
 * @see lib/session-flow/resolver.ts
 * @see docs/decisions/2026-04-29-session-flow-canonical-model.md
 * @see GitHub issue #216
 */

import { describe, it, expect } from "vitest";
import { resolveSessionFlow } from "@/lib/session-flow/resolver";
import type {
  PlaybookConfig,
  SessionFlowConfig,
  JourneyStop,
  OnboardingFlowPhases,
} from "@/lib/types/json-fields";

const emptyPlaybook = { config: {} as PlaybookConfig };

describe("resolveSessionFlow — defaults", () => {
  it("returns fully populated defaults when given an empty playbook", () => {
    const r = resolveSessionFlow({ playbook: emptyPlaybook });
    expect(r.intake.goals.enabled).toBe(true);
    expect(r.intake.aboutYou.enabled).toBe(true);
    expect(r.intake.knowledgeCheck.enabled).toBe(false);
    expect(r.intake.aiIntroCall.enabled).toBe(false);
    expect(r.onboarding.phases).toEqual([]);
    // NPS defaults to enabled with mastery trigger — synthesizer produces a stop
    expect(r.stops.find(s => s.id === "nps")?.trigger).toEqual({
      type: "mastery_reached",
      threshold: 80,
    });
    expect(r.stops.find(s => s.id === "pre-test")).toBeUndefined();
    expect(r.stops.find(s => s.id === "post-test")).toBeUndefined();
    expect(r.offboarding.triggerAfterCalls).toBe(5);
    expect(r.welcomeMessage).toBeNull();
    expect(r.source.intake).toBe("defaults");
    expect(r.source.onboarding).toBe("init001");
    expect(r.source.welcomeMessage).toBe("generic");
  });

  it("handles null/undefined playbook safely", () => {
    expect(() => resolveSessionFlow({ playbook: null })).not.toThrow();
    expect(() => resolveSessionFlow({ playbook: undefined })).not.toThrow();
  });
});

describe("resolveSessionFlow — intake precedence", () => {
  it("prefers sessionFlow.intake over legacy welcome", () => {
    const config: PlaybookConfig = {
      sessionFlow: {
        intake: {
          goals: { enabled: false },
          aboutYou: { enabled: false },
          knowledgeCheck: { enabled: true, deliveryMode: "socratic" },
          aiIntroCall: { enabled: true },
        },
      },
      welcome: {
        goals: { enabled: true },
        aboutYou: { enabled: true },
        knowledgeCheck: { enabled: false },
        aiIntroCall: { enabled: false },
      },
    };
    const r = resolveSessionFlow({ playbook: { config } });
    expect(r.intake.goals.enabled).toBe(false);
    expect(r.intake.knowledgeCheck.deliveryMode).toBe("socratic");
    expect(r.source.intake).toBe("new-shape");
  });

  it("falls back to legacy welcome when sessionFlow.intake absent", () => {
    const config: PlaybookConfig = {
      welcome: {
        goals: { enabled: false },
        aboutYou: { enabled: true },
        knowledgeCheck: { enabled: true },
        aiIntroCall: { enabled: false },
      },
    };
    const r = resolveSessionFlow({ playbook: { config } });
    expect(r.intake.goals.enabled).toBe(false);
    expect(r.intake.knowledgeCheck.enabled).toBe(true);
    expect(r.intake.knowledgeCheck.deliveryMode).toBe("mcq"); // default applied
    expect(r.source.intake).toBe("legacy-welcome");
  });
});

describe("resolveSessionFlow — three-source pre-test precedence", () => {
  // Per Tech Lead review: pre-test trigger lives in three places during
  // dual-read. Resolver enforces sessionFlow.stops > welcome.knowledgeCheck >
  // assessment.preTest. Test fixtures with all three set inconsistently.

  it("sessionFlow.stops wins when set, regardless of welcome/assessment", () => {
    const explicitStop: JourneyStop = {
      id: "pre-test",
      kind: "assessment",
      trigger: { type: "after_session", index: 1 },
      delivery: { mode: "voice" },
      payload: { source: "mcq-pool", count: 7 },
      enabled: true,
    };
    const config: PlaybookConfig = {
      sessionFlow: { stops: [explicitStop] },
      welcome: {
        goals: { enabled: false },
        aboutYou: { enabled: false },
        knowledgeCheck: { enabled: false }, // contradicts the stop
        aiIntroCall: { enabled: false },
      },
      assessment: { preTest: { enabled: true, questionCount: 99 } }, // contradicts the stop
    };
    const r = resolveSessionFlow({ playbook: { config } });
    expect(r.stops).toEqual([explicitStop]);
    expect(r.source.stops).toBe("new-shape");
  });

  it("welcome.knowledgeCheck wins over assessment.preTest when sessionFlow.stops empty", () => {
    const config: PlaybookConfig = {
      welcome: {
        goals: { enabled: false },
        aboutYou: { enabled: false },
        knowledgeCheck: { enabled: true },
        aiIntroCall: { enabled: false },
      },
      assessment: { preTest: { enabled: false, questionCount: 0 } }, // welcome wins
    };
    const r = resolveSessionFlow({ playbook: { config } });
    const preTest = r.stops.find(s => s.id === "pre-test");
    expect(preTest).toBeDefined();
    expect(preTest?.enabled).toBe(true);
    expect(r.source.stops).toBe("synthesized-from-legacy");
  });

  it("assessment.preTest used only when welcome.knowledgeCheck is absent", () => {
    const config: PlaybookConfig = {
      assessment: { preTest: { enabled: true, questionCount: 8 } },
    };
    const r = resolveSessionFlow({ playbook: { config } });
    const preTest = r.stops.find(s => s.id === "pre-test");
    expect(preTest).toBeDefined();
    expect((preTest?.payload as { count: number })?.count).toBe(8);
  });

  it("welcome.knowledgeCheck=false explicitly overrides assessment.preTest=true", () => {
    // Edge case: educator turned off Knowledge Check but legacy assessment.preTest
    // is still on. Welcome is the more recent surface, so it wins.
    const config: PlaybookConfig = {
      welcome: {
        goals: { enabled: false },
        aboutYou: { enabled: false },
        knowledgeCheck: { enabled: false },
        aiIntroCall: { enabled: false },
      },
      assessment: { preTest: { enabled: true, questionCount: 5 } },
    };
    const r = resolveSessionFlow({ playbook: { config } });
    const preTest = r.stops.find(s => s.id === "pre-test");
    expect(preTest).toBeUndefined();
  });
});

describe("resolveSessionFlow — onboarding cascade", () => {
  const playbookPhases: OnboardingFlowPhases = {
    phases: [{ phase: "playbook-welcome", duration: "2 min", goals: ["g1"] }],
  };
  const domainPhases: OnboardingFlowPhases = {
    phases: [{ phase: "domain-welcome", duration: "3 min", goals: ["g2"] }],
  };
  const initFlow: OnboardingFlowPhases = {
    phases: [{ phase: "init-welcome", duration: "1 min", goals: ["g3"] }],
  };

  it("sessionFlow.onboarding wins over all", () => {
    const sfPhases = [{ phase: "sf-welcome", duration: "5 min", goals: ["sg"] }];
    const config: PlaybookConfig = {
      sessionFlow: { onboarding: { phases: sfPhases } } as SessionFlowConfig,
      onboardingFlowPhases: playbookPhases,
    };
    const r = resolveSessionFlow({
      playbook: { config },
      domain: { onboardingFlowPhases: domainPhases },
      onboardingSpec: { config: { firstCallFlow: initFlow } },
    });
    expect(r.onboarding.phases[0]?.phase).toBe("sf-welcome");
    expect(r.source.onboarding).toBe("new-shape");
  });

  it("playbook legacy wins over domain when sessionFlow absent", () => {
    const config: PlaybookConfig = { onboardingFlowPhases: playbookPhases };
    const r = resolveSessionFlow({
      playbook: { config },
      domain: { onboardingFlowPhases: domainPhases },
      onboardingSpec: { config: { firstCallFlow: initFlow } },
    });
    expect(r.onboarding.phases[0]?.phase).toBe("playbook-welcome");
    expect(r.source.onboarding).toBe("playbook-legacy");
  });

  it("domain wins over INIT-001 when playbook absent", () => {
    const r = resolveSessionFlow({
      playbook: emptyPlaybook,
      domain: { onboardingFlowPhases: domainPhases },
      onboardingSpec: { config: { firstCallFlow: initFlow } },
    });
    expect(r.onboarding.phases[0]?.phase).toBe("domain-welcome");
    expect(r.source.onboarding).toBe("domain");
  });

  it("INIT-001 used when nothing else configured", () => {
    const r = resolveSessionFlow({
      playbook: emptyPlaybook,
      onboardingSpec: { config: { firstCallFlow: initFlow } },
    });
    expect(r.onboarding.phases[0]?.phase).toBe("init-welcome");
    expect(r.source.onboarding).toBe("init001");
  });
});

describe("resolveSessionFlow — stops synthesis from legacy", () => {
  it("synthesizes pre-test stop from welcome.knowledgeCheck", () => {
    const config: PlaybookConfig = {
      welcome: {
        goals: { enabled: false },
        aboutYou: { enabled: false },
        knowledgeCheck: { enabled: true },
        aiIntroCall: { enabled: false },
      },
    };
    const r = resolveSessionFlow({ playbook: { config } });
    const preTest = r.stops.find(s => s.id === "pre-test");
    expect(preTest?.kind).toBe("assessment");
    expect(preTest?.trigger).toEqual({ type: "after_session", index: 1 });
  });

  it("synthesizes NPS stop with mastery trigger when nps.trigger=mastery", () => {
    const config: PlaybookConfig = {
      nps: { enabled: true, trigger: "mastery", threshold: 80 },
    };
    const r = resolveSessionFlow({ playbook: { config } });
    const nps = r.stops.find(s => s.id === "nps");
    expect(nps?.kind).toBe("nps");
    expect(nps?.trigger).toEqual({ type: "mastery_reached", threshold: 80 });
  });

  it("synthesizes NPS stop with session_count trigger when nps.trigger=session_count", () => {
    const config: PlaybookConfig = {
      nps: { enabled: true, trigger: "session_count", threshold: 5 },
    };
    const r = resolveSessionFlow({ playbook: { config } });
    const nps = r.stops.find(s => s.id === "nps");
    expect(nps?.trigger).toEqual({ type: "session_count", count: 5 });
  });

  it("does not synthesize NPS stop when nps.enabled=false", () => {
    const config: PlaybookConfig = {
      nps: { enabled: false, trigger: "mastery", threshold: 80 },
    };
    const r = resolveSessionFlow({ playbook: { config } });
    expect(r.stops.find(s => s.id === "nps")).toBeUndefined();
  });

  it("synthesizes post-test stop from assessment.postTest", () => {
    const config: PlaybookConfig = {
      assessment: { postTest: { enabled: true } },
    };
    const r = resolveSessionFlow({ playbook: { config } });
    const post = r.stops.find(s => s.id === "post-test");
    expect(post?.trigger).toEqual({ type: "course_complete" });
  });

  it("legacy surveys.post.enabled also synthesizes post-test stop", () => {
    const config: PlaybookConfig = {
      surveys: { post: { enabled: true } },
    };
    const r = resolveSessionFlow({ playbook: { config } });
    expect(r.stops.find(s => s.id === "post-test")).toBeDefined();
  });
});

describe("resolveSessionFlow — Knowledge Check deliveryMode (#222)", () => {
  // The deliveryMode split ends the double-gating: educator picks MCQ
  // batch OR Socratic probe, not both. Default is "mcq" for back-compat.

  it("MCQ delivery (default) → synthesises pre-test stop", () => {
    const config: PlaybookConfig = {
      welcome: {
        goals: { enabled: false },
        aboutYou: { enabled: false },
        knowledgeCheck: { enabled: true },
        aiIntroCall: { enabled: false },
      },
    };
    const r = resolveSessionFlow({ playbook: { config } });
    expect(r.stops.find(s => s.id === "pre-test")).toBeDefined();
  });

  it("Socratic delivery → does NOT synthesise pre-test stop", () => {
    const config: PlaybookConfig = {
      sessionFlow: {
        intake: {
          goals: { enabled: false },
          aboutYou: { enabled: false },
          knowledgeCheck: { enabled: true, deliveryMode: "socratic" },
          aiIntroCall: { enabled: false },
        },
      },
      // legacy fields say enabled=true, but new sessionFlow says socratic
      welcome: {
        goals: { enabled: false },
        aboutYou: { enabled: false },
        knowledgeCheck: { enabled: true },
        aiIntroCall: { enabled: false },
      },
    };
    const r = resolveSessionFlow({ playbook: { config } });
    expect(r.stops.find(s => s.id === "pre-test")).toBeUndefined();
  });

  it("MCQ delivery via sessionFlow.intake → synthesises pre-test stop", () => {
    const config: PlaybookConfig = {
      sessionFlow: {
        intake: {
          goals: { enabled: false },
          aboutYou: { enabled: false },
          knowledgeCheck: { enabled: true, deliveryMode: "mcq" },
          aiIntroCall: { enabled: false },
        },
      },
    };
    const r = resolveSessionFlow({ playbook: { config } });
    expect(r.stops.find(s => s.id === "pre-test")).toBeDefined();
  });
});

describe("resolveSessionFlow — offboarding cascade", () => {
  it("does NOT reference domain.offboarding (which does not exist)", () => {
    // Sanity check: Domain has no offboarding field per Prisma schema.
    // Resolver must not crash when given a domain object with no offboarding.
    const r = resolveSessionFlow({
      playbook: emptyPlaybook,
      domain: { slug: "test", onboardingFlowPhases: null, onboardingWelcome: null },
    });
    expect(r.offboarding).toBeDefined();
    expect(r.source.offboarding).toBe("defaults");
  });

  it("playbook.config.offboarding (legacy) used when sessionFlow.offboarding absent", () => {
    const config: PlaybookConfig = {
      offboarding: { triggerAfterCalls: 7, phases: [] },
    };
    const r = resolveSessionFlow({ playbook: { config } });
    expect(r.offboarding.triggerAfterCalls).toBe(7);
    expect(r.source.offboarding).toBe("playbook-legacy");
  });

  it("sessionFlow.offboarding wins over legacy", () => {
    const config: PlaybookConfig = {
      sessionFlow: { offboarding: { triggerAfterCalls: 3, phases: [] } },
      offboarding: { triggerAfterCalls: 7, phases: [] },
    };
    const r = resolveSessionFlow({ playbook: { config } });
    expect(r.offboarding.triggerAfterCalls).toBe(3);
    expect(r.source.offboarding).toBe("new-shape");
  });
});

describe("resolveSessionFlow — welcome message cascade", () => {
  it("playbook welcomeMessage wins over domain", () => {
    const r = resolveSessionFlow({
      playbook: { welcomeMessage: "PB hello" },
      domain: { onboardingWelcome: "Domain hello" },
    });
    expect(r.welcomeMessage).toBe("PB hello");
    expect(r.source.welcomeMessage).toBe("playbook");
  });

  it("falls back to domain.onboardingWelcome when playbook absent", () => {
    const r = resolveSessionFlow({
      playbook: { config: {} },
      domain: { onboardingWelcome: "Domain hello" },
    });
    expect(r.welcomeMessage).toBe("Domain hello");
    expect(r.source.welcomeMessage).toBe("domain");
  });

  it("returns null + 'generic' source when nothing configured", () => {
    const r = resolveSessionFlow({ playbook: emptyPlaybook });
    expect(r.welcomeMessage).toBeNull();
    expect(r.source.welcomeMessage).toBe("generic");
  });
});

describe("resolveSessionFlow — provenance accuracy", () => {
  it("source object reports every layer's origin independently", () => {
    const config: PlaybookConfig = {
      sessionFlow: {
        intake: {
          goals: { enabled: true },
          aboutYou: { enabled: true },
          knowledgeCheck: { enabled: false },
          aiIntroCall: { enabled: false },
        },
      },
      offboarding: { triggerAfterCalls: 4, phases: [] },
    };
    const r = resolveSessionFlow({
      playbook: { config },
      domain: { onboardingFlowPhases: { phases: [{ phase: "d", duration: "1 min", goals: [] }] } },
    });
    expect(r.source.intake).toBe("new-shape");
    expect(r.source.onboarding).toBe("domain");
    expect(r.source.offboarding).toBe("playbook-legacy");
    expect(r.source.stops).toBe("synthesized-from-legacy");
  });
});
