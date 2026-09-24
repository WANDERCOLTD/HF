/**
 * Tests for lib/bdd/ai-parser.ts
 *
 * Tests the AI-powered BDD parser that extracts structured data from XML/text,
 * and the direct JSON spec parser for well-formed spec files.
 *
 * For AI-dependent functions (parseWithAI, parseHybridWithAI), the AI call
 * is mocked and tests verify correct processing of the AI response.
 *
 * Covers:
 * - detectContentTypes(): content type detection (parameters, story)
 * - detectFileType(): file type classification (STORY, PARAMETER, HYBRID)
 * - isJsonSpec(): JSON spec detection
 * - parseJsonSpec(): direct JSON spec parsing with validation
 * - convertJsonSpecToHybrid(): conversion to hybrid parsed result
 * - parseWithAI(): AI-powered parsing (mocked AI call)
 * - parseHybridWithAI(): hybrid parsing (mocked AI call)
 * - parseBDDSpec(): unified entry point
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  detectContentTypes,
  detectFileType,
  isJsonSpec,
  parseJsonSpec,
  convertJsonSpecToHybrid,
  parseWithAI,
  parseHybridWithAI,
  parseBDDSpec,
} from "@/lib/bdd/ai-parser";
import type { JsonFeatureSpec } from "@/lib/bdd/ai-parser";

// Mock the metering module (AI call boundary)
vi.mock("@/lib/metering", () => ({
  getConfiguredMeteredAICompletion: vi.fn(),
}));

import { getConfiguredMeteredAICompletion } from "@/lib/metering";
const mockAICompletion = vi.mocked(getConfiguredMeteredAICompletion);

beforeEach(() => {
  vi.clearAllMocks();
});

// =====================================================
// FIXTURES
// =====================================================

const VALID_JSON_SPEC: JsonFeatureSpec = {
  id: "TEST-001",
  title: "Test Spec",
  version: "1.0",
  story: {
    asA: "system",
    iWant: "to test",
    soThat: "it works",
  },
  parameters: [
    {
      id: "P-001",
      name: "test_param",
      description: "A test parameter",
      targetRange: { min: 0, max: 1 },
      subMetrics: [
        { id: "SM-1", name: "sub1", weight: 0.5, description: "Sub metric 1" },
      ],
      promptGuidance: {
        whenHigh: "Do more",
        whenLow: "Do less",
      },
      interpretationScale: [
        { min: 0, max: 0.5, label: "Low", implication: "Needs work" },
        { min: 0.5, max: 1, label: "High", implication: "Good" },
      ],
      scoringAnchors: [
        { score: 0.9, example: "Excellent example", rationale: "Clear and precise" },
      ],
    },
  ],
  specRole: "MEASURE",
  outputType: "MEASURE",
  acceptanceCriteria: [
    {
      id: "AC-1",
      title: "Basic Test",
      given: "a system",
      when: "tested",
      then: "it passes",
    },
  ],
  constraints: [
    { id: "C-1", description: "Must be fast", severity: "warning" },
  ],
  failureConditions: [
    { id: "F-1", trigger: "Timeout", severity: "critical", threshold: { operator: ">", value: 5 } },
  ],
};

// =====================================================
// detectContentTypes
// =====================================================

describe("detectContentTypes", () => {
  it("detects parameter content from <parameter_measurement_guide>", () => {
    const result = detectContentTypes("<parameter_measurement_guide>...</parameter_measurement_guide>");
    expect(result.hasParameters).toBe(true);
    expect(result.hasStory).toBe(false);
  });

  it("detects parameter content from <parameter id=...>", () => {
    const result = detectContentTypes('<parameter id="P-001">...</parameter>');
    expect(result.hasParameters).toBe(true);
  });

  it("detects parameter content from <submetric>", () => {
    const result = detectContentTypes("<submetric>...</submetric>");
    expect(result.hasParameters).toBe(true);
  });

  it("detects parameter content from <formula>", () => {
    const result = detectContentTypes("<formula>x + y</formula>");
    expect(result.hasParameters).toBe(true);
  });

  it("detects parameter content from <target_range>", () => {
    const result = detectContentTypes('<target_range min="0" max="1" />');
    expect(result.hasParameters).toBe(true);
  });

  it("detects parameter content from <interpretation_scale>", () => {
    const result = detectContentTypes("<interpretation_scale>...</interpretation_scale>");
    expect(result.hasParameters).toBe(true);
  });

  it("detects story content from <bdd_story>", () => {
    const result = detectContentTypes('<bdd_story id="S-001">...</bdd_story>');
    expect(result.hasStory).toBe(true);
    expect(result.hasParameters).toBe(false);
  });

  it("detects story content from <user_story>", () => {
    const result = detectContentTypes("<user_story>...</user_story>");
    expect(result.hasStory).toBe(true);
  });

  it("detects story content from <acceptance_criteria>", () => {
    const result = detectContentTypes("<acceptance_criteria>...</acceptance_criteria>");
    expect(result.hasStory).toBe(true);
  });

  it("detects story content from <constraints>", () => {
    const result = detectContentTypes("<constraints>...</constraints>");
    expect(result.hasStory).toBe(true);
  });

  it("detects story content from <failure_conditions>", () => {
    const result = detectContentTypes("<failure_conditions>...</failure_conditions>");
    expect(result.hasStory).toBe(true);
  });

  it("detects story content from combined <as_a>/<i_want>/<so_that>", () => {
    const result = detectContentTypes("<as_a>user</as_a><i_want>thing</i_want><so_that>goal</so_that>");
    expect(result.hasStory).toBe(true);
  });

  it("detects both parameter and story content", () => {
    const result = detectContentTypes(
      '<bdd_story id="S-001"><parameter id="P-001"><formula>x</formula></parameter></bdd_story>'
    );
    expect(result.hasParameters).toBe(true);
    expect(result.hasStory).toBe(true);
  });

  it("returns false for both when content has neither", () => {
    const result = detectContentTypes("Just some plain text with no markers");
    expect(result.hasParameters).toBe(false);
    expect(result.hasStory).toBe(false);
  });

  it("is case insensitive", () => {
    const result = detectContentTypes("<BDD_STORY>...</BDD_STORY>");
    expect(result.hasStory).toBe(true);
  });
});

// =====================================================
// detectFileType
// =====================================================

describe("detectFileType", () => {
  it("returns HYBRID when both parameter and story markers present", () => {
    const content = '<bdd_story><parameter id="P-1"><formula>x</formula></parameter></bdd_story>';
    expect(detectFileType(content, "test.xml")).toBe("HYBRID");
  });

  it("returns PARAMETER when only parameter markers present", () => {
    const content = '<parameter_measurement_guide><parameter id="P-1">...</parameter></parameter_measurement_guide>';
    expect(detectFileType(content, "test.xml")).toBe("PARAMETER");
  });

  it("returns STORY when only story markers present", () => {
    const content = '<bdd_story id="S-1"><user_story>...</user_story></bdd_story>';
    expect(detectFileType(content, "test.xml")).toBe("STORY");
  });

  it("falls back to filename .param.xml for PARAMETER", () => {
    expect(detectFileType("no markers", "spec.param.xml")).toBe("PARAMETER");
  });

  it("falls back to filename .bdd.xml for STORY", () => {
    expect(detectFileType("no markers", "spec.bdd.xml")).toBe("STORY");
  });

  it("falls back to filename with .param. in the middle", () => {
    expect(detectFileType("no markers", "my.param.v2.xml")).toBe("PARAMETER");
  });

  it("falls back to filename with .bdd. in the middle", () => {
    expect(detectFileType("no markers", "my.bdd.v2.xml")).toBe("STORY");
  });

  it("defaults to STORY when nothing matches", () => {
    expect(detectFileType("no markers", "unknown.txt")).toBe("STORY");
  });
});

// =====================================================
// isJsonSpec
// =====================================================

describe("isJsonSpec", () => {
  it("returns true for valid .spec.json files", () => {
    const content = JSON.stringify(VALID_JSON_SPEC);
    expect(isJsonSpec(content, "test.spec.json")).toBe(true);
  });

  it("returns true for valid .json files with spec structure", () => {
    const content = JSON.stringify(VALID_JSON_SPEC);
    expect(isJsonSpec(content, "test.json")).toBe(true);
  });

  it("returns false for non-JSON filenames", () => {
    const content = JSON.stringify(VALID_JSON_SPEC);
    expect(isJsonSpec(content, "test.xml")).toBe(false);
  });

  it("returns false for invalid JSON content", () => {
    expect(isJsonSpec("not json {", "test.json")).toBe(false);
  });

  it("returns false for JSON missing required fields", () => {
    expect(isJsonSpec('{"name": "test"}', "test.json")).toBe(false);
  });

  it("returns false for JSON missing parameters", () => {
    const partial = JSON.stringify({ id: "X", title: "Y", story: { asA: "a", iWant: "b", soThat: "c" } });
    expect(isJsonSpec(partial, "test.json")).toBe(false);
  });
});

// =====================================================
// parseJsonSpec
// =====================================================

describe("parseJsonSpec", () => {
  it("parses valid spec JSON successfully", () => {
    const result = parseJsonSpec(JSON.stringify(VALID_JSON_SPEC));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("TEST-001");
      expect(result.data.title).toBe("Test Spec");
      expect(result.data.parameters).toHaveLength(1);
    }
  });

  it("returns error for missing id", () => {
    const spec = { ...VALID_JSON_SPEC, id: undefined };
    const result = parseJsonSpec(JSON.stringify(spec));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toContain("Missing required field: id");
    }
  });

  it("returns error for missing title", () => {
    const spec = { ...VALID_JSON_SPEC, title: undefined };
    const result = parseJsonSpec(JSON.stringify(spec));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toContain("Missing required field: title");
    }
  });

  it("returns error for missing version", () => {
    const spec = { ...VALID_JSON_SPEC, version: undefined };
    const result = parseJsonSpec(JSON.stringify(spec));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toContain("Missing required field: version");
    }
  });

  it("returns error for missing story", () => {
    const spec = { ...VALID_JSON_SPEC, story: undefined };
    const result = parseJsonSpec(JSON.stringify(spec));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toContain("Missing required field: story");
    }
  });

  it("returns error for missing parameters array", () => {
    const spec = { ...VALID_JSON_SPEC, parameters: undefined };
    const result = parseJsonSpec(JSON.stringify(spec));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toContain("Missing required field: parameters (must be array)");
    }
  });

  it("returns error for missing story fields", () => {
    const spec = { ...VALID_JSON_SPEC, story: { asA: "", iWant: "", soThat: "" } };
    const result = parseJsonSpec(JSON.stringify(spec));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toContain("Missing story.asA");
      expect(result.errors).toContain("Missing story.iWant");
      expect(result.errors).toContain("Missing story.soThat");
    }
  });

  it("returns error for invalid JSON", () => {
    const result = parseJsonSpec("not json {{{");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]).toContain("Invalid JSON");
    }
  });

  it("collects multiple errors at once", () => {
    const spec = { title: "No ID", version: "1.0", parameters: [] };
    const result = parseJsonSpec(JSON.stringify(spec));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(1);
    }
  });
});

// =====================================================
// convertJsonSpecToHybrid
// =====================================================

describe("convertJsonSpecToHybrid", () => {
  it("converts a valid spec to hybrid result", () => {
    const result = convertJsonSpecToHybrid(VALID_JSON_SPEC);

    expect(result.success).toBe(true);
    expect(result.fileType).toBe("HYBRID");
    expect(result.specType).toBeUndefined();
    expect(result.specRole).toBe("MEASURE");
    expect(result.outputType).toBe("MEASURE");
  });

  it("converts story data correctly", () => {
    const result = convertJsonSpecToHybrid(VALID_JSON_SPEC);

    expect(result.storyData).toBeDefined();
    expect(result.storyData!.storyId).toBe("TEST-001");
    expect(result.storyData!.title).toBe("Test Spec");
    expect(result.storyData!.userStory).toEqual({
      asA: "system",
      iWant: "to test",
      soThat: "it works",
    });
  });

  it("converts acceptance criteria", () => {
    const result = convertJsonSpecToHybrid(VALID_JSON_SPEC);

    expect(result.storyData!.acceptanceCriteria).toHaveLength(1);
    expect(result.storyData!.acceptanceCriteria[0].id).toBe("AC-1");
    expect(result.storyData!.acceptanceCriteria[0].title).toBe("Basic Test");
  });

  it("converts constraints (maps info severity to warning)", () => {
    const specWithInfo: JsonFeatureSpec = {
      ...VALID_JSON_SPEC,
      constraints: [{ id: "C-1", description: "Test", severity: "info" }],
    };
    const result = convertJsonSpecToHybrid(specWithInfo);

    expect(result.storyData!.constraints[0].severity).toBe("warning");
  });

  it("converts failure conditions", () => {
    const result = convertJsonSpecToHybrid(VALID_JSON_SPEC);

    expect(result.storyData!.failureConditions).toHaveLength(1);
    expect(result.storyData!.failureConditions[0].trigger).toBe("Timeout");
    expect(result.storyData!.failureConditions[0].threshold).toEqual({ operator: ">", value: 5 });
  });

  it("converts parameter data correctly", () => {
    const result = convertJsonSpecToHybrid(VALID_JSON_SPEC);

    expect(result.parameterData).toBeDefined();
    expect(result.parameterData!.parameters).toHaveLength(1);

    const param = result.parameterData!.parameters[0];
    expect(param.id).toBe("P-001");
    expect(param.name).toBe("test_param");
    expect(param.targetRange).toEqual({ min: 0, max: 1 });
  });

  it("converts subMetrics to submetrics (casing change)", () => {
    const result = convertJsonSpecToHybrid(VALID_JSON_SPEC);
    const param = result.parameterData!.parameters[0];

    expect(param.submetrics).toHaveLength(1);
    expect(param.submetrics[0].id).toBe("SM-1");
    expect(param.submetrics[0].name).toBe("sub1");
    expect(param.submetrics[0].weight).toBe(0.5);
  });

  it("converts promptGuidance object to array", () => {
    const result = convertJsonSpecToHybrid(VALID_JSON_SPEC);
    const param = result.parameterData!.parameters[0];

    expect(param.promptGuidance).toHaveLength(1);
    expect(param.promptGuidance![0].whenHigh).toBe("Do more");
    expect(param.promptGuidance![0].whenLow).toBe("Do less");
    expect(param.promptGuidance![0].parameterId).toBe("P-001");
  });

  it("converts interpretation scale", () => {
    const result = convertJsonSpecToHybrid(VALID_JSON_SPEC);
    const param = result.parameterData!.parameters[0];

    expect(param.interpretationScale).toHaveLength(2);
    expect(param.interpretationScale![0].label).toBe("Low");
  });

  it("converts scoring anchors", () => {
    const result = convertJsonSpecToHybrid(VALID_JSON_SPEC);
    const param = result.parameterData!.parameters[0];

    expect(param.scoringAnchors).toHaveLength(1);
    expect(param.scoringAnchors![0].score).toBe(0.9);
    expect(param.scoringAnchors![0].example).toBe("Excellent example");
  });

  it("sets parameterRefs from parameter IDs", () => {
    const result = convertJsonSpecToHybrid(VALID_JSON_SPEC);
    expect(result.storyData!.parameterRefs).toEqual(["P-001"]);
  });

  it("handles spec with no optional fields", () => {
    const minSpec: JsonFeatureSpec = {
      id: "MIN-001",
      title: "Minimal",
      version: "1.0",
      story: { asA: "a", iWant: "b", soThat: "c" },
      parameters: [{ id: "P-1", name: "p", description: "d" }],
    };

    const result = convertJsonSpecToHybrid(minSpec);
    expect(result.success).toBe(true);
    expect(result.storyData!.acceptanceCriteria).toEqual([]);
    expect(result.storyData!.constraints).toEqual([]);
    expect(result.storyData!.failureConditions).toEqual([]);
    expect(result.parameterData!.parameters[0].submetrics).toEqual([]);
  });

  it("forwards parameters[].isAdjustable from JSON to ParsedParameter (#2271 follow-on)", () => {
    // Regression pin: convertJsonSpecToHybrid used to silently drop
    // `isAdjustable` because the explicit-field return shape did not
    // include it. Result: seed-from-specs.ts:375 read `param.isAdjustable`
    // as undefined → wrote `isAdjustable: false` on every Parameter row
    // regardless of what the spec JSON declared. The IELTS-MEASURE-001
    // gate was the live fingerprint (PR #2273).
    const spec: JsonFeatureSpec = {
      id: "ADJ-FORWARD-001",
      title: "Adjustability forwarding",
      version: "1.0",
      story: { asA: "a", iWant: "b", soThat: "c" },
      parameters: [
        { id: "P-ADJ", name: "p_adj", description: "d", isAdjustable: true },
        { id: "P-NO", name: "p_no", description: "d", isAdjustable: false },
        { id: "P-OMIT", name: "p_omit", description: "d" },
      ],
    };

    const result = convertJsonSpecToHybrid(spec);
    const params = result.parameterData!.parameters;
    expect(params[0].isAdjustable).toBe(true);
    expect(params[1].isAdjustable).toBe(false);
    expect(params[2].isAdjustable).toBeUndefined();
  });
});

// =====================================================
// parseWithAI — mocked AI call
// =====================================================

describe("parseWithAI", () => {
  it("returns parsed parameter data on success", async () => {
    mockAICompletion.mockResolvedValue({
      content: JSON.stringify({
        parameters: [
          { id: "P-1", name: "test", description: "A param", submetrics: [] },
        ],
      }),
      engine: "mock" as const,
      model: "test",
      usage: { inputTokens: 10, outputTokens: 20 },
    });

    const result = await parseWithAI("<parameter>test</parameter>", "PARAMETER");

    expect(result.success).toBe(true);
    expect(result.fileType).toBe("PARAMETER");
    expect(result.data).toBeDefined();
    expect((result.data as any).parameters).toHaveLength(1);
  });

  it("returns parsed story data on success", async () => {
    mockAICompletion.mockResolvedValue({
      content: JSON.stringify({
        storyId: "S-001",
        title: "Test Story",
        userStory: { asA: "user", iWant: "things", soThat: "goals" },
        acceptanceCriteria: [],
        constraints: [],
        failureConditions: [],
        parameterRefs: [],
      }),
      engine: "mock" as const,
      model: "test",
      usage: { inputTokens: 10, outputTokens: 20 },
    });

    const result = await parseWithAI("<bdd_story>test</bdd_story>", "STORY");

    expect(result.success).toBe(true);
    expect(result.fileType).toBe("STORY");
    expect((result.data as any).storyId).toBe("S-001");
  });

  it("strips markdown code blocks from AI response", async () => {
    mockAICompletion.mockResolvedValue({
      content: '```json\n{"parameters": [{"id": "P-1", "name": "test", "description": "d", "submetrics": []}]}\n```',
      engine: "mock" as const,
      model: "test",
      usage: { inputTokens: 10, outputTokens: 20 },
    });

    const result = await parseWithAI("content", "PARAMETER");
    expect(result.success).toBe(true);
  });

  it("returns error when AI returns invalid JSON", async () => {
    mockAICompletion.mockResolvedValue({
      content: "This is not JSON at all",
      engine: "mock" as const,
      model: "test",
      usage: { inputTokens: 10, outputTokens: 20 },
    });

    const result = await parseWithAI("content", "PARAMETER");
    expect(result.success).toBe(false);
    expect(result.errors![0]).toContain("Failed to parse AI response as JSON");
  });

  it("returns error when parameter response missing parameters array", async () => {
    mockAICompletion.mockResolvedValue({
      content: JSON.stringify({ data: "wrong structure" }),
      engine: "mock" as const,
      model: "test",
      usage: { inputTokens: 10, outputTokens: 20 },
    });

    const result = await parseWithAI("content", "PARAMETER");
    expect(result.success).toBe(false);
    expect(result.errors![0]).toContain("missing 'parameters' array");
  });

  it("returns error when story response missing storyId", async () => {
    mockAICompletion.mockResolvedValue({
      content: JSON.stringify({ title: "No storyId" }),
      engine: "mock" as const,
      model: "test",
      usage: { inputTokens: 10, outputTokens: 20 },
    });

    const result = await parseWithAI("content", "STORY");
    expect(result.success).toBe(false);
    expect(result.errors![0]).toContain("missing 'storyId'");
  });

  it("returns warning when parameters array is empty", async () => {
    mockAICompletion.mockResolvedValue({
      content: JSON.stringify({ parameters: [] }),
      engine: "mock" as const,
      model: "test",
      usage: { inputTokens: 10, outputTokens: 20 },
    });

    const result = await parseWithAI("content", "PARAMETER");
    expect(result.success).toBe(true);
    expect(result.warnings).toContain("No parameters found in content");
  });

  it("handles AI call failure gracefully", async () => {
    mockAICompletion.mockRejectedValue(new Error("API rate limit exceeded"));

    const result = await parseWithAI("content", "PARAMETER");
    expect(result.success).toBe(false);
    expect(result.errors![0]).toContain("AI parsing failed: API rate limit exceeded");
  });
});

// =====================================================
// parseHybridWithAI — mocked AI call
// =====================================================

describe("parseHybridWithAI", () => {
  it("returns both parameter and story data on success", async () => {
    mockAICompletion.mockResolvedValue({
      content: JSON.stringify({
        parameters: [{ id: "P-1", name: "test", description: "d", submetrics: [] }],
        story: {
          storyId: "S-1",
          title: "Story",
          userStory: { asA: "a", iWant: "b", soThat: "c" },
          acceptanceCriteria: [],
          constraints: [],
          failureConditions: [],
          parameterRefs: ["P-1"],
        },
      }),
      engine: "mock" as const,
      model: "test",
      usage: { inputTokens: 10, outputTokens: 20 },
    });

    const result = await parseHybridWithAI("hybrid content");

    expect(result.success).toBe(true);
    expect(result.fileType).toBe("HYBRID");
    expect(result.parameterData).toBeDefined();
    expect(result.storyData).toBeDefined();
    expect(result.parameterData!.parameters).toHaveLength(1);
    expect(result.storyData!.storyId).toBe("S-1");
  });

  it("warns when no parameters found", async () => {
    mockAICompletion.mockResolvedValue({
      content: JSON.stringify({
        parameters: [],
        story: {
          storyId: "S-1",
          title: "Story",
          userStory: { asA: "a", iWant: "b", soThat: "c" },
          acceptanceCriteria: [],
          constraints: [],
          failureConditions: [],
          parameterRefs: [],
        },
      }),
      engine: "mock" as const,
      model: "test",
      usage: { inputTokens: 10, outputTokens: 20 },
    });

    const result = await parseHybridWithAI("content");
    expect(result.success).toBe(true);
    expect(result.parameterData).toBeNull();
    expect(result.warnings).toContain("No parameters found in hybrid file");
  });

  it("warns when no story data found", async () => {
    mockAICompletion.mockResolvedValue({
      content: JSON.stringify({
        parameters: [{ id: "P-1", name: "t", description: "d", submetrics: [] }],
        story: {},
      }),
      engine: "mock" as const,
      model: "test",
      usage: { inputTokens: 10, outputTokens: 20 },
    });

    const result = await parseHybridWithAI("content");
    expect(result.success).toBe(true);
    expect(result.storyData).toBeNull();
    expect(result.warnings).toContain("No story data found in hybrid file");
  });

  it("returns error when neither data is found", async () => {
    mockAICompletion.mockResolvedValue({
      content: JSON.stringify({ parameters: [], story: {} }),
      engine: "mock" as const,
      model: "test",
      usage: { inputTokens: 10, outputTokens: 20 },
    });

    const result = await parseHybridWithAI("content");
    expect(result.success).toBe(false);
    expect(result.errors![0]).toContain("Failed to extract either parameter or story data");
  });

  it("handles AI call failure gracefully", async () => {
    mockAICompletion.mockRejectedValue(new Error("Network error"));

    const result = await parseHybridWithAI("content");
    expect(result.success).toBe(false);
    expect(result.errors![0]).toContain("AI parsing failed: Network error");
  });

  it("handles invalid JSON from AI", async () => {
    mockAICompletion.mockResolvedValue({
      content: "not valid json",
      engine: "mock" as const,
      model: "test",
      usage: { inputTokens: 10, outputTokens: 20 },
    });

    const result = await parseHybridWithAI("content");
    expect(result.success).toBe(false);
    expect(result.errors![0]).toContain("Failed to parse AI response as JSON");
  });
});

// =====================================================
// parseBDDSpec — unified entry point
// =====================================================

describe("parseBDDSpec", () => {
  it("uses JSON parsing for .spec.json files", async () => {
    const content = JSON.stringify(VALID_JSON_SPEC);
    const result = await parseBDDSpec(content, "test.spec.json");

    expect(result.success).toBe(true);
    expect(result.fileType).toBe("HYBRID");
    // Should NOT have called AI
    expect(mockAICompletion).not.toHaveBeenCalled();
  });

  it("uses JSON parsing for .json files with spec structure", async () => {
    const content = JSON.stringify(VALID_JSON_SPEC);
    const result = await parseBDDSpec(content, "test.json");

    expect(result.success).toBe(true);
    expect(mockAICompletion).not.toHaveBeenCalled();
  });

  it("returns errors for invalid JSON spec files", async () => {
    // Must pass isJsonSpec (has id, title, story, parameters) but fail parseJsonSpec validation
    const invalidSpec = {
      id: "X",
      title: "Invalid",
      story: { asA: "", iWant: "", soThat: "" },
      parameters: [],
    };
    const result = await parseBDDSpec(JSON.stringify(invalidSpec), "test.spec.json");

    expect(result.success).toBe(false);
    expect(mockAICompletion).not.toHaveBeenCalled();
  });

  it("falls back to AI parsing for XML files", async () => {
    mockAICompletion.mockResolvedValue({
      content: JSON.stringify({
        storyId: "S-1",
        title: "Story",
        userStory: { asA: "a", iWant: "b", soThat: "c" },
        acceptanceCriteria: [],
        constraints: [],
        failureConditions: [],
        parameterRefs: [],
      }),
      engine: "mock" as const,
      model: "test",
      usage: { inputTokens: 10, outputTokens: 20 },
    });

    const result = await parseBDDSpec(
      '<bdd_story id="S-1"><user_story>...</user_story></bdd_story>',
      "test.bdd.xml"
    );

    expect(result.success).toBe(true);
    expect(mockAICompletion).toHaveBeenCalled();
  });

  it("uses hybrid AI parsing for hybrid content", async () => {
    mockAICompletion.mockResolvedValue({
      content: JSON.stringify({
        parameters: [{ id: "P-1", name: "t", description: "d", submetrics: [] }],
        story: {
          storyId: "S-1",
          title: "T",
          userStory: { asA: "a", iWant: "b", soThat: "c" },
          acceptanceCriteria: [],
          constraints: [],
          failureConditions: [],
          parameterRefs: [],
        },
      }),
      engine: "mock" as const,
      model: "test",
      usage: { inputTokens: 10, outputTokens: 20 },
    });

    const content = '<bdd_story id="S-1"><parameter id="P-1"><formula>x</formula></parameter></bdd_story>';
    const result = await parseBDDSpec(content, "hybrid.xml");

    expect(result.fileType).toBe("HYBRID");
    expect(mockAICompletion).toHaveBeenCalled();
  });
});
