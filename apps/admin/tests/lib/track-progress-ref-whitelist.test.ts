/**
 * #1117 — AI-to-DB LO ref whitelist guard.
 *
 * Covers:
 *   - validateLoScores accepts allowedRefs (Set or Array)
 *   - Rejects refs not in catalog
 *   - Still rejects LO\d+ placeholders (back-compat with #403)
 *   - When allowedRefs is undefined, behaves like legacy (catalog check skipped)
 *   - updateCurriculumProgress per-LO write path filters AI-hallucinated refs
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => {
  const mockPrisma = {
    callerAttribute: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) },
    learningObjective: { findMany: vi.fn() },
    callerModuleProgress: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) },
    curriculum: { findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn().mockResolvedValue(null) },
    curriculumModule: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { prisma: mockPrisma };
});
vi.mock("@/lib/contracts/registry", () => ({
  ContractRegistry: {
    getKeyPattern: vi.fn().mockResolvedValue("curriculum:{specSlug}:{key}"),
    getStorageKeys: vi.fn().mockResolvedValue({
      currentModule: "current_module",
      mastery: "mastery:{moduleId}",
      loMastery: "lo_mastery:{moduleId}:{loRef}",
      lastAccessed: "last_accessed",
    }),
  },
}));
vi.mock("@/lib/system-settings", () => ({
  getTrustSettings: vi.fn().mockResolvedValue({}),
  TRUST_DEFAULTS: {},
}));
vi.mock("@/lib/curriculum/resolve-module", () => ({
  resolveModuleByLogicalId: vi.fn().mockResolvedValue({ id: "module-uuid" }),
  resolveModuleSlug: vi.fn(async (_curriculumId: string, mod: string) => mod),
}));
vi.mock("@/lib/curriculum/playbook-mastery-config", () => ({
  getMaxMasteryTier: vi.fn().mockResolvedValue(null),
  isUseFreshMastery: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/curriculum/scratch-mastery", () => ({
  writeScratchMastery: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/curriculum/readiness-rollups", () => ({
  computeReadinessRollups: vi.fn().mockResolvedValue(undefined),
}));

describe("validateLoScores — #1117 ref whitelist guard", () => {
  let mod: typeof import("@/lib/curriculum/track-progress");

  beforeEach(async () => {
    vi.clearAllMocks();
    mod = await import("@/lib/curriculum/track-progress");
  });

  it("legacy behaviour: without allowedRefs, only LO\\d+ placeholders are rejected", () => {
    const { filtered, rejected } = mod.validateLoScores({
      "OUT-04-01": 0.7,
      "OUT-04-99": 0.6, // structurally valid; would pass legacy guard
      LO1: 0.4, // placeholder
      LO99: 0.2,
    });
    expect(filtered).toEqual({ "OUT-04-01": 0.7, "OUT-04-99": 0.6 });
    expect(rejected.sort()).toEqual(["LO1", "LO99"].sort());
  });

  it("with allowedRefs as Set: rejects refs not in catalog", () => {
    const allowed = new Set(["OUT-04-01", "OUT-04-02", "OUT-04-03"]);
    const { filtered, rejected } = mod.validateLoScores(
      {
        "OUT-04-01": 0.7,
        "OUT-04-99": 0.6, // hallucinated
        "OUT-99-99": 0.5, // hallucinated
      },
      allowed,
    );
    expect(filtered).toEqual({ "OUT-04-01": 0.7 });
    expect(rejected.sort()).toEqual(["OUT-04-99", "OUT-99-99"].sort());
  });

  it("with allowedRefs as Array: same semantics", () => {
    const { filtered, rejected } = mod.validateLoScores(
      { "OUT-04-01": 0.7, BAD: 0.5 },
      ["OUT-04-01", "OUT-04-02"] as const,
    );
    expect(filtered).toEqual({ "OUT-04-01": 0.7 });
    expect(rejected).toEqual(["BAD"]);
  });

  it("placeholder check still fires when allowedRefs supplied", () => {
    const { filtered, rejected } = mod.validateLoScores(
      { LO1: 0.4, "OUT-04-01": 0.7 },
      new Set(["LO1", "OUT-04-01"]), // even if LO1 is in the catalog
    );
    expect(filtered).toEqual({ "OUT-04-01": 0.7 });
    expect(rejected).toEqual(["LO1"]);
  });

  it("empty allowedRefs rejects everything (defensive)", () => {
    const { filtered, rejected } = mod.validateLoScores(
      { "OUT-04-01": 0.7, "OUT-04-02": 0.6 },
      new Set<string>(),
    );
    expect(filtered).toEqual({});
    expect(rejected.sort()).toEqual(["OUT-04-01", "OUT-04-02"].sort());
  });
});

describe("updateCurriculumProgress — per-LO write filters AI-hallucinated refs (#1117)", () => {
  let mod: typeof import("@/lib/curriculum/track-progress");
  let prismaMock: {
    learningObjective: { findMany: ReturnType<typeof vi.fn> };
    callerAttribute: {
      findUnique: ReturnType<typeof vi.fn>;
      upsert: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mod = await import("@/lib/curriculum/track-progress");
    const { prisma } = await import("@/lib/prisma");
    prismaMock = prisma as unknown as typeof prismaMock;
  });

  it("writes valid refs and refuses hallucinated ones", async () => {
    prismaMock.learningObjective.findMany.mockResolvedValue([
      { ref: "OUT-04-01" },
      { ref: "OUT-04-02" },
      { ref: "OUT-04-03" },
    ]);
    prismaMock.callerAttribute.findUnique.mockResolvedValue(null);
    prismaMock.callerAttribute.upsert.mockResolvedValue({});

    await mod.updateCurriculumProgress("caller-1", "the-standard-v1", {
      loMastery: {
        moduleId: "standard-unit-04",
        outcomes: {
          "OUT-04-01": 0.7,
          "OUT-04-02": 0.6,
          "OUT-04-99": 0.5, // hallucinated — must be rejected
          "OUT-99-99": 0.4, // hallucinated — must be rejected
        },
      },
      curriculumId: "cur-1",
      callId: "call-1",
    });

    // Only 2 valid LO writes should have been pushed to upsert.
    const upsertCalls = prismaMock.callerAttribute.upsert.mock.calls;
    const keys = upsertCalls.map((c) => c[0].where.callerId_key_scope.key).sort();
    expect(keys).toEqual([
      "curriculum:the-standard-v1:lo_mastery:standard-unit-04:OUT-04-01",
      "curriculum:the-standard-v1:lo_mastery:standard-unit-04:OUT-04-02",
    ]);
  });

  it("when curriculumId is absent, skips catalog check (legacy back-compat)", async () => {
    prismaMock.callerAttribute.findUnique.mockResolvedValue(null);
    prismaMock.callerAttribute.upsert.mockResolvedValue({});

    await mod.updateCurriculumProgress("caller-1", "spec-x", {
      loMastery: {
        moduleId: "module-x",
        outcomes: {
          "ANY-REF": 0.7,
          "ANOTHER-REF": 0.6,
        },
      },
      callId: "call-2",
      // No curriculumId — legacy path; no catalog query.
    });

    expect(prismaMock.learningObjective.findMany).not.toHaveBeenCalled();
    // Both refs written.
    expect(prismaMock.callerAttribute.upsert).toHaveBeenCalledTimes(2);
  });

  it("#1117 follow-up — placeholder LO\\d+ refs rejected at write boundary even without curriculumId", async () => {
    prismaMock.callerAttribute.findUnique.mockResolvedValue(null);
    prismaMock.callerAttribute.upsert.mockResolvedValue({});

    await mod.updateCurriculumProgress("caller-1", "spec-y", {
      loMastery: {
        moduleId: "module-y",
        outcomes: {
          LO1: 0.0,
          LO2: 0.0,
          "REAL-REF": 0.6,
        },
      },
      callId: "call-3",
      // No curriculumId — but the LO\d+ placeholder check still fires.
    });

    // Only the real ref was upserted; LO1 / LO2 placeholder refs rejected.
    expect(prismaMock.callerAttribute.upsert).toHaveBeenCalledTimes(1);
    const call = prismaMock.callerAttribute.upsert.mock.calls[0][0];
    expect(call.where.callerId_key_scope.key).toContain(":lo_mastery:module-y:REAL-REF");
  });
});
