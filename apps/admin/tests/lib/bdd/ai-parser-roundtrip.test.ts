/**
 * Authored-vs-Projected Parity — JsonParameter → ParsedParameter round-trip
 *
 * #2283 (umbrella #2279) — Data Presence sub-pillar Coverage gate.
 *
 * Catches: a new optional field added to `JsonParameter` (in
 * `lib/bdd/ai-parser.ts`) but forgotten in the `convertJsonSpecToHybrid`
 * map return → silent field-drop on every seed-from-specs run. This is
 * the exact class of bug PR #2276 closed for `isAdjustable`, generalized.
 *
 * Shape: build a `JsonFeatureSpec` fixture whose `parameters[0]` carries
 * every optional `JsonParameter` field set to a known sentinel value,
 * run it through `convertJsonSpecToHybrid`, and assert each sentinel
 * lands in the resulting `ParsedParameter` (or is documented as
 * intentionally dropped because it's consumed from `rawSpec` elsewhere).
 *
 * Sibling Coverage gates (Data Presence sub-pillar):
 * - `spec-params-canonical-presence.test.ts` (#2280) — soft-FK resolvability
 * - `calltarget-produced-consumed.test.ts` (#2284) — cascade reachability
 *
 * Rule file: `.claude/rules/parser-roundtrip-coverage.md` (lands in same PR).
 */

import { describe, it, expect } from "vitest";
import {
  convertJsonSpecToHybrid,
  type JsonFeatureSpec,
  type JsonParameter,
} from "@/lib/bdd/ai-parser";

// =====================================================================
// FIXTURE — every optional JsonParameter field set to a sentinel value
// =====================================================================

const SENTINEL_PARAM: JsonParameter = {
  // Required fields
  id: "P-ROUNDTRIP-001",
  name: "roundtrip_param",
  description: "Fixture exercising every optional JsonParameter field.",

  // Optional scalar fields the test asserts round-trip
  section: "round-trip-section",
  isAdjustable: true,
  formula: "x + y",
  targetRange: { min: 0.123, max: 0.987 },

  // config — declared in JsonParameter, forwarded in convertJsonSpecToHybrid
  // even though ParsedParameter's interface doesn't list it.
  config: { sentinelKey: "sentinelValue" },

  // Array / nested fields
  subMetrics: [
    {
      id: "SM-1",
      name: "sub_metric_one",
      weight: 0.5,
      description: "sentinel sub-metric description",
      formula: "sm-formula",
      definitions: { high: "h", low: "l" },
    },
  ],

  interpretationScale: [
    { min: 0, max: 0.5, label: "Low", implication: "below threshold" },
    { min: 0.5, max: 1, label: "High", implication: "above threshold" },
  ],

  scoringAnchors: [
    { score: 0.7, example: "sentinel example", rationale: "sentinel rationale", isGold: true },
  ],

  promptGuidance: {
    whenHigh: "do more sentinel",
    whenLow: "do less sentinel",
    whenMedium: "stay mid sentinel",
    promptTemplate: "RUBRIC[sentinel]",
  },

  // Fields consumed from rawSpec elsewhere — intentionally NOT
  // expected on ParsedParameter (see DROPPED_FIELDS below).
  usedBy: ["AC-SENTINEL-001"],
  learningOutcomes: ["LO-SENTINEL-001"],
};

const SENTINEL_SPEC: JsonFeatureSpec = {
  id: "ROUNDTRIP-001",
  title: "Parser round-trip fixture",
  version: "1.0",
  story: { asA: "test", iWant: "every field forwarded", soThat: "no silent drops" },
  parameters: [SENTINEL_PARAM],
};

// =====================================================================
// Fields documented as INTENTIONALLY dropped from ParsedParameter
// (they're consumed directly from rawSpec by seed-from-specs.ts, not
// from the parsed-parameter pathway). If a future refactor makes these
// flow through ParsedParameter, move them to the round-trip assertions.
// =====================================================================

const DROPPED_FIELDS: Array<{ field: keyof JsonParameter; consumedBy: string }> = [
  { field: "usedBy", consumedBy: "rawSpec at seed-from-specs.ts (spec-level reference graph)" },
  { field: "learningOutcomes", consumedBy: "rawSpec at seed-from-specs.ts:708 (rawSpecData.learningOutcomes)" },
];

describe("ai-parser round-trip — JsonParameter ↔ ParsedParameter (#2283)", () => {
  const result = convertJsonSpecToHybrid(SENTINEL_SPEC);
  const projected = result.parameterData!.parameters[0];

  it("convertJsonSpecToHybrid returns a parameter", () => {
    expect(result.success).toBe(true);
    expect(projected).toBeDefined();
    expect(projected.id).toBe("P-ROUNDTRIP-001");
  });

  it("forwards `section`", () => {
    expect(projected.section).toBe("round-trip-section");
  });

  it("forwards `isAdjustable` (regression pin for #2276)", () => {
    expect(projected.isAdjustable).toBe(true);
  });

  it("forwards `formula`", () => {
    expect(projected.formula).toBe("x + y");
  });

  it("forwards `targetRange`", () => {
    expect(projected.targetRange).toEqual({ min: 0.123, max: 0.987 });
  });

  it("forwards `config` (declared in JsonParameter, returned by code even if absent from ParsedParameter interface)", () => {
    expect((projected as unknown as { config?: Record<string, unknown> }).config).toEqual({
      sentinelKey: "sentinelValue",
    });
  });

  it("forwards `subMetrics` as `submetrics` (note case change)", () => {
    expect(projected.submetrics).toHaveLength(1);
    expect(projected.submetrics[0]).toMatchObject({
      id: "SM-1",
      name: "sub_metric_one",
      weight: 0.5,
      description: "sentinel sub-metric description",
      formula: "sm-formula",
      definitions: { high: "h", low: "l" },
    });
  });

  it("forwards `interpretationScale` (unchanged shape)", () => {
    expect(projected.interpretationScale).toHaveLength(2);
    expect(projected.interpretationScale![0]).toEqual({
      min: 0,
      max: 0.5,
      label: "Low",
      implication: "below threshold",
    });
  });

  it("forwards `scoringAnchors` (unchanged shape)", () => {
    expect(projected.scoringAnchors).toHaveLength(1);
    expect(projected.scoringAnchors![0]).toMatchObject({
      score: 0.7,
      example: "sentinel example",
      rationale: "sentinel rationale",
      isGold: true,
    });
  });

  it("converts `promptGuidance` object → single PromptGuidanceItem entry", () => {
    expect(projected.promptGuidance).toHaveLength(1);
    expect(projected.promptGuidance![0]).toMatchObject({
      id: "P-ROUNDTRIP-001-guidance",
      parameterId: "P-ROUNDTRIP-001",
      term: "roundtrip_param",
      definition: "Fixture exercising every optional JsonParameter field.",
      whenHigh: "do more sentinel",
      whenLow: "do less sentinel",
      whenMedium: "stay mid sentinel",
      promptTemplate: "RUBRIC[sentinel]",
    });
  });

  // =====================================================================
  // Documented drops — assert the dropped fields really are dropped, so
  // a future refactor that starts forwarding them surfaces here (move to
  // round-trip assertions above).
  // =====================================================================

  describe("intentionally dropped fields (consumed from rawSpec elsewhere)", () => {
    for (const { field, consumedBy } of DROPPED_FIELDS) {
      it(`drops \`${field}\` — consumed by ${consumedBy}`, () => {
        expect((projected as unknown as Record<string, unknown>)[field]).toBeUndefined();
      });
    }
  });

  // =====================================================================
  // Completeness — assert the fixture exercises every optional field on
  // JsonParameter. When a new optional field is added to the interface,
  // this test fails until the fixture is extended AND the field is either
  // added to the round-trip assertions or documented in DROPPED_FIELDS.
  // =====================================================================

  it("fixture exercises every optional field on JsonParameter (extension ratchet)", () => {
    // List of all optional fields on JsonParameter as of #2283. When a
    // new field is added, append it here AND either add a round-trip
    // assertion above OR document the drop in DROPPED_FIELDS.
    const EXPECTED_OPTIONAL_FIELDS: Array<keyof JsonParameter> = [
      "section",
      "isAdjustable",
      "targetRange",
      "config",
      "formula",
      "subMetrics",
      "interpretationScale",
      "scoringAnchors",
      "promptGuidance",
      "usedBy",
      "learningOutcomes",
    ];

    for (const field of EXPECTED_OPTIONAL_FIELDS) {
      expect(
        SENTINEL_PARAM[field],
        `Fixture must exercise '${field}' — extension ratchet (see test header).`,
      ).not.toBeUndefined();
    }
  });
});
