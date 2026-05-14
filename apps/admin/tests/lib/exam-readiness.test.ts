/**
 * Tests for exam readiness system (lib/curriculum/exam-readiness.ts)
 *
 * Key behavior:
 *   - All storage keys come from EXAM_READINESS_V1 contract (no hardcoding)
 *   - Readiness = (avgModuleMastery * masteryWeight) + (formativeScore * formativeWeight)
 *   - Levels: not_ready (< 0.50), borderline (< 0.66), ready (< 0.80), strong (>= 0.80)
 *   - Gate blocks exam when readiness < notReadyMax
 *   - recordExamResult updates Goal to COMPLETED on pass
 *   - EXAM_READINESS_V1 contract structure validated
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = vi.hoisted(() => ({
  callerAttribute: {
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  analysisSpec: {
    findFirst: vi.fn(),
  },
  goal: {
    findFirst: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

// Mock ContractRegistry
const mockContractRegistry = vi.hoisted(() => ({
  getContract: vi.fn(),
  getKeyPattern: vi.fn(),
  getStorageKeys: vi.fn(),
  getThresholds: vi.fn(),
}));

vi.mock("@/lib/contracts/registry", () => ({
  ContractRegistry: mockContractRegistry,
}));

// Mock track-progress
const mockGetCurriculumProgress = vi.hoisted(() => vi.fn());
const mockGetActiveCurricula = vi.hoisted(() => vi.fn());

vi.mock("@/lib/curriculum/track-progress", () => ({
  getCurriculumProgress: mockGetCurriculumProgress,
  getActiveCurricula: mockGetActiveCurricula,
}));

// =====================================================
// IMPORT AFTER MOCKING
// =====================================================

import {
  computeExamReadiness,
  checkExamGate,
  recordExamResult,
  updateFormativeScore,
  getAllExamReadiness,
} from "@/lib/curriculum/exam-readiness";

// =====================================================
// CONTRACT DATA (matches EXAM_READINESS_V1.contract.json)
// =====================================================

const CONTRACT_KEY_PATTERN = "exam_readiness:{specSlug}:{key}";
const CONTRACT_STORAGE_KEYS = {
  readinessScore: "readiness_score",
  formativeScore: "formative_score",
  weakModules: "weak_modules",
  lastAssessedAt: "last_assessed_at",
  attemptCount: "attempt_count",
  lastAttemptPassed: "last_attempt_passed",
  bestScore: "best_score",
};
const CONTRACT_THRESHOLDS = {
  notReadyMax: 0.50,
  borderlineMax: 0.66,
  readyMax: 0.80,
  passMarkDefault: 0.66,
  formativePassThreshold: 0.66,
  masteryWeight: 0.6,
  formativeWeight: 0.4,
};

function setupContractMocks() {
  mockContractRegistry.getKeyPattern.mockResolvedValue(CONTRACT_KEY_PATTERN);
  mockContractRegistry.getStorageKeys.mockResolvedValue(CONTRACT_STORAGE_KEYS);
  mockContractRegistry.getThresholds.mockResolvedValue(CONTRACT_THRESHOLDS);
}

// =====================================================
// TESTS: Contract validation
// =====================================================

describe("EXAM_READINESS_V1 contract file", () => {
  const contractPath = path.resolve(
    __dirname,
    "../../docs-archive/bdd-specs/contracts/EXAM_READINESS_V1.contract.json",
  );

  it("contract file exists and is valid JSON", () => {
    expect(fs.existsSync(contractPath)).toBe(true);
    const raw = fs.readFileSync(contractPath, "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("has required structure", () => {
    const contract = JSON.parse(fs.readFileSync(contractPath, "utf-8"));
    expect(contract.contractId).toBe("EXAM_READINESS_V1");
    expect(contract.storage).toBeDefined();
    expect(contract.storage.keyPattern).toBeDefined();
    expect(contract.storage.keys).toBeDefined();
    expect(contract.thresholds).toBeDefined();
  });

  it("has all expected storage keys", () => {
    const contract = JSON.parse(fs.readFileSync(contractPath, "utf-8"));
    const keys = contract.storage.keys;
    expect(keys.readinessScore).toBeDefined();
    expect(keys.formativeScore).toBeDefined();
    expect(keys.weakModules).toBeDefined();
    expect(keys.lastAssessedAt).toBeDefined();
    expect(keys.attemptCount).toBeDefined();
    expect(keys.lastAttemptPassed).toBeDefined();
    expect(keys.bestScore).toBeDefined();
  });

  it("has all expected thresholds", () => {
    const contract = JSON.parse(fs.readFileSync(contractPath, "utf-8"));
    const t = contract.thresholds;
    expect(t.notReadyMax).toBeTypeOf("number");
    expect(t.borderlineMax).toBeTypeOf("number");
    expect(t.readyMax).toBeTypeOf("number");
    expect(t.passMarkDefault).toBeTypeOf("number");
    expect(t.masteryWeight).toBeTypeOf("number");
    expect(t.formativeWeight).toBeTypeOf("number");
    // Weights must sum to 1.0
    expect(t.masteryWeight + t.formativeWeight).toBeCloseTo(1.0, 5);
  });

  it("threshold ordering is logical", () => {
    const contract = JSON.parse(fs.readFileSync(contractPath, "utf-8"));
    const t = contract.thresholds;
    expect(t.notReadyMax).toBeLessThan(t.borderlineMax);
    expect(t.borderlineMax).toBeLessThan(t.readyMax);
    expect(t.readyMax).toBeLessThanOrEqual(1.0);
  });
});

// =====================================================
// TESTS: computeExamReadiness
// =====================================================

describe("computeExamReadiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupContractMocks();
    // Default: no stored exam data
    mockPrisma.callerAttribute.findMany.mockResolvedValue([]);
  });

  it("returns not_ready when no mastery and no formative", async () => {
    mockGetCurriculumProgress.mockResolvedValue({
      currentModuleId: null,
      modulesMastery: {},
      lastAccessedAt: null,
    });

    const result = await computeExamReadiness("caller-1", "curr-fs-l2-001");

    expect(result.level).toBe("not_ready");
    expect(result.readinessScore).toBe(0);
    expect(result.gateStatus.allowed).toBe(false);
  });

  it("computes readiness from mastery alone when no formative score", async () => {
    mockGetCurriculumProgress.mockResolvedValue({
      currentModuleId: "MOD-3",
      modulesMastery: { "MOD-1": 1.0, "MOD-2": 0.9, "MOD-3": 0.7 },
      lastAccessedAt: null,
    });

    const result = await computeExamReadiness("caller-1", "curr-fs-l2-001");

    // avgMastery = (1.0 + 0.9 + 0.7) / 3 ≈ 0.867
    // No formative → readiness = avgMastery ≈ 0.867
    expect(result.readinessScore).toBeGreaterThan(0.8);
    expect(result.level).toBe("strong"); // >= 0.80
    expect(result.gateStatus.allowed).toBe(true);
  });

  it("computes weighted readiness when formative score exists", async () => {
    mockGetCurriculumProgress.mockResolvedValue({
      currentModuleId: "MOD-2",
      modulesMastery: { "MOD-1": 0.9, "MOD-2": 0.7 },
      lastAccessedAt: null,
    });

    // Stored formative score
    const prefix = "exam_readiness:curr-fs-l2-001:";
    mockPrisma.callerAttribute.findMany.mockResolvedValue([
      { key: `${prefix}formative_score`, numberValue: 0.5 },
    ]);

    const result = await computeExamReadiness("caller-1", "curr-fs-l2-001");

    // avgMastery = (0.9 + 0.7) / 2 = 0.8
    // readiness = (0.8 * 0.6) + (0.5 * 0.4) = 0.48 + 0.20 = 0.68
    expect(result.readinessScore).toBeCloseTo(0.68, 2);
    expect(result.level).toBe("ready"); // >= 0.66, < 0.80
    expect(result.formativeScore).toBe(0.5);
  });

  it("identifies weak modules below formative threshold", async () => {
    mockGetCurriculumProgress.mockResolvedValue({
      currentModuleId: "MOD-3",
      modulesMastery: { "MOD-1": 0.9, "MOD-2": 0.4, "MOD-3": 0.3 },
      lastAccessedAt: null,
    });

    const result = await computeExamReadiness("caller-1", "curr-fs-l2-001");

    // MOD-2 (0.4) and MOD-3 (0.3) are below formativePassThreshold (0.66)
    expect(result.weakModules).toContain("MOD-2");
    expect(result.weakModules).toContain("MOD-3");
    expect(result.weakModules).not.toContain("MOD-1");
  });

  it("returns borderline level for scores between notReadyMax and borderlineMax", async () => {
    mockGetCurriculumProgress.mockResolvedValue({
      currentModuleId: "MOD-2",
      modulesMastery: { "MOD-1": 0.6, "MOD-2": 0.5 },
      lastAccessedAt: null,
    });

    const result = await computeExamReadiness("caller-1", "curr-fs-l2-001");

    // avgMastery = 0.55 → between 0.50 and 0.66
    expect(result.readinessScore).toBeCloseTo(0.55, 2);
    expect(result.level).toBe("borderline");
    expect(result.gateStatus.allowed).toBe(true);
    expect(result.gateStatus.reason).toContain("Borderline");
  });
});

// =====================================================
// TESTS: checkExamGate
// =====================================================

describe("checkExamGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupContractMocks();
    mockPrisma.callerAttribute.findMany.mockResolvedValue([]);
  });

  it("blocks exam when readiness below notReadyMax", async () => {
    mockGetCurriculumProgress.mockResolvedValue({
      currentModuleId: null,
      modulesMastery: { "MOD-1": 0.3 },
      lastAccessedAt: null,
    });

    const gate = await checkExamGate("caller-1", "curr-fs-l2-001");

    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain("below minimum");
  });

  it("allows exam when readiness at notReadyMax", async () => {
    mockGetCurriculumProgress.mockResolvedValue({
      currentModuleId: null,
      modulesMastery: { "MOD-1": 0.5 },
      lastAccessedAt: null,
    });

    const gate = await checkExamGate("caller-1", "curr-fs-l2-001");

    expect(gate.allowed).toBe(true);
  });
});

// =====================================================
// TESTS: recordExamResult
// =====================================================

describe("recordExamResult", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupContractMocks();
    mockPrisma.callerAttribute.findMany.mockResolvedValue([]);
    mockPrisma.callerAttribute.upsert.mockResolvedValue({});
    mockGetCurriculumProgress.mockResolvedValue({
      currentModuleId: null,
      modulesMastery: { "MOD-1": 1.0, "MOD-2": 0.8 },
      lastAccessedAt: null,
    });
  });

  it("stores attempt count, pass status, and best score", async () => {
    mockPrisma.analysisSpec.findFirst.mockResolvedValue(null);

    await recordExamResult("caller-1", "curr-fs-l2-001", 0.72, 20, 15);

    // Should have called upsert for: attemptCount, lastAttemptPassed, bestScore,
    // plus readinessScore, weakModules, lastAssessedAt from storeExamReadiness
    expect(mockPrisma.callerAttribute.upsert).toHaveBeenCalled();

    // Check the attempt count upsert
    const upsertCalls = mockPrisma.callerAttribute.upsert.mock.calls;
    const attemptCall = upsertCalls.find(
      (c: any) => c[0].create?.key?.includes("attempt_count"),
    );
    expect(attemptCall).toBeDefined();
    expect(attemptCall![0].create.numberValue).toBe(1);
  });

  it("marks Goal as COMPLETED when exam passed", async () => {
    mockPrisma.analysisSpec.findFirst.mockResolvedValue({
      id: "spec-123",
      name: "Food Safety L2",
    });
    mockPrisma.goal.findFirst.mockResolvedValue({
      id: "goal-1",
      progressMetrics: {},
    });
    mockPrisma.goal.update.mockResolvedValue({});

    await recordExamResult("caller-1", "curr-fs-l2-001", 0.72, 20, 15);

    expect(mockPrisma.goal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "goal-1" },
        data: expect.objectContaining({
          status: "COMPLETED",
          progress: 1.0,
        }),
      }),
    );
  });

  it("creates COMPLETED Goal if none exists when exam passed", async () => {
    mockPrisma.analysisSpec.findFirst.mockResolvedValue({
      id: "spec-123",
      name: "Food Safety L2",
    });
    mockPrisma.goal.findFirst.mockResolvedValue(null);
    mockPrisma.goal.create.mockResolvedValue({});

    await recordExamResult("caller-1", "curr-fs-l2-001", 0.72, 20, 15);

    expect(mockPrisma.goal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          callerId: "caller-1",
          type: "LEARN",
          name: "Food Safety L2",
          status: "COMPLETED",
          progress: 1.0,
        }),
      }),
    );
  });

  it("does NOT update Goal when exam failed", async () => {
    mockPrisma.analysisSpec.findFirst.mockResolvedValue({
      id: "spec-123",
      name: "Food Safety L2",
    });

    // Score 0.50 < passMarkDefault 0.66
    await recordExamResult("caller-1", "curr-fs-l2-001", 0.50, 20, 10);

    expect(mockPrisma.goal.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.goal.update).not.toHaveBeenCalled();
    expect(mockPrisma.goal.create).not.toHaveBeenCalled();
  });
});

// =====================================================
// TESTS: updateFormativeScore
// =====================================================

describe("updateFormativeScore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupContractMocks();
    mockPrisma.callerAttribute.findMany.mockResolvedValue([]);
    mockPrisma.callerAttribute.upsert.mockResolvedValue({});
    mockGetCurriculumProgress.mockResolvedValue({
      currentModuleId: null,
      modulesMastery: { "MOD-1": 0.8 },
      lastAccessedAt: null,
    });
  });

  it("stores average formative score and recomputes readiness", async () => {
    const result = await updateFormativeScore("caller-1", "curr-fs-l2-001", {
      "MOD-1": 0.8,
      "MOD-2": 0.6,
    });

    // Should have stored formative score via upsert
    const upsertCalls = mockPrisma.callerAttribute.upsert.mock.calls;
    const formativeCall = upsertCalls.find(
      (c: any) => c[0].create?.key?.includes("formative_score"),
    );
    expect(formativeCall).toBeDefined();
    // Average of 0.8 and 0.6 = 0.7
    expect(formativeCall![0].create.numberValue).toBeCloseTo(0.7, 2);

    // Should return recomputed readiness
    expect(result.specSlug).toBe("curr-fs-l2-001");
    expect(result.readinessScore).toBeTypeOf("number");
  });
});

// =====================================================
// TESTS: getAllExamReadiness
// =====================================================

describe("getAllExamReadiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupContractMocks();
    mockPrisma.callerAttribute.findMany.mockResolvedValue([]);
  });

  it("returns empty array when no active curricula", async () => {
    mockGetActiveCurricula.mockResolvedValue([]);

    const results = await getAllExamReadiness("caller-1");

    expect(results).toEqual([]);
  });

  it("computes readiness for each active curriculum", async () => {
    mockGetActiveCurricula.mockResolvedValue(["curr-fs-l2-001", "curr-qm-001"]);
    mockGetCurriculumProgress.mockResolvedValue({
      currentModuleId: null,
      modulesMastery: { "MOD-1": 0.5 },
      lastAccessedAt: null,
    });

    const results = await getAllExamReadiness("caller-1");

    expect(results).toHaveLength(2);
    expect(results[0].specSlug).toBe("curr-fs-l2-001");
    expect(results[1].specSlug).toBe("curr-qm-001");
  });

  it("returns empty array when contract fails to load", async () => {
    mockGetActiveCurricula.mockRejectedValue(new Error("Contract not loaded"));

    const results = await getAllExamReadiness("caller-1");

    expect(results).toEqual([]);
  });
});

// =====================================================
// TESTS: No hardcoding verification
// =====================================================

describe("no hardcoded values", () => {
  it("exam-readiness.ts does not contain hardcoded key patterns", () => {
    const filePath = path.resolve(__dirname, "../../lib/curriculum/exam-readiness.ts");
    const source = fs.readFileSync(filePath, "utf-8");

    // Should NOT contain literal key patterns (they come from contract)
    expect(source).not.toMatch(/["']exam_readiness:[^{]/);
    // Should reference ContractRegistry for keys
    expect(source).toContain("ContractRegistry.getKeyPattern");
    expect(source).toContain("ContractRegistry.getStorageKeys");
    expect(source).toContain("ContractRegistry.getThresholds");
  });

  it("shared constants file exists and exports required fields", () => {
    const filePath = path.resolve(__dirname, "../../lib/curriculum/constants.ts");
    const source = fs.readFileSync(filePath, "utf-8");
    expect(source).toContain("CURRICULUM_REQUIRED_FIELDS");
    expect(source).toContain("EXAM_LEVEL_CONFIG");
  });
});
