import { describe, it, expect } from "vitest";
import { renderPromptSummary, renderVoicePrompt } from "@/lib/prompt/composition/renderPromptSummary";

describe("renderPromptSummary", () => {
  it("renders a complete prompt with all sections", () => {
    const result = renderPromptSummary({
      _quickStart: {
        this_caller: "Alice",
        this_session: "Call #3",
        voice_style: "warm and empathetic",
      },
      memories: {
        totalCount: 5,
        byCategory: {
          FACT: [
            { key: "location", value: "London", confidence: 0.9 },
          ],
          PREFERENCE: [
            { key: "contact", value: "email", confidence: 0.8 },
          ],
        },
      },
    });

    expect(result).toContain("# SESSION PROMPT");
    expect(result).toContain("Alice");
    expect(result).toContain("Call #3");
    expect(result).toContain("Memories");
    expect(result).toContain("FACT");
    expect(result).toContain("location: London");
    expect(result).toContain("PREFERENCE");
  });

  it("renders minimal prompt with no data", () => {
    const result = renderPromptSummary({});
    expect(result).toContain("# SESSION PROMPT");
    expect(result).not.toContain("Memories");
  });

  it("renders all memory categories dynamically (not just hardcoded 4)", () => {
    const result = renderPromptSummary({
      memories: {
        totalCount: 4,
        byCategory: {
          FACT: [{ key: "name", value: "Bob", confidence: 0.9 }],
          EVENT: [{ key: "meeting", value: "scheduled for Tuesday", confidence: 0.7 }],
          CONTEXT: [{ key: "mood", value: "upbeat", confidence: 0.6 }],
          CUSTOM_CAT: [{ key: "custom", value: "test", confidence: 0.5 }],
        },
      },
    });

    // All categories should be rendered — not just the old hardcoded 4
    expect(result).toContain("FACT");
    expect(result).toContain("EVENT");
    expect(result).toContain("CONTEXT");
    expect(result).toContain("CUSTOM_CAT");
    expect(result).toContain("name: Bob");
    expect(result).toContain("meeting: scheduled for Tuesday");
    expect(result).toContain("mood: upbeat");
    expect(result).toContain("custom: test");
  });

  it("renders critical rules from preamble", () => {
    const result = renderPromptSummary({
      _preamble: {
        criticalRules: ["Never share personal data", "Always be respectful"],
      },
    });

    expect(result).toContain("Critical Rules");
    expect(result).toContain("Never share personal data");
    expect(result).toContain("Always be respectful");
  });

  it("handles empty byCategory gracefully", () => {
    const result = renderPromptSummary({
      memories: {
        totalCount: 0,
        byCategory: {},
      },
    });

    // Should still show the memories header with count
    expect(result).not.toContain("FACT");
  });
});

describe("renderVoicePrompt — pacing rules", () => {
  const PACING_RULES = [
    "Confirm readiness before moving to a new topic",
    "Do not give answers before the student has attempted",
    "Do not rush",
    "Treat each session as standalone",
  ];

  it("renders all 4 pacing rules when criticalRules has 9 entries (hasCurriculum path)", () => {
    const result = renderVoicePrompt({
      _preamble: {
        criticalRules: [
          "If RETURNING_CALLER: ALWAYS review before new material",
          "If review fails (caller can't recall): Don't proceed. Re-teach foundation first.",
          "If caller struggles: Back up. Different example. Don't push forward.",
          "If caller wants to skip review: Only allow if they PROVE they know it.",
          "End at natural stopping point, never mid-concept.",
          "Confirm readiness before moving to a new topic — ask 'Ready to move on?' and wait for YES before continuing.",
          "Do not give answers before the student has attempted. Wait, give a hint, wait again.",
          "Do not rush — if the student is mid-thought, stay silent until they finish.",
          "Treat each session as standalone. Never say 'as we covered last time' as fact — say 'if you remember from before...' and re-establish if they don't.",
        ],
      },
    } as any);

    expect(result).toContain("[RULES]");
    for (const rule of PACING_RULES) {
      expect(result).toContain(rule);
    }
  });

  it("renders all 4 pacing rules when criticalRules has 8 entries (no-curriculum path)", () => {
    const result = renderVoicePrompt({
      _preamble: {
        criticalRules: [
          "Do NOT invent, assume, or fabricate specific academic topics, modules, or curriculum.",
          "If the caller mentions a topic, explore it naturally - but do not lead with assumed subjects.",
          "If caller struggles: Back up. Different approach. Don't push forward.",
          "End at natural stopping point.",
          "Confirm readiness before moving to a new topic — ask 'Ready to move on?' and wait for YES before continuing.",
          "Do not give answers before the student has attempted. Wait, give a hint, wait again.",
          "Do not rush — if the student is mid-thought, stay silent until they finish.",
          "Treat each session as standalone. Never say 'as we covered last time' as fact — say 'if you remember from before...' and re-establish if they don't.",
        ],
      },
    } as any);

    expect(result).toContain("[RULES]");
    for (const rule of PACING_RULES) {
      expect(result).toContain(rule);
    }
  });
});

describe("renderVoicePrompt — physical materials", () => {
  it("renders [PHYSICAL MATERIALS] section when physicalMaterials is set", () => {
    const result = renderVoicePrompt({
      physicalMaterials: { description: "CGP KS2 English, pages 12–45" },
    } as any);

    expect(result).toContain("[PHYSICAL MATERIALS]");
    expect(result).toContain("CGP KS2 English, pages 12–45");
    expect(result).toContain("Reference specific pages");
  });

  it("omits [PHYSICAL MATERIALS] section when physicalMaterials is absent", () => {
    const result = renderVoicePrompt({} as any);
    expect(result).not.toContain("[PHYSICAL MATERIALS]");
  });

  it("omits [PHYSICAL MATERIALS] section when description is empty string", () => {
    const result = renderVoicePrompt({
      physicalMaterials: { description: "" },
    } as any);
    expect(result).not.toContain("[PHYSICAL MATERIALS]");
  });
});
