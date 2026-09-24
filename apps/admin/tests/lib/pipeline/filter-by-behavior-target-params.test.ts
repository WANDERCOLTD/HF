/**
 * #2137 (epic #2135 S2) — `filterByBehaviorTargetParams` gating tests.
 *
 * Pins the generic gate that lets a MEASURE spec opt in to running ONLY
 * when the playbook has at least one of the spec's declared parameters
 * on its `BehaviorTarget` rows (scope=PLAYBOOK). Used to gate
 * `IELTS-MEASURE-001` to IELTS-configured playbooks without depending
 * on `Subject.teachingProfile` (which is null on every PUBLISHED
 * playbook per the live-state correction on issue #2137).
 *
 * The gate is generic: future course-specific scoring specs (CEFR /
 * TOEFL / Spanish DELE) follow the same opt-in shape.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PipelineLogger } from "@/lib/pipeline/logger";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    analysisSpec: { findMany: vi.fn() },
    behaviorTarget: { findMany: vi.fn() },
    // Story #2158 — per-Playbook override read for the IELTS LLM
    // scoring kill-switch. Default mock returns no aiMeasurement so
    // existing tests preserve their semantics.
    playbook: { findUnique: vi.fn().mockResolvedValue({ config: {} }) },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

const noopLogger: PipelineLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as unknown as PipelineLogger;

describe("filterByBehaviorTargetParams", () => {
  let filterByBehaviorTargetParams: typeof import("@/lib/pipeline/specs-loader").filterByBehaviorTargetParams;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Default: no per-Playbook override — passes through unaffected.
    mockPrisma.playbook.findUnique.mockResolvedValue({ config: {} });
    const mod = await import("@/lib/pipeline/specs-loader");
    filterByBehaviorTargetParams = mod.filterByBehaviorTargetParams;
  });

  it("returns empty input unchanged", async () => {
    const result = await filterByBehaviorTargetParams([], "pb-1", noopLogger);
    expect(result).toEqual([]);
    expect(mockPrisma.analysisSpec.findMany).not.toHaveBeenCalled();
  });

  it("passes through specs with no opt-in flag (no DB hit for BehaviorTargets)", async () => {
    mockPrisma.analysisSpec.findMany.mockResolvedValue([
      {
        id: "spec-1",
        slug: "PERS-001",
        config: { profileCondition: ["any"] }, // no requiresBehaviorTargetParams
        triggers: [],
      },
      {
        id: "spec-2",
        slug: "VARK-001",
        config: null,
        triggers: [],
      },
    ]);

    const result = await filterByBehaviorTargetParams(
      ["spec-1", "spec-2"],
      "pb-1",
      noopLogger,
    );

    expect(result.sort()).toEqual(["spec-1", "spec-2"]);
    expect(mockPrisma.behaviorTarget.findMany).not.toHaveBeenCalled();
  });

  it("when opted in AND playbook has a matching BehaviorTarget → spec runs", async () => {
    mockPrisma.analysisSpec.findMany.mockResolvedValue([
      {
        id: "ielts-spec",
        slug: "IELTS-MEASURE-001",
        config: { requiresBehaviorTargetParams: true },
        triggers: [
          {
            actions: [
              { parameterId: "skill_fluency_and_coherence_fc" },
              { parameterId: "skill_lexical_resource_lr" },
              { parameterId: "skill_grammatical_range_and_accuracy_gra" },
              { parameterId: "skill_pronunciation_p" },
            ],
          },
        ],
      },
    ]);
    mockPrisma.behaviorTarget.findMany.mockResolvedValue([
      { parameterId: "skill_fluency_and_coherence_fc" },
      { parameterId: "skill_pronunciation_p" },
    ]);

    const result = await filterByBehaviorTargetParams(
      ["ielts-spec"],
      "pb-1",
      noopLogger,
    );

    expect(result).toEqual(["ielts-spec"]);
    expect(mockPrisma.behaviorTarget.findMany).toHaveBeenCalledWith({
      where: { scope: "PLAYBOOK", playbookId: "pb-1" },
      select: { parameterId: true },
    });
  });

  it("when opted in AND playbook has ZERO matching BehaviorTargets → spec is dropped", async () => {
    mockPrisma.analysisSpec.findMany.mockResolvedValue([
      {
        id: "ielts-spec",
        slug: "IELTS-MEASURE-001",
        config: { requiresBehaviorTargetParams: true },
        triggers: [
          {
            actions: [
              { parameterId: "skill_fluency_and_coherence_fc" },
              { parameterId: "skill_lexical_resource_lr" },
            ],
          },
        ],
      },
    ]);
    mockPrisma.behaviorTarget.findMany.mockResolvedValue([
      { parameterId: "BEH-WARMTH" }, // non-IELTS playbook params
      { parameterId: "BEH-RESPONSE-LEN" },
    ]);

    const result = await filterByBehaviorTargetParams(
      ["ielts-spec"],
      "pb-cio-cto",
      noopLogger,
    );

    expect(result).toEqual([]);
  });

  it("when opted in but playbookId is null → spec is dropped", async () => {
    mockPrisma.analysisSpec.findMany.mockResolvedValue([
      {
        id: "ielts-spec",
        slug: "IELTS-MEASURE-001",
        config: { requiresBehaviorTargetParams: true },
        triggers: [{ actions: [{ parameterId: "skill_fluency_and_coherence_fc" }] }],
      },
    ]);

    const result = await filterByBehaviorTargetParams(
      ["ielts-spec"],
      null,
      noopLogger,
    );

    expect(result).toEqual([]);
    // No BehaviorTarget query when playbookId is null.
    expect(mockPrisma.behaviorTarget.findMany).not.toHaveBeenCalled();
  });

  it("mixes opt-in (matched) + opt-in (dropped) + pass-through specs correctly", async () => {
    mockPrisma.analysisSpec.findMany.mockResolvedValue([
      {
        id: "ielts-spec",
        slug: "IELTS-MEASURE-001",
        config: { requiresBehaviorTargetParams: true },
        triggers: [{ actions: [{ parameterId: "skill_fluency_and_coherence_fc" }] }],
      },
      {
        id: "cefr-spec",
        slug: "CEFR-MEASURE-001",
        config: { requiresBehaviorTargetParams: true },
        triggers: [{ actions: [{ parameterId: "cefr_speaking_b2" }] }],
      },
      {
        id: "pers-spec",
        slug: "PERS-001",
        config: null,
        triggers: [],
      },
    ]);
    mockPrisma.behaviorTarget.findMany.mockResolvedValue([
      { parameterId: "skill_fluency_and_coherence_fc" }, // only matches IELTS
    ]);

    const result = await filterByBehaviorTargetParams(
      ["ielts-spec", "cefr-spec", "pers-spec"],
      "pb-ielts",
      noopLogger,
    );

    // IELTS matched → runs. CEFR opted-in but no match → dropped. PERS pass-through.
    expect(result.sort()).toEqual(["ielts-spec", "pers-spec"]);
  });

  // ────────────────────────────────────────────────────────────
  // Story #2158 — per-course IELTS LLM scoring kill-switch override.
  // The flag retirement story; replaces `HF_IELTS_LLM_MEASURE_V1`.
  // ────────────────────────────────────────────────────────────

  describe("#2158 — per-course aiMeasurement.disableLlmIeltsScoring override", () => {
    it("IELTS-shaped course + override unset → IELTS-MEASURE-001 selected", async () => {
      mockPrisma.analysisSpec.findMany.mockResolvedValue([
        {
          id: "ielts-spec",
          slug: "IELTS-MEASURE-001",
          config: { requiresBehaviorTargetParams: true },
          triggers: [{ actions: [{ parameterId: "skill_fluency_and_coherence_fc" }] }],
        },
      ]);
      mockPrisma.behaviorTarget.findMany.mockResolvedValue([
        { parameterId: "skill_fluency_and_coherence_fc" },
      ]);
      // Default playbook mock: no aiMeasurement key → override not set.

      const result = await filterByBehaviorTargetParams(
        ["ielts-spec"],
        "pb-ielts",
        noopLogger,
      );

      expect(result).toEqual(["ielts-spec"]);
    });

    it("IELTS-shaped course + disableLlmIeltsScoring=true → IELTS-MEASURE-001 filtered OUT", async () => {
      mockPrisma.analysisSpec.findMany.mockResolvedValue([
        {
          id: "ielts-spec",
          slug: "IELTS-MEASURE-001",
          config: { requiresBehaviorTargetParams: true },
          triggers: [{ actions: [{ parameterId: "skill_fluency_and_coherence_fc" }] }],
        },
      ]);
      mockPrisma.behaviorTarget.findMany.mockResolvedValue([
        { parameterId: "skill_fluency_and_coherence_fc" },
      ]);
      mockPrisma.playbook.findUnique.mockResolvedValue({
        config: { aiMeasurement: { disableLlmIeltsScoring: true } },
      });

      const result = await filterByBehaviorTargetParams(
        ["ielts-spec"],
        "pb-ielts",
        noopLogger,
      );

      expect(result).toEqual([]);
    });

    it("kill-switch is narrow to IELTS-MEASURE-* — sibling course-specific specs unaffected", async () => {
      // Future CEFR/TOEFL/etc. course-specific specs should NOT be
      // dropped by this kill-switch even when the operator sets it.
      // The override is intentionally narrow.
      mockPrisma.analysisSpec.findMany.mockResolvedValue([
        {
          id: "ielts-spec",
          slug: "IELTS-MEASURE-001",
          config: { requiresBehaviorTargetParams: true },
          triggers: [{ actions: [{ parameterId: "skill_fluency_and_coherence_fc" }] }],
        },
        {
          id: "cefr-spec",
          slug: "CEFR-MEASURE-001",
          config: { requiresBehaviorTargetParams: true },
          triggers: [{ actions: [{ parameterId: "cefr_speaking_b2" }] }],
        },
      ]);
      mockPrisma.behaviorTarget.findMany.mockResolvedValue([
        { parameterId: "skill_fluency_and_coherence_fc" },
        { parameterId: "cefr_speaking_b2" },
      ]);
      mockPrisma.playbook.findUnique.mockResolvedValue({
        config: { aiMeasurement: { disableLlmIeltsScoring: true } },
      });

      const result = await filterByBehaviorTargetParams(
        ["ielts-spec", "cefr-spec"],
        "pb-multi",
        noopLogger,
      );

      // CEFR survives; only IELTS-MEASURE-* is dropped.
      expect(result).toEqual(["cefr-spec"]);
    });

    it("Non-IELTS course (no IELTS skill params on BehaviorTargets) → never selected regardless of override state", async () => {
      mockPrisma.analysisSpec.findMany.mockResolvedValue([
        {
          id: "ielts-spec",
          slug: "IELTS-MEASURE-001",
          config: { requiresBehaviorTargetParams: true },
          triggers: [{ actions: [{ parameterId: "skill_fluency_and_coherence_fc" }] }],
        },
      ]);
      mockPrisma.behaviorTarget.findMany.mockResolvedValue([
        { parameterId: "BEH-WARMTH" },
      ]);
      // Override IS set, but BehaviorTarget gate already drops the spec
      // before the kill-switch is reached. Belt-and-braces — confirms
      // the override is additive, not subtractive.
      mockPrisma.playbook.findUnique.mockResolvedValue({
        config: { aiMeasurement: { disableLlmIeltsScoring: true } },
      });

      const result = await filterByBehaviorTargetParams(
        ["ielts-spec"],
        "pb-cio-cto",
        noopLogger,
      );

      expect(result).toEqual([]);
    });

    it("Legacy HF_IELTS_LLM_MEASURE_V1 env var is ignored (story #2158 retirement)", async () => {
      // The env flag is structurally removed from the call path; setting
      // it has no effect. This test pins the retirement — the cascade
      // (config.aiMeasurement) is the sole source of truth.
      const originalEnv = process.env.HF_IELTS_LLM_MEASURE_V1;
      process.env.HF_IELTS_LLM_MEASURE_V1 = "false"; // would have dropped IELTS spec pre-#2158
      try {
        mockPrisma.analysisSpec.findMany.mockResolvedValue([
          {
            id: "ielts-spec",
            slug: "IELTS-MEASURE-001",
            config: { requiresBehaviorTargetParams: true },
            triggers: [{ actions: [{ parameterId: "skill_fluency_and_coherence_fc" }] }],
          },
        ]);
        mockPrisma.behaviorTarget.findMany.mockResolvedValue([
          { parameterId: "skill_fluency_and_coherence_fc" },
        ]);
        // No override set; cascade source of truth = run the spec.

        const result = await filterByBehaviorTargetParams(
          ["ielts-spec"],
          "pb-ielts",
          noopLogger,
        );

        expect(result).toEqual(["ielts-spec"]);
      } finally {
        if (originalEnv === undefined) {
          delete process.env.HF_IELTS_LLM_MEASURE_V1;
        } else {
          process.env.HF_IELTS_LLM_MEASURE_V1 = originalEnv;
        }
      }
    });
  });
});
