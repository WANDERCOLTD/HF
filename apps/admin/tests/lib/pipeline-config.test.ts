/**
 * Tests for lib/pipeline/config.ts — Pipeline Stage Configuration
 *
 * Covers:
 * - loadPipelineStages loads stages from spec database
 * - extractStagesFromConfig parses and sorts stages correctly
 * - getStageByName finds stages by name
 * - getStagesForOutputType filters stages by output type
 * - Error when spec not found in database
 * - Error when spec has no stages
 * - Stage ordering is preserved
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  analysisSpec: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("@/lib/config", () => ({
  config: {
    specs: {
      pipeline: "PIPELINE-001",
    },
  },
}));

// =====================================================
// FIXTURES
// =====================================================

/** A realistic pipeline spec config matching PIPELINE-001 structure */
function makePipelineSpecConfig(
  stages: Array<{
    name: string;
    order: number;
    outputTypes: string[];
    description?: string;
    batched?: boolean;
    requiresMode?: "prep" | "prompt";
  }>
) {
  return {
    parameters: [
      {
        id: "pipeline_stages",
        config: {
          stages,
        },
      },
    ],
  };
}

const FULL_STAGES = [
  {
    name: "EXTRACT",
    order: 1,
    outputTypes: ["MEASURE", "LEARN", "CLASSIFY"],
    description: "Extract measurements from transcript",
  },
  {
    name: "AGGREGATE",
    order: 2,
    outputTypes: ["AGGREGATE"],
    description: "Aggregate measurements into profile",
    batched: true,
  },
  {
    name: "REWARD",
    order: 3,
    outputTypes: ["REWARD"],
    description: "Compute reward signal",
  },
  {
    name: "ADAPT",
    order: 4,
    outputTypes: ["ADAPT"],
    description: "Adapt targets based on profile",
  },
  {
    name: "SUPERVISE",
    order: 5,
    outputTypes: ["SUPERVISE"],
    description: "Supervisor review of adaptations",
    requiresMode: "prep" as const,
  },
  {
    name: "COMPOSE",
    order: 6,
    outputTypes: ["COMPOSE"],
    description: "Compose next prompt",
    requiresMode: "prompt" as const,
  },
];

// =====================================================
// TESTS
// =====================================================

describe("lib/pipeline/config.ts", () => {
  let loadPipelineStages: typeof import("@/lib/pipeline/config").loadPipelineStages;
  let getStageByName: typeof import("@/lib/pipeline/config").getStageByName;
  let getStagesForOutputType: typeof import("@/lib/pipeline/config").getStagesForOutputType;

  beforeEach(async () => {
    vi.clearAllMocks();

    const mod = await import("@/lib/pipeline/config");
    loadPipelineStages = mod.loadPipelineStages;
    getStageByName = mod.getStageByName;
    getStagesForOutputType = mod.getStagesForOutputType;
  });

  // -------------------------------------------------
  // loadPipelineStages — success path
  // -------------------------------------------------

  describe("loadPipelineStages — success", () => {
    it("loads all 6 pipeline stages from spec", async () => {
      mockPrisma.analysisSpec.findFirst.mockResolvedValue({
        slug: "spec-pipeline-001",
        config: makePipelineSpecConfig(FULL_STAGES),
      });

      const stages = await loadPipelineStages();

      expect(stages).toHaveLength(6);
      expect(stages[0].name).toBe("EXTRACT");
      expect(stages[5].name).toBe("COMPOSE");
    });

    it("stages are sorted by order", async () => {
      // Provide stages in reverse order to verify sorting
      const shuffled = [...FULL_STAGES].reverse();
      mockPrisma.analysisSpec.findFirst.mockResolvedValue({
        slug: "spec-pipeline-001",
        config: makePipelineSpecConfig(shuffled),
      });

      const stages = await loadPipelineStages();

      for (let i = 1; i < stages.length; i++) {
        expect(stages[i].order).toBeGreaterThan(stages[i - 1].order);
      }
    });

    it("preserves outputTypes for each stage", async () => {
      mockPrisma.analysisSpec.findFirst.mockResolvedValue({
        slug: "spec-pipeline-001",
        config: makePipelineSpecConfig(FULL_STAGES),
      });

      const stages = await loadPipelineStages();

      const extract = stages.find((s) => s.name === "EXTRACT");
      expect(extract?.outputTypes).toEqual(["MEASURE", "LEARN", "CLASSIFY"]);
    });

    it("preserves batched flag", async () => {
      mockPrisma.analysisSpec.findFirst.mockResolvedValue({
        slug: "spec-pipeline-001",
        config: makePipelineSpecConfig(FULL_STAGES),
      });

      const stages = await loadPipelineStages();

      const aggregate = stages.find((s) => s.name === "AGGREGATE");
      expect(aggregate?.batched).toBe(true);
    });

    it("preserves requiresMode", async () => {
      mockPrisma.analysisSpec.findFirst.mockResolvedValue({
        slug: "spec-pipeline-001",
        config: makePipelineSpecConfig(FULL_STAGES),
      });

      const stages = await loadPipelineStages();

      const compose = stages.find((s) => s.name === "COMPOSE");
      expect(compose?.requiresMode).toBe("prompt");

      const supervise = stages.find((s) => s.name === "SUPERVISE");
      expect(supervise?.requiresMode).toBe("prep");
    });

    it("defaults outputTypes to empty array when not provided", async () => {
      mockPrisma.analysisSpec.findFirst.mockResolvedValue({
        slug: "spec-pipeline-001",
        config: makePipelineSpecConfig([
          { name: "TEST", order: 1, outputTypes: undefined as any },
        ]),
      });

      const stages = await loadPipelineStages();

      expect(stages[0].outputTypes).toEqual([]);
    });

    it("accepts a custom logger", async () => {
      mockPrisma.analysisSpec.findFirst.mockResolvedValue({
        slug: "spec-pipeline-001",
        config: makePipelineSpecConfig(FULL_STAGES),
      });

      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      };

      const stages = await loadPipelineStages(logger);

      expect(stages).toHaveLength(6);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Pipeline stages loaded"),
        expect.objectContaining({ stageCount: 6 })
      );
    });
  });

  // -------------------------------------------------
  // loadPipelineStages — error paths
  // -------------------------------------------------

  describe("loadPipelineStages — errors", () => {
    it("throws when pipeline spec is not found in database", async () => {
      mockPrisma.analysisSpec.findFirst.mockResolvedValue(null);

      await expect(loadPipelineStages()).rejects.toThrow(
        /Pipeline spec not found.*PIPELINE-001/
      );
    });

    it("throws when spec config has no stages array", async () => {
      mockPrisma.analysisSpec.findFirst.mockResolvedValue({
        slug: "spec-pipeline-001",
        config: { parameters: [] },
      });

      await expect(loadPipelineStages()).rejects.toThrow(
        /has no valid stage configuration/
      );
    });

    it("throws when spec config is null", async () => {
      mockPrisma.analysisSpec.findFirst.mockResolvedValue({
        slug: "spec-pipeline-001",
        config: null,
      });

      await expect(loadPipelineStages()).rejects.toThrow(
        /has no valid stage configuration/
      );
    });

    it("throws when stages array is empty", async () => {
      mockPrisma.analysisSpec.findFirst.mockResolvedValue({
        slug: "spec-pipeline-001",
        config: makePipelineSpecConfig([]),
      });

      await expect(loadPipelineStages()).rejects.toThrow(
        /has no valid stage configuration/
      );
    });

    it("throws when pipeline_stages parameter has no config", async () => {
      mockPrisma.analysisSpec.findFirst.mockResolvedValue({
        slug: "spec-pipeline-001",
        config: {
          parameters: [{ id: "pipeline_stages" }],
        },
      });

      await expect(loadPipelineStages()).rejects.toThrow(
        /has no valid stage configuration/
      );
    });
  });

  // -------------------------------------------------
  // getStageByName
  // -------------------------------------------------

  describe("getStageByName", () => {
    it("finds a stage by name", () => {
      const stages = FULL_STAGES.map((s) => ({
        ...s,
        outputTypes: s.outputTypes || [],
      }));

      const result = getStageByName(stages, "EXTRACT");

      expect(result).toBeDefined();
      expect(result?.name).toBe("EXTRACT");
      expect(result?.order).toBe(1);
    });

    it("returns undefined for non-existent stage", () => {
      const stages = FULL_STAGES.map((s) => ({
        ...s,
        outputTypes: s.outputTypes || [],
      }));

      const result = getStageByName(stages, "NONEXISTENT");

      expect(result).toBeUndefined();
    });

    it("is case-sensitive", () => {
      const stages = FULL_STAGES.map((s) => ({
        ...s,
        outputTypes: s.outputTypes || [],
      }));

      const result = getStageByName(stages, "extract");

      expect(result).toBeUndefined();
    });

    it("returns the correct stage when multiple stages exist", () => {
      const stages = FULL_STAGES.map((s) => ({
        ...s,
        outputTypes: s.outputTypes || [],
      }));

      const result = getStageByName(stages, "ADAPT");

      expect(result?.order).toBe(4);
      expect(result?.outputTypes).toEqual(["ADAPT"]);
    });
  });

  // -------------------------------------------------
  // getStagesForOutputType
  // -------------------------------------------------

  describe("getStagesForOutputType", () => {
    const stages = FULL_STAGES.map((s) => ({
      ...s,
      outputTypes: s.outputTypes || [],
    }));

    it("finds stages that handle a specific output type", () => {
      const result = getStagesForOutputType(stages, "MEASURE");

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("EXTRACT");
    });

    it("returns all stages matching an output type", () => {
      // EXTRACT handles MEASURE, LEARN, CLASSIFY
      const result = getStagesForOutputType(stages, "LEARN");

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("EXTRACT");
    });

    it("returns empty array for unhandled output type", () => {
      const result = getStagesForOutputType(stages, "NONEXISTENT");

      expect(result).toHaveLength(0);
    });

    it("matches COMPOSE output type to COMPOSE stage", () => {
      const result = getStagesForOutputType(stages, "COMPOSE");

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("COMPOSE");
    });

    it("handles multiple stages with overlapping output types", () => {
      const customStages = [
        { name: "A", order: 1, outputTypes: ["MEASURE", "LEARN"] },
        { name: "B", order: 2, outputTypes: ["LEARN", "CLASSIFY"] },
      ];

      const result = getStagesForOutputType(customStages, "LEARN");

      expect(result).toHaveLength(2);
      expect(result.map((s) => s.name)).toEqual(["A", "B"]);
    });
  });

  // -------------------------------------------------
  // Stage ordering and canonical pipeline
  // -------------------------------------------------

  describe("canonical pipeline ordering", () => {
    it("EXTRACT < AGGREGATE < REWARD < ADAPT < SUPERVISE < COMPOSE", async () => {
      mockPrisma.analysisSpec.findFirst.mockResolvedValue({
        slug: "spec-pipeline-001",
        config: makePipelineSpecConfig(FULL_STAGES),
      });

      const stages = await loadPipelineStages();
      const names = stages.map((s) => s.name);

      expect(names).toEqual([
        "EXTRACT",
        "AGGREGATE",
        "REWARD",
        "ADAPT",
        "SUPERVISE",
        "COMPOSE",
      ]);
    });

    it("each stage has a unique order number", async () => {
      mockPrisma.analysisSpec.findFirst.mockResolvedValue({
        slug: "spec-pipeline-001",
        config: makePipelineSpecConfig(FULL_STAGES),
      });

      const stages = await loadPipelineStages();
      const orders = stages.map((s) => s.order);
      const uniqueOrders = new Set(orders);

      expect(uniqueOrders.size).toBe(stages.length);
    });

    it("each stage has a unique name", async () => {
      mockPrisma.analysisSpec.findFirst.mockResolvedValue({
        slug: "spec-pipeline-001",
        config: makePipelineSpecConfig(FULL_STAGES),
      });

      const stages = await loadPipelineStages();
      const names = stages.map((s) => s.name);
      const uniqueNames = new Set(names);

      expect(uniqueNames.size).toBe(stages.length);
    });
  });
});
