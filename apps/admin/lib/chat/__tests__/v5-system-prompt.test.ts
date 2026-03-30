import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock getPromptSpecs to return the fallback content (avoids DB dependency)
vi.mock("@/lib/prompts/spec-prompts", () => ({
  getPromptSpecs: vi.fn(async (_slugs: string[], fallbacks: Record<string, string>) => {
    // Return all fallbacks as-is — simulates "no DB specs, use fallbacks"
    return fallbacks;
  }),
}));

// Mock interpolateTemplate to pass through (templates have {{placeholders}})
vi.mock("@/lib/prompts/interpolate", () => ({
  interpolateTemplate: vi.fn((template: string, vars: Record<string, string>) => {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
    }
    return result;
  }),
}));

// Mock config with realistic spec slugs
vi.mock("@/lib/config", () => ({
  config: {
    specs: {
      wizIdentity: "PROMPT-WIZ-IDENTITY-001",
      wizComms: "PROMPT-WIZ-COMMS-001",
      wizCommunity: "PROMPT-WIZ-COMMUNITY-001",
      wizOpening: "PROMPT-WIZ-OPENING-001",
      wizPlayback: "PROMPT-WIZ-PLAYBACK-001",
      wizProposal: "PROMPT-WIZ-PROPOSAL-001",
      wizContent: "PROMPT-WIZ-CONTENT-001",
      wizPedagogy: "PROMPT-WIZ-PEDAGOGY-001",
      wizValues: "PROMPT-WIZ-VALUES-001",
      wizRules: "PROMPT-WIZ-RULES-001",
    },
  },
}));

// Mock agent tuning defaults
vi.mock("@/lib/domain/agent-tuning", () => ({
  AGENT_TUNING_DEFAULTS: {
    matrices: [
      {
        name: "Test Matrix",
        presets: [{ name: "Default", description: "A balanced personality" }],
      },
    ],
  },
}));

import { buildV5SystemPrompt } from "../v5-system-prompt";
import type { GraphEvaluation } from "@/lib/wizard/graph-schema";

// ── Helpers ──────────────────────────────────────────────

function emptyEvaluation(): GraphEvaluation {
  return {
    nodeStatuses: new Map(),
    available: [],
    suggested: [],
    blocked: [],
    satisfied: [],
    skipped: [],
    readinessPct: 0,
    missingRequired: [],
    canLaunch: false,
    activeGroup: null,
  };
}

// ── Tests ────────────────────────────────────────────────

describe("buildV5SystemPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a non-empty string with all expected sections", async () => {
    const result = await buildV5SystemPrompt({}, emptyEvaluation());
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
    // Should contain the identity section
    expect(result).toContain("HumanFirst Studio setup assistant");
    // Should contain the communication section
    expect(result).toContain("How you communicate");
    // Should contain the rules section
    expect(result).toContain("NO DEAD ENDS");
  });

  it("includes playback banner when intake data present but no courseContext", async () => {
    const setupData = {
      courseName: "GCSE Biology",
      subjectDiscipline: "Biology",
    };
    const result = await buildV5SystemPrompt(setupData, emptyEvaluation());
    expect(result).toContain("PLAYBACK NEEDED NOW");
  });

  it("omits playback banner when courseContext is already set", async () => {
    const setupData = {
      courseName: "GCSE Biology",
      subjectDiscipline: "Biology",
      courseContext: "This is a GCSE Biology course for Year 10 students.",
    };
    const result = await buildV5SystemPrompt(setupData, emptyEvaluation());
    expect(result).not.toContain("PLAYBACK NEEDED NOW");
  });

  it("omits playback banner when phase 2 has started", async () => {
    const setupData = {
      courseName: "GCSE Biology",
      interactionPattern: "socratic",
    };
    const result = await buildV5SystemPrompt(setupData, emptyEvaluation());
    expect(result).not.toContain("PLAYBACK NEEDED NOW");
  });

  it("includes community section", async () => {
    const result = await buildV5SystemPrompt({}, emptyEvaluation());
    expect(result).toContain("Community hub detection");
  });

  it("skips non-community values when domain is COMMUNITY", async () => {
    const setupData = { defaultDomainKind: "COMMUNITY" };
    const result = await buildV5SystemPrompt(setupData, emptyEvaluation());
    // Community mode should NOT include session structure options
    expect(result).not.toContain("### Teaching emphasis");
    expect(result).not.toContain("### Session structure");
  });

  it("includes teaching emphasis for non-community courses", async () => {
    const result = await buildV5SystemPrompt({}, emptyEvaluation());
    expect(result).toContain("Teaching emphasis");
    expect(result).toContain("Session structure");
  });

  it("includes pedagogy section when courseRefEnabled is true", async () => {
    const setupData = { courseRefEnabled: true };
    const result = await buildV5SystemPrompt(setupData, emptyEvaluation());
    expect(result).toContain("Teaching Guide");
    expect(result).toContain("Skills Framework");
  });

  it("excludes pedagogy section when courseRefEnabled is false", async () => {
    const result = await buildV5SystemPrompt({}, emptyEvaluation());
    expect(result).not.toContain("Skills Framework");
  });

  it("conditionally hides completed pedagogy sub-sections", async () => {
    const setupData = {
      courseRefEnabled: true,
      skillsFramework: [{ id: "SKILL-01", name: "Analysis", tiers: { emerging: "x", developing: "y", secure: "z" } }],
      teachingPrinciples: { corePrinciples: ["Be encouraging"] },
    };
    const result = await buildV5SystemPrompt(setupData, emptyEvaluation());
    // Skills Framework should be excluded (already collected)
    expect(result).not.toContain("### Skills Framework");
    // Teaching Principles should be excluded (already collected)
    expect(result).not.toContain("### Teaching Principles");
    // Course Phases should still be present
    expect(result).toContain("### Course Phases");
    // Edge Cases should still be present
    expect(result).toContain("### Edge Cases");
  });

  it("includes institution context when institutionName is set", async () => {
    const setupData = { institutionName: "Oxford Academy" };
    const result = await buildV5SystemPrompt(setupData, emptyEvaluation());
    expect(result).toContain("Oxford Academy");
    expect(result).toContain("Do NOT ask for it again");
  });

  it("asks for institution when institutionName is missing", async () => {
    const result = await buildV5SystemPrompt({}, emptyEvaluation());
    expect(result).toContain("No institution on record");
  });

  it("includes amendment tier post-scaffold", async () => {
    const setupData = { draftPlaybookId: "pb-123" };
    const result = await buildV5SystemPrompt(setupData, emptyEvaluation());
    expect(result).toContain("POST-SCAFFOLD");
    expect(result).toContain("pb-123");
  });

  it("includes amendment tier pre-scaffold when no playbook", async () => {
    const result = await buildV5SystemPrompt({}, emptyEvaluation());
    expect(result).toContain("PRE-SCAFFOLD");
  });

  it("includes personality presets", async () => {
    const result = await buildV5SystemPrompt({}, emptyEvaluation());
    expect(result).toContain("Test Matrix");
    expect(result).toContain("Default");
  });

  it("includes subject catalog when provided", async () => {
    const catalog = [
      { category: "Science", label: "Biology", slug: "biology" },
      { category: "Science", label: "Chemistry", slug: "chemistry" },
    ];
    const result = await buildV5SystemPrompt({}, emptyEvaluation(), [], catalog);
    expect(result).toContain("Biology");
    expect(result).toContain("Chemistry");
    expect(result).toContain("Science");
  });
});
