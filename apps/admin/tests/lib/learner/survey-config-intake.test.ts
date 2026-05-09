import { describe, expect, it } from "vitest";
import { isPreSurveyEnabled } from "@/lib/learner/survey-config";
import { resolveSessionFlow } from "@/lib/session-flow/resolver";
import type { PlaybookConfig } from "@/lib/types/json-fields";

// ─────────────────────────────────────────────────────────────────────────────
// Issue #301 — unify welcome-phase reads.
//
// Two writers persist the same four flags:
//   - wizard / session-flow editor  → writes BOTH `sessionFlow.intake` AND
//                                     legacy `welcome` (mirrored)
//   - course design tab             → writes `sessionFlow.intake` via the
//                                     session-flow PUT route, which mirrors
//                                     to legacy `welcome`
//
// Every reader (resolveSessionFlow, isPreSurveyEnabled) must see the same
// IntakeConfig shape regardless of which writer ran. These tests pin that
// invariant so future drift is caught.
// ─────────────────────────────────────────────────────────────────────────────

const WIZARD_WRITTEN: PlaybookConfig = {
  welcome: {
    goals: { enabled: true },
    aboutYou: { enabled: false },
    knowledgeCheck: { enabled: true },
    aiIntroCall: { enabled: false },
  },
  sessionFlow: {
    intake: {
      goals: { enabled: true },
      aboutYou: { enabled: false },
      knowledgeCheck: { enabled: true, deliveryMode: "socratic" },
      aiIntroCall: { enabled: false },
    },
  },
};

const DESIGN_TAB_WRITTEN: PlaybookConfig = {
  welcome: {
    goals: { enabled: true },
    aboutYou: { enabled: false },
    knowledgeCheck: { enabled: true },
    aiIntroCall: { enabled: false },
  },
  sessionFlow: {
    intake: {
      goals: { enabled: true },
      aboutYou: { enabled: false },
      knowledgeCheck: { enabled: true, deliveryMode: "mcq" },
      aiIntroCall: { enabled: false },
    },
  },
};

const LEGACY_ONLY: PlaybookConfig = {
  welcome: {
    goals: { enabled: true },
    aboutYou: { enabled: false },
    knowledgeCheck: { enabled: true },
    aiIntroCall: { enabled: false },
  },
};

describe("welcome-phase read unification (#301)", () => {
  describe("resolveSessionFlow().intake", () => {
    it("prefers sessionFlow.intake over legacy welcome (wizard write)", () => {
      const r = resolveSessionFlow({ playbook: { config: WIZARD_WRITTEN } });
      expect(r.source.intake).toBe("new-shape");
      expect(r.intake.knowledgeCheck.deliveryMode).toBe("socratic");
    });

    it("returns canonical shape for design-tab write (mcq mode)", () => {
      const r = resolveSessionFlow({ playbook: { config: DESIGN_TAB_WRITTEN } });
      expect(r.source.intake).toBe("new-shape");
      expect(r.intake.knowledgeCheck.deliveryMode).toBe("mcq");
    });

    it("falls back to legacy welcome when sessionFlow.intake absent", () => {
      const r = resolveSessionFlow({ playbook: { config: LEGACY_ONLY } });
      expect(r.source.intake).toBe("legacy-welcome");
      expect(r.intake.knowledgeCheck.enabled).toBe(true);
    });
  });

  describe("isPreSurveyEnabled", () => {
    it("reads sessionFlow.intake when present (wizard write)", () => {
      expect(isPreSurveyEnabled(WIZARD_WRITTEN)).toBe(true);
    });

    it("reads sessionFlow.intake when present (design-tab write)", () => {
      expect(isPreSurveyEnabled(DESIGN_TAB_WRITTEN)).toBe(true);
    });

    it("falls back to legacy welcome when sessionFlow.intake absent", () => {
      expect(isPreSurveyEnabled(LEGACY_ONLY)).toBe(true);
    });

    it("respects an explicit all-off intake even if legacy welcome is missing", () => {
      const allOff: PlaybookConfig = {
        sessionFlow: {
          intake: {
            goals: { enabled: false },
            aboutYou: { enabled: false },
            knowledgeCheck: { enabled: false, deliveryMode: "mcq" },
            aiIntroCall: { enabled: false },
          },
        },
      };
      expect(isPreSurveyEnabled(allOff)).toBe(false);
    });

    it("respects intake.* over a stale legacy welcome that disagrees", () => {
      // Simulates the divergence the unification fixes: educator turns kc off
      // via the new shape, but legacy welcome still has it on. Reader must
      // honour the canonical shape.
      const divergent: PlaybookConfig = {
        welcome: {
          goals: { enabled: false },
          aboutYou: { enabled: false },
          knowledgeCheck: { enabled: true },
          aiIntroCall: { enabled: false },
        },
        sessionFlow: {
          intake: {
            goals: { enabled: false },
            aboutYou: { enabled: false },
            knowledgeCheck: { enabled: false, deliveryMode: "mcq" },
            aiIntroCall: { enabled: false },
          },
        },
      };
      expect(isPreSurveyEnabled(divergent)).toBe(false);
    });
  });
});
