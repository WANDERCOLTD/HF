/**
 * Tests for interaction pattern + communication style logic (lib/content-trust/resolve-config.ts)
 *
 * Key behavior:
 *   - applyPatternOverrides: prepends intentPreamble to systemPrompt, appends unique supplementaryCategories
 *   - suggestInteractionPattern: keyword-based auto-suggest, longest-match-first, case-insensitive
 *   - COMMUNICATION_STYLE_ORDER has exactly 7 entries
 *   - INTERACTION_PATTERN_ORDER has exactly 9 entries
 *   - INTENT_PATTERN_OVERRIDES is defined for all 9 patterns
 *
 * No DB or external deps — all pure functions.
 */

import { describe, it, expect } from "vitest";
import {
  applyPatternOverrides,
  suggestInteractionPattern,
  COMMUNICATION_STYLE_ORDER,
  INTERACTION_PATTERN_ORDER,
  INTENT_PATTERN_OVERRIDES,
  INTERACTION_PATTERN_LABELS,
  COMMUNICATION_STYLE_LABELS,
  type ExtractionConfig,
  type InteractionPattern,
} from "@/lib/content-trust/resolve-config";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Minimal ExtractionConfig with just what applyPatternOverrides needs */
function makeConfig(overrides?: Partial<ExtractionConfig["extraction"]>): ExtractionConfig {
  return {
    extraction: {
      systemPrompt: "BASE PROMPT",
      categories: [
        { id: "fact",       label: "Fact",       description: "A fact" },
        { id: "definition", label: "Definition", description: "A definition" },
      ],
      llmConfig: { temperature: 0.1, maxTokens: 4000 },
      chunkSize: 8000,
      maxAssertionsPerDocument: 500,
      rules: { requirePrecision: [], noInvention: true, trackTaxYear: false, trackValidity: true },
      ...overrides,
    },
    structuring: {
      systemPrompt: "",
      levels: [],
      targetChildCount: 3,
      llmConfig: { temperature: 0.2, maxTokens: 8000 },
    },
    rendering: {
      defaultMaxDepth: 3,
      depthAdaptation: { entryLevel: -1, fastPace: -1, advancedPriorKnowledge: -1 },
    },
    classification: {
      systemPrompt: "",
      llmConfig: { temperature: 0.1, maxTokens: 500 },
      sampleSize: 2000,
      fewShot: { enabled: false, maxExamples: 5, exampleSampleSize: 500, domainAware: false },
    },
    typeOverrides: {},
  };
}

// ─── applyPatternOverrides ────────────────────────────────────────────────────

describe("applyPatternOverrides", () => {
  it("returns config unchanged when pattern is undefined", () => {
    const cfg = makeConfig();
    const result = applyPatternOverrides(cfg, undefined);
    expect(result).toBe(cfg); // same reference — no copy
  });

  it("prepends intentPreamble to systemPrompt", () => {
    const cfg = makeConfig();
    const result = applyPatternOverrides(cfg, "directive");

    const expected = INTENT_PATTERN_OVERRIDES.directive.intentPreamble;
    // Preamble appears at the start (index 0)
    expect(result.extraction.systemPrompt.indexOf(expected)).toBe(0);
    expect(result.extraction.systemPrompt).toContain("\n\nBASE PROMPT");
  });

  it("preserves base systemPrompt in full after preamble", () => {
    const cfg = makeConfig();
    const result = applyPatternOverrides(cfg, "socratic");

    expect(result.extraction.systemPrompt).toContain("BASE PROMPT");
  });

  it("appends supplementary categories that are not already present", () => {
    const cfg = makeConfig();
    const before = cfg.extraction.categories.length;
    const result = applyPatternOverrides(cfg, "directive");

    const addedIds = INTENT_PATTERN_OVERRIDES.directive.supplementaryCategories!.map(c => c.id);
    const resultIds = result.extraction.categories.map(c => c.id);

    // All added ids present
    for (const id of addedIds) {
      expect(resultIds).toContain(id);
    }
    // Total count increased
    expect(result.extraction.categories.length).toBe(before + addedIds.length);
  });

  it("does NOT duplicate categories already present", () => {
    // Pre-load config with a category that matches a supplementary one
    const supplementaryId = INTENT_PATTERN_OVERRIDES.directive.supplementaryCategories![0].id;
    const cfg = makeConfig({
      categories: [
        { id: supplementaryId, label: "Already here", description: "Pre-existing" },
        { id: "fact", label: "Fact", description: "A fact" },
      ],
    });

    const before = cfg.extraction.categories.length;
    const result = applyPatternOverrides(cfg, "directive");

    // Count of supplementaryId in result should still be 1
    const count = result.extraction.categories.filter(c => c.id === supplementaryId).length;
    expect(count).toBe(1);
    // Total didn't grow by the duplicated item
    expect(result.extraction.categories.length).toBe(before);
  });

  it("does not mutate the original config", () => {
    const cfg = makeConfig();
    const originalPrompt = cfg.extraction.systemPrompt;
    const originalCatCount = cfg.extraction.categories.length;

    applyPatternOverrides(cfg, "socratic");

    expect(cfg.extraction.systemPrompt).toBe(originalPrompt);
    expect(cfg.extraction.categories.length).toBe(originalCatCount);
  });

  it.each(INTERACTION_PATTERN_ORDER)("applies override for pattern: %s", (pattern) => {
    const cfg = makeConfig();
    const result = applyPatternOverrides(cfg, pattern as InteractionPattern);

    // systemPrompt must have changed (preamble prepended)
    expect(result.extraction.systemPrompt).not.toBe("BASE PROMPT");
    expect(result.extraction.systemPrompt.length).toBeGreaterThan("BASE PROMPT".length);
  });

  it("adds socratic supplementary categories (dilemma, discussion_prompt)", () => {
    const cfg = makeConfig();
    const result = applyPatternOverrides(cfg, "socratic");
    const ids = result.extraction.categories.map(c => c.id);
    expect(ids).toContain("dilemma");
    expect(ids).toContain("discussion_prompt");
  });

  it("adds advisory supplementary categories (caveat, citation)", () => {
    const cfg = makeConfig();
    const result = applyPatternOverrides(cfg, "advisory");
    const ids = result.extraction.categories.map(c => c.id);
    expect(ids).toContain("caveat");
    expect(ids).toContain("citation");
  });

  it("adds coaching supplementary categories (action_step, reflection_question)", () => {
    const cfg = makeConfig();
    const result = applyPatternOverrides(cfg, "coaching");
    const ids = result.extraction.categories.map(c => c.id);
    expect(ids).toContain("action_step");
    expect(ids).toContain("reflection_question");
  });

  it("adds companion supplementary categories (normalising_statement)", () => {
    const cfg = makeConfig();
    const result = applyPatternOverrides(cfg, "companion");
    const ids = result.extraction.categories.map(c => c.id);
    expect(ids).toContain("normalising_statement");
  });

  it("adds conversational-guide supplementary categories (talking_point, conversation_starter)", () => {
    const cfg = makeConfig();
    const result = applyPatternOverrides(cfg, "conversational-guide");
    const ids = result.extraction.categories.map(c => c.id);
    expect(ids).toContain("talking_point");
    expect(ids).toContain("conversation_starter");
  });

  it("open pattern has no supplementaryCategories — category count unchanged", () => {
    const cfg = makeConfig();
    const before = cfg.extraction.categories.length;
    const result = applyPatternOverrides(cfg, "open");
    expect(result.extraction.categories.length).toBe(before);
  });
});

// ─── suggestInteractionPattern ────────────────────────────────────────────────

describe("suggestInteractionPattern", () => {
  it("returns null for empty string", () => {
    expect(suggestInteractionPattern("")).toBeNull();
  });

  it("returns null for whitespace only", () => {
    expect(suggestInteractionPattern("  ")).toBeNull();
  });

  it("returns null for very short string (< 3 chars)", () => {
    expect(suggestInteractionPattern("AB")).toBeNull();
  });

  it("returns null when no keyword matches", () => {
    expect(suggestInteractionPattern("Advanced Thermodynamics")).toBeNull();
  });

  // Directive
  it("matches 'lesson' → directive", () => {
    expect(suggestInteractionPattern("Year 9 English Lesson")).toBe("directive");
  });

  it("matches 'tutorial' → directive", () => {
    expect(suggestInteractionPattern("Python Tutorial")).toBe("directive");
  });

  it("matches 'training' → directive", () => {
    expect(suggestInteractionPattern("New Staff Training")).toBe("directive");
  });

  // Socratic
  it("matches 'seminar' → socratic", () => {
    expect(suggestInteractionPattern("Philosophy Seminar")).toBe("socratic");
  });

  it("matches 'debate' → socratic", () => {
    expect(suggestInteractionPattern("Climate Change Debate")).toBe("socratic");
  });

  it("matches 'critical thinking' → socratic (multi-word)", () => {
    expect(suggestInteractionPattern("Critical Thinking Workshop")).toBe("socratic");
  });

  // Advisory
  it("matches 'compliance' → advisory", () => {
    expect(suggestInteractionPattern("GDPR Compliance Training")).toBe("advisory");
  });

  it("matches 'legal' → advisory", () => {
    expect(suggestInteractionPattern("Legal Contracts Overview")).toBe("advisory");
  });

  it("matches 'financial' → advisory", () => {
    expect(suggestInteractionPattern("Financial Planning Basics")).toBe("advisory");
  });

  // Coaching
  it("matches 'coach' → coaching", () => {
    expect(suggestInteractionPattern("Executive Coaching Session")).toBe("coaching");
  });

  it("matches 'leadership' → coaching", () => {
    expect(suggestInteractionPattern("Leadership Development Programme")).toBe("coaching");
  });

  it("matches 'personal development' → coaching (multi-word)", () => {
    expect(suggestInteractionPattern("Personal Development Planning")).toBe("coaching");
  });

  // Companion
  it("matches 'wellbeing' → companion", () => {
    expect(suggestInteractionPattern("Student Wellbeing Programme")).toBe("companion");
  });

  it("matches 'mental health' → companion (multi-word)", () => {
    expect(suggestInteractionPattern("Mental Health at Work")).toBe("companion");
  });

  it("matches 'counsel' → companion", () => {
    expect(suggestInteractionPattern("Bereavement Counselling")).toBe("companion");
  });

  // Facilitation
  it("matches 'workshop' → facilitation", () => {
    expect(suggestInteractionPattern("Team Decision Workshop")).toBe("facilitation");
  });

  it("matches 'facilitat' → facilitation", () => {
    expect(suggestInteractionPattern("Facilitating Group Decisions")).toBe("facilitation");
  });

  // Reflective
  it("matches 'reflect' → reflective", () => {
    expect(suggestInteractionPattern("Reflective Practice for Teachers")).toBe("reflective");
  });

  it("matches 'journal' → reflective", () => {
    expect(suggestInteractionPattern("Daily Journaling Practice")).toBe("reflective");
  });

  it("matches 'supervision' → reflective", () => {
    expect(suggestInteractionPattern("Clinical Supervision Sessions")).toBe("reflective");
  });

  // Conversational Guide
  it("matches 'book club' → conversational-guide", () => {
    expect(suggestInteractionPattern("Monthly Book Club")).toBe("conversational-guide");
  });

  it("matches 'discussion group' → conversational-guide", () => {
    expect(suggestInteractionPattern("History Discussion Group")).toBe("conversational-guide");
  });

  it("matches 'community hub' → conversational-guide", () => {
    expect(suggestInteractionPattern("My Community Hub")).toBe("conversational-guide");
  });

  // Case insensitivity
  it("is case-insensitive", () => {
    expect(suggestInteractionPattern("LESSON PLAN REVIEW")).toBe("directive");
    expect(suggestInteractionPattern("Executive COACHING")).toBe("coaching");
  });

  // Longest match wins
  it("matches 'personal development' (multi-word) before 'develop' substring", () => {
    expect(suggestInteractionPattern("Personal Development Goals")).toBe("coaching");
  });
});

// ─── Constants shape ──────────────────────────────────────────────────────────

describe("COMMUNICATION_STYLE constants", () => {
  it("has exactly 7 communication styles", () => {
    expect(COMMUNICATION_STYLE_ORDER).toHaveLength(7);
  });

  it("COMMUNICATION_STYLE_LABELS has an entry for every style in ORDER", () => {
    for (const style of COMMUNICATION_STYLE_ORDER) {
      expect(COMMUNICATION_STYLE_LABELS).toHaveProperty(style);
      expect(COMMUNICATION_STYLE_LABELS[style].label).toBeTruthy();
      expect(COMMUNICATION_STYLE_LABELS[style].icon).toBeTruthy();
    }
  });

  it("contains all expected styles", () => {
    expect(COMMUNICATION_STYLE_ORDER).toContain("tutor");
    expect(COMMUNICATION_STYLE_ORDER).toContain("coach");
    expect(COMMUNICATION_STYLE_ORDER).toContain("companion");
    expect(COMMUNICATION_STYLE_ORDER).toContain("guide");
    expect(COMMUNICATION_STYLE_ORDER).toContain("mentor");
    expect(COMMUNICATION_STYLE_ORDER).toContain("facilitator");
    expect(COMMUNICATION_STYLE_ORDER).toContain("advisor");
  });
});

describe("INTERACTION_PATTERN constants", () => {
  it("has exactly 9 interaction patterns", () => {
    expect(INTERACTION_PATTERN_ORDER).toHaveLength(9);
  });

  it("INTERACTION_PATTERN_LABELS has an entry for every pattern in ORDER", () => {
    for (const pattern of INTERACTION_PATTERN_ORDER) {
      expect(INTERACTION_PATTERN_LABELS).toHaveProperty(pattern);
      expect(INTERACTION_PATTERN_LABELS[pattern].label).toBeTruthy();
      expect(INTERACTION_PATTERN_LABELS[pattern].icon).toBeTruthy();
    }
  });

  it("INTENT_PATTERN_OVERRIDES has an entry for every pattern", () => {
    for (const pattern of INTERACTION_PATTERN_ORDER) {
      expect(INTENT_PATTERN_OVERRIDES).toHaveProperty(pattern);
      expect(INTENT_PATTERN_OVERRIDES[pattern as InteractionPattern].intentPreamble.length).toBeGreaterThan(0);
    }
  });

  it("contains all expected patterns", () => {
    expect(INTERACTION_PATTERN_ORDER).toContain("socratic");
    expect(INTERACTION_PATTERN_ORDER).toContain("directive");
    expect(INTERACTION_PATTERN_ORDER).toContain("advisory");
    expect(INTERACTION_PATTERN_ORDER).toContain("coaching");
    expect(INTERACTION_PATTERN_ORDER).toContain("companion");
    expect(INTERACTION_PATTERN_ORDER).toContain("facilitation");
    expect(INTERACTION_PATTERN_ORDER).toContain("reflective");
    expect(INTERACTION_PATTERN_ORDER).toContain("open");
    expect(INTERACTION_PATTERN_ORDER).toContain("conversational-guide");
  });
});
