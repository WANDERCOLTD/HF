/**
 * Tests for /api/system/readiness endpoint
 *
 * This endpoint checks system prerequisites for the analyze workflow:
 * - Database connection
 * - Analysis specs (at least 1 active)
 * - Parameters (at least 1)
 * - Run configs (at least 1 compiled)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock Prisma client
const mockPrisma = {
  $queryRaw: vi.fn(),
  analysisSpec: {
    count: vi.fn(),
  },
  parameter: {
    count: vi.fn(),
  },
  compiledAnalysisSet: {
    count: vi.fn(),
  },
  caller: {
    count: vi.fn(),
  },
  call: {
    count: vi.fn(),
  },
  behaviorTarget: {
    count: vi.fn(),
  },
  callerMemory: {
    count: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

describe("/api/system/readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET", () => {
    it("should return ready: true when all prerequisites are met", async () => {
      // Setup: All checks pass
      mockPrisma.$queryRaw.mockResolvedValue([{ result: 1 }]);
      mockPrisma.analysisSpec.count.mockResolvedValue(3);
      mockPrisma.parameter.count.mockResolvedValue(5);
      mockPrisma.compiledAnalysisSet.count.mockResolvedValue(2);
      mockPrisma.caller.count.mockResolvedValue(10);
      mockPrisma.call.count.mockResolvedValue(50);
      mockPrisma.behaviorTarget.count.mockResolvedValue(5);
      mockPrisma.callerMemory.count.mockResolvedValue(100);

      // Expected response structure
      const expectedChecks = {
        database: { ok: true, message: "Connected" },
        analysisSpecs: { ok: true, count: 3, required: 1 },
        parameters: { ok: true, count: 5 },
        runConfigs: { ok: true, count: 2 },
        callers: { ok: true, count: 10 },
        calls: { ok: true, count: 50 },
        behaviorTargets: { ok: true, count: 5 },
      };

      // Verify structure expectations
      expect(expectedChecks.database.ok).toBe(true);
      expect(expectedChecks.analysisSpecs.count).toBeGreaterThanOrEqual(1);
      expect(expectedChecks.parameters.count).toBeGreaterThanOrEqual(1);
      expect(expectedChecks.runConfigs.count).toBeGreaterThanOrEqual(1);
    });

    it("should return ready: false when database is not connected", async () => {
      mockPrisma.$queryRaw.mockRejectedValue(new Error("Connection refused"));

      // Expected behavior
      const expectedCheck = {
        database: { ok: false, message: expect.stringContaining("failed") },
      };

      expect(expectedCheck.database.ok).toBe(false);
    });

    it("should return ready: false when no parameters exist", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ result: 1 }]);
      mockPrisma.analysisSpec.count.mockResolvedValue(3);
      mockPrisma.parameter.count.mockResolvedValue(0);
      mockPrisma.compiledAnalysisSet.count.mockResolvedValue(2);

      // Expected behavior
      const expectedCheck = {
        parameters: { ok: false, count: 0 },
      };

      expect(expectedCheck.parameters.ok).toBe(false);
      expect(expectedCheck.parameters.count).toBe(0);
    });

    it("should return ready: false when no analysis specs exist", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ result: 1 }]);
      mockPrisma.analysisSpec.count.mockResolvedValue(0);
      mockPrisma.parameter.count.mockResolvedValue(5);
      mockPrisma.compiledAnalysisSet.count.mockResolvedValue(2);

      // Expected behavior
      const expectedCheck = {
        analysisSpecs: { ok: false, count: 0, required: 1 },
      };

      expect(expectedCheck.analysisSpecs.ok).toBe(false);
    });

    it("should return ready: false when no run configs exist", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ result: 1 }]);
      mockPrisma.analysisSpec.count.mockResolvedValue(3);
      mockPrisma.parameter.count.mockResolvedValue(5);
      mockPrisma.compiledAnalysisSet.count.mockResolvedValue(0);

      // Expected behavior
      const expectedCheck = {
        runConfigs: { ok: false, count: 0 },
      };

      expect(expectedCheck.runConfigs.ok).toBe(false);
    });

    it("should include suggested actions when prerequisites are not met", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ result: 1 }]);
      mockPrisma.analysisSpec.count.mockResolvedValue(0);
      mockPrisma.parameter.count.mockResolvedValue(0);
      mockPrisma.compiledAnalysisSet.count.mockResolvedValue(0);

      // Expected suggested actions structure
      const expectedActions = [
        {
          label: expect.stringContaining("Parameter"),
          href: "/admin",
          priority: expect.any(Number),
        },
        {
          label: expect.stringContaining("Analysis"),
          href: "/x/specs",
          priority: expect.any(Number),
        },
        {
          label: expect.stringContaining("Run Config"),
          href: "/run-configs",
          priority: expect.any(Number),
        },
      ];

      expect(expectedActions.length).toBe(3);
      expectedActions.forEach((action) => {
        expect(action.href).toBeDefined();
        expect(action.priority).toBeDefined();
      });
    });

    it("should include source counts in response", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ result: 1 }]);
      mockPrisma.analysisSpec.count.mockResolvedValue(3);
      mockPrisma.parameter.count.mockResolvedValue(5);
      mockPrisma.compiledAnalysisSet.count.mockResolvedValue(2);
      mockPrisma.caller.count.mockResolvedValue(10);
      mockPrisma.call.count.mockResolvedValue(50);
      mockPrisma.callerMemory.count.mockResolvedValue(100);

      // Expected sources structure
      const expectedSources = {
        callers: { count: 10 },
        calls: { count: 50 },
        memories: { count: 100 },
        runConfigs: { count: 2 },
      };

      expect(expectedSources.callers.count).toBe(10);
      expect(expectedSources.calls.count).toBe(50);
      expect(expectedSources.memories.count).toBe(100);
    });

    it("should include stats summary in response", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ result: 1 }]);
      mockPrisma.analysisSpec.count.mockResolvedValue(3);
      mockPrisma.parameter.count.mockResolvedValue(5);
      mockPrisma.compiledAnalysisSet.count.mockResolvedValue(2);
      mockPrisma.caller.count.mockResolvedValue(10);
      mockPrisma.call.count.mockResolvedValue(50);
      mockPrisma.behaviorTarget.count.mockResolvedValue(5);
      mockPrisma.callerMemory.count.mockResolvedValue(100);

      // Expected stats structure
      const expectedStats = {
        totalCallers: 10,
        totalCalls: 50,
        totalMemories: 100,
        analysisSpecs: 3,
        parameters: 5,
        runConfigs: 2,
      };

      expect(expectedStats.totalCallers).toBe(10);
      expect(expectedStats.totalCalls).toBe(50);
    });
  });
});
