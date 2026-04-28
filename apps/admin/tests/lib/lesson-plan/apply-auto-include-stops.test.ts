import { describe, it, expect, vi } from "vitest";
import type { PlaybookConfig } from "@/lib/types/json-fields";

// Mock session-ui so applyAutoIncludeStops sees survey types with autoInclude positions.
vi.mock("@/lib/lesson-plan/session-ui", () => ({
  getSessionTypeConfig: vi.fn(async () => ({
    types: [
      {
        value: "pre_survey",
        label: "Pre-Survey",
        educatorLabel: "Pre-Survey",
        category: "survey",
        color: "#000",
        icon: "ClipboardList",
        autoInclude: "before_first",
        canSkip: true,
        sortOrder: 0,
      },
      {
        value: "post_survey",
        label: "Post-Survey",
        educatorLabel: "Post-Survey",
        category: "survey",
        color: "#000",
        icon: "ClipboardList",
        autoInclude: "after_last",
        canSkip: true,
        sortOrder: 9,
      },
    ],
    educatorTypes: [],
  })),
}));

import { applyAutoIncludeStops, type PlanEntry } from "@/lib/lesson-plan/apply-auto-include-stops";
import { isPreSurveyEnabled } from "@/lib/learner/survey-config";

const teaching: PlanEntry[] = [
  { session: 1, type: "introduce", label: "Module A" },
  { session: 2, type: "deepen", label: "Module A — deeper" },
];

describe("isPreSurveyEnabled", () => {
  it("returns true when no welcome config (legacy playbook)", () => {
    expect(isPreSurveyEnabled({} as PlaybookConfig)).toBe(true);
  });

  it("returns true on null/undefined config", () => {
    expect(isPreSurveyEnabled(null)).toBe(true);
    expect(isPreSurveyEnabled(undefined)).toBe(true);
  });

  it("returns true when DEFAULT_WELCOME_CONFIG (goals + aboutYou on, knowledgeCheck off)", () => {
    const cfg: PlaybookConfig = {
      welcome: {
        goals: { enabled: true },
        aboutYou: { enabled: true },
        knowledgeCheck: { enabled: false },
        aiIntroCall: { enabled: false },
      },
    };
    expect(isPreSurveyEnabled(cfg)).toBe(true);
  });

  it("returns true when only goals enabled", () => {
    const cfg: PlaybookConfig = {
      welcome: {
        goals: { enabled: true },
        aboutYou: { enabled: false },
        knowledgeCheck: { enabled: false },
        aiIntroCall: { enabled: false },
      },
    };
    expect(isPreSurveyEnabled(cfg)).toBe(true);
  });

  it("returns true when only aboutYou enabled", () => {
    const cfg: PlaybookConfig = {
      welcome: {
        goals: { enabled: false },
        aboutYou: { enabled: true },
        knowledgeCheck: { enabled: false },
        aiIntroCall: { enabled: false },
      },
    };
    expect(isPreSurveyEnabled(cfg)).toBe(true);
  });

  it("returns true when only knowledgeCheck enabled", () => {
    const cfg: PlaybookConfig = {
      welcome: {
        goals: { enabled: false },
        aboutYou: { enabled: false },
        knowledgeCheck: { enabled: true },
        aiIntroCall: { enabled: false },
      },
    };
    expect(isPreSurveyEnabled(cfg)).toBe(true);
  });

  it("returns false when all three welcome phases disabled", () => {
    const cfg: PlaybookConfig = {
      welcome: {
        goals: { enabled: false },
        aboutYou: { enabled: false },
        knowledgeCheck: { enabled: false },
        aiIntroCall: { enabled: false },
      },
    };
    expect(isPreSurveyEnabled(cfg)).toBe(false);
  });

  it("ignores aiIntroCall (it does not gate the pre-survey)", () => {
    // aiIntroCall on but everything else off → still false
    const cfg: PlaybookConfig = {
      welcome: {
        goals: { enabled: false },
        aboutYou: { enabled: false },
        knowledgeCheck: { enabled: false },
        aiIntroCall: { enabled: true },
      },
    };
    expect(isPreSurveyEnabled(cfg)).toBe(false);
  });

  it("partial config: missing goals defaults to true (legacy field absence)", () => {
    // Construct a partial — bypass typing for the legacy-shape case
    const cfg = { welcome: { aboutYou: { enabled: false }, knowledgeCheck: { enabled: false } } } as unknown as PlaybookConfig;
    expect(isPreSurveyEnabled(cfg)).toBe(true);
  });

  it("partial config: missing knowledgeCheck defaults to false", () => {
    const cfg = { welcome: { goals: { enabled: false }, aboutYou: { enabled: false } } } as unknown as PlaybookConfig;
    // goals false, aboutYou false, knowledgeCheck missing → ?? false → all false
    expect(isPreSurveyEnabled(cfg)).toBe(false);
  });
});

describe("applyAutoIncludeStops", () => {
  it("injects pre_survey when at least one welcome phase is enabled", async () => {
    const cfg: PlaybookConfig = {
      welcome: {
        goals: { enabled: true },
        aboutYou: { enabled: false },
        knowledgeCheck: { enabled: false },
        aiIntroCall: { enabled: false },
      },
    };
    const result = await applyAutoIncludeStops(teaching, cfg);
    const types = result.map((e) => e.type);
    expect(types).toContain("pre_survey");
    expect(types[0]).toBe("pre_survey"); // before_first
  });

  it("omits pre_survey when ALL welcome phases are disabled", async () => {
    const cfg: PlaybookConfig = {
      welcome: {
        goals: { enabled: false },
        aboutYou: { enabled: false },
        knowledgeCheck: { enabled: false },
        aiIntroCall: { enabled: false },
      },
    };
    const result = await applyAutoIncludeStops(teaching, cfg);
    expect(result.map((e) => e.type)).not.toContain("pre_survey");
  });

  it("legacy playbook (no welcome config) defaults to pre_survey injected", async () => {
    const cfg: PlaybookConfig = {};
    const result = await applyAutoIncludeStops(teaching, cfg);
    expect(result.map((e) => e.type)).toContain("pre_survey");
  });

  it("post_survey gated by surveys.post.enabled (no welcome-side mirror)", async () => {
    const cfg: PlaybookConfig = {
      welcome: { goals: { enabled: true }, aboutYou: { enabled: true }, knowledgeCheck: { enabled: false }, aiIntroCall: { enabled: false } },
      surveys: { post: { enabled: true } },
    };
    const result = await applyAutoIncludeStops(teaching, cfg);
    const types = result.map((e) => e.type);
    expect(types).toContain("post_survey");
  });

  it("post_survey omitted when surveys.post.enabled is false / missing", async () => {
    const cfg: PlaybookConfig = {
      welcome: { goals: { enabled: true }, aboutYou: { enabled: true }, knowledgeCheck: { enabled: false }, aiIntroCall: { enabled: false } },
    };
    const result = await applyAutoIncludeStops(teaching, cfg);
    expect(result.map((e) => e.type)).not.toContain("post_survey");
  });

  it("renumbers entries sequentially after injection", async () => {
    const cfg: PlaybookConfig = {
      welcome: { goals: { enabled: true }, aboutYou: { enabled: true }, knowledgeCheck: { enabled: false }, aiIntroCall: { enabled: false } },
      surveys: { post: { enabled: true } },
    };
    const result = await applyAutoIncludeStops(teaching, cfg);
    expect(result.map((e) => e.session)).toEqual(result.map((_, i) => i + 1));
  });

  it("ignores stale legacy surveys.pre.enabled — welcome.* is the only signal for pre", async () => {
    // Stored data could still have surveys.pre.enabled = true from before this fix.
    // The helper must ignore it; only welcome.* drives gating.
    const cfg = {
      welcome: {
        goals: { enabled: false },
        aboutYou: { enabled: false },
        knowledgeCheck: { enabled: false },
        aiIntroCall: { enabled: false },
      },
      surveys: { pre: { enabled: true } }, // legacy stored value — must be ignored
    } as unknown as PlaybookConfig;
    const result = await applyAutoIncludeStops(teaching, cfg);
    expect(result.map((e) => e.type)).not.toContain("pre_survey");
  });
});
