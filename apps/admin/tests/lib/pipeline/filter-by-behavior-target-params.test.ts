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
});
