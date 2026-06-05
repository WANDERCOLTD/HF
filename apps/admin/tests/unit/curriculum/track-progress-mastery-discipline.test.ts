/**
 * #1081 Slice 1 — mastery-discipline tests for `updateCurriculumProgress`.
 *
 * AC10  maxMasteryTier cap is applied to the CONTRIBUTION, then takes
 *       max(existing, clamped). Cap NEVER downgrades existing mastery.
 * AC10-a  incoming above DEVELOPING, existing null → write at DEVELOPING ceiling.
 * AC10-b  incoming at DEVELOPING, existing at PRACTITIONER → write stays
 *         at PRACTITIONER (the don't-downgrade property — load-bearing).
 *
 * AC11  useFreshMastery routes the write to `Call.scratchMastery` and
 *       performs ZERO writes to `CallerAttribute.lo_mastery:*`.
 *
 * AC12  After AC11, the long-term `lo_mastery:*` CallerAttribute remains
 *       untouched (no upsert call observed).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Prisma mock ────────────────────────────────────────────────────────────
const mockPrisma = {
  callerAttribute: {
    upsert: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    deleteMany: vi.fn(),
  },
  curriculum: { findFirst: vi.fn().mockResolvedValue(null) },
  curriculumModule: { findMany: vi.fn().mockResolvedValue([]) },
  callerModuleProgress: {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    upsert: vi.fn(),
  },
  call: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  playbook: { findUnique: vi.fn() },
  $transaction: vi.fn(async (fn: any) =>
    typeof fn === "function" ? fn(mockPrisma) : Promise.all(fn),
  ),
};

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

// ─── ContractRegistry mock ──────────────────────────────────────────────────
const mockGetKeyPattern = vi.fn();
const mockGetStorageKeys = vi.fn();
vi.mock("@/lib/contracts/registry", () => ({
  ContractRegistry: {
    getKeyPattern: (...args: any[]) => mockGetKeyPattern(...args),
    getStorageKeys: (...args: any[]) => mockGetStorageKeys(...args),
  },
}));

vi.mock("@/lib/system-settings", () => ({
  getTrustSettings: vi.fn().mockResolvedValue({
    weightL5Regulatory: 1.0,
    weightL4Accredited: 0.9,
    weightL3Published: 0.7,
    weightL2Expert: 0.5,
    weightL1AiAssisted: 0.2,
    weightL0Unverified: 0.05,
    certificationMinWeight: 0.7,
  }),
  TRUST_DEFAULTS: {
    weightL5Regulatory: 1.0,
    weightL4Accredited: 0.9,
    weightL3Published: 0.7,
    weightL2Expert: 0.5,
    weightL1AiAssisted: 0.2,
    weightL0Unverified: 0.05,
    certificationMinWeight: 0.7,
  },
}));

// resolveModuleSlug should be a passthrough so the test keys match the
// expectation. We supply curriculumId so the real code path runs, but the
// underlying CallerAttribute write is the focus.
vi.mock("@/lib/curriculum/resolve-module", () => ({
  resolveModuleSlug: vi.fn(async (_curriculumId: string, moduleId: string) => moduleId),
  resolveModuleByLogicalId: vi.fn(async () => null),
  resolveCurriculumIdForPlaybook: vi.fn(async () => null),
}));

const CURRICULUM_KEY_PATTERN = "curriculum:{specSlug}:{key}";
const CURRICULUM_STORAGE_KEYS = {
  currentModule: "current_module",
  mastery: "mastery:{moduleId}",
  loMastery: "lo_mastery:{moduleId}:{loRef}",
  lastAccessed: "last_accessed",
};

describe("track-progress.ts — #1081 mastery discipline", () => {
  let updateCurriculumProgress: (
    callerId: string,
    specSlug: string,
    updates: Record<string, unknown>,
  ) => Promise<void>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    mockGetKeyPattern.mockResolvedValue(CURRICULUM_KEY_PATTERN);
    mockGetStorageKeys.mockResolvedValue(CURRICULUM_STORAGE_KEYS);

    mockPrisma.callerAttribute.upsert.mockResolvedValue({});
    mockPrisma.callerAttribute.findMany.mockResolvedValue([]);
    mockPrisma.callerAttribute.findUnique.mockResolvedValue(null);
    mockPrisma.callerAttribute.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.curriculum.findFirst.mockResolvedValue(null);
    mockPrisma.call.findUnique.mockResolvedValue({ scratchMastery: null });
    mockPrisma.call.update.mockResolvedValue({});
    mockPrisma.playbook.findUnique.mockResolvedValue(null);

    const mod = await import("@/lib/curriculum/track-progress");
    updateCurriculumProgress = mod.updateCurriculumProgress;
  });

  describe("AC10 — maxMasteryTier cap on the contribution", () => {
    it("AC10-a: cap clamps the contribution when existing is null", async () => {
      // Pop Quiz: cap = DEVELOPING (numeric ceiling 0.5). Incoming 0.9.
      mockPrisma.playbook.findUnique.mockResolvedValue({
        config: { maxMasteryTier: "DEVELOPING" },
      });
      mockPrisma.callerAttribute.findUnique.mockResolvedValue(null);

      await updateCurriculumProgress("caller-1", "spec-1", {
        loMastery: { moduleId: "mod-1", outcomes: { "lo-A": 0.9 } },
        curriculumId: "curr-1",
        playbookId: "pb-pop-quiz",
      });

      // CallerAttribute upsert was called exactly once for lo_mastery
      const upserts = mockPrisma.callerAttribute.upsert.mock.calls.filter(
        (c) => (c[0]?.where?.callerId_key_scope?.key ?? "").includes("lo_mastery"),
      );
      expect(upserts).toHaveLength(1);
      const args = upserts[0][0];
      expect(args.create.numberValue).toBe(0.5); // clamped to DEVELOPING ceiling
      expect(args.update.numberValue).toBe(0.5);
    });

    it("AC10-b (critical, don't-downgrade): cap stays at existing when existing exceeds clamped", async () => {
      // The contract: Pop Quiz writing Developing for an LO already at
      // Practitioner must leave the row at Practitioner.
      // Existing 0.75, incoming 0.5 (already at developing band), cap=DEVELOPING.
      // Final must be 0.75 (existing wins). Cap NEVER downgrades.
      mockPrisma.playbook.findUnique.mockResolvedValue({
        config: { maxMasteryTier: "DEVELOPING" },
      });
      mockPrisma.callerAttribute.findUnique.mockResolvedValue({ numberValue: 0.75 });

      await updateCurriculumProgress("caller-1", "spec-1", {
        loMastery: { moduleId: "mod-1", outcomes: { "lo-A": 0.5 } },
        curriculumId: "curr-1",
        playbookId: "pb-pop-quiz",
      });

      const upserts = mockPrisma.callerAttribute.upsert.mock.calls.filter(
        (c) => (c[0]?.where?.callerId_key_scope?.key ?? "").includes("lo_mastery"),
      );
      expect(upserts).toHaveLength(1);
      const args = upserts[0][0];
      // max(existing=0.75, clamped=0.5) = 0.75 — existing wins.
      expect(args.update.numberValue).toBe(0.75);
      expect(args.create.numberValue).toBe(0.75);
    });
  });

  describe("AC11 — useFreshMastery routes to Call.scratchMastery", () => {
    it("AC11-a: zero CallerAttribute upserts on the lo_mastery key path", async () => {
      mockPrisma.playbook.findUnique.mockResolvedValue({
        config: { useFreshMastery: true },
      });

      await updateCurriculumProgress("caller-1", "spec-1", {
        loMastery: { moduleId: "mod-1", outcomes: { "lo-A": 0.9 } },
        curriculumId: "curr-1",
        playbookId: "pb-exam",
        callId: "call-xyz",
      });

      const loMasteryUpserts = mockPrisma.callerAttribute.upsert.mock.calls.filter(
        (c) => (c[0]?.where?.callerId_key_scope?.key ?? "").includes("lo_mastery"),
      );
      expect(loMasteryUpserts).toHaveLength(0);

      // writeScratchMastery uses prisma.call.update inside a $transaction — at
      // least one update happened for the call row.
      expect(mockPrisma.call.update).toHaveBeenCalled();
      const updateArgs = mockPrisma.call.update.mock.calls[0][0];
      expect(updateArgs.where.id).toBe("call-xyz");
      const written = updateArgs.data.scratchMastery as Record<string, unknown>;
      expect(written["curriculum:spec-1:lo_mastery:mod-1:lo-A"]).toBe(0.9);
    });

    it("AC12: existing lo_mastery CallerAttribute is NOT touched on useFresh path", async () => {
      // Even if the row exists at Practitioner, useFresh must not write/read it.
      mockPrisma.playbook.findUnique.mockResolvedValue({
        config: { useFreshMastery: true },
      });
      mockPrisma.callerAttribute.findUnique.mockResolvedValue({ numberValue: 0.75 });

      await updateCurriculumProgress("caller-1", "spec-1", {
        loMastery: { moduleId: "mod-1", outcomes: { "lo-A": 0.9 } },
        curriculumId: "curr-1",
        playbookId: "pb-exam",
        callId: "call-xyz",
      });

      const loMasteryUpserts = mockPrisma.callerAttribute.upsert.mock.calls.filter(
        (c) => (c[0]?.where?.callerId_key_scope?.key ?? "").includes("lo_mastery"),
      );
      expect(loMasteryUpserts).toHaveLength(0);
      // Also: no read of the long-term row on the useFresh path (it's irrelevant).
      const reads = mockPrisma.callerAttribute.findUnique.mock.calls.filter(
        (c) => (c[0]?.where?.callerId_key_scope?.key ?? "").includes("lo_mastery"),
      );
      expect(reads).toHaveLength(0);
    });
  });
});
