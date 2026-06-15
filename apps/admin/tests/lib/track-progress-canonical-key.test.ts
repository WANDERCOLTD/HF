/**
 * #611 Fix A — track-progress.ts canonical moduleId resolution tests.
 *
 * Asserts that `updateCurriculumProgress` writes the lo_mastery key using
 * the canonical CurriculumModule.slug, NOT the raw moduleId passed in
 * (which may be an AI-echoed display name like "Part 1: Familiar Topics"
 * or a UUID). Without resolution, the same LO ends up with two
 * CallerAttribute rows under different keys — the dual-key bug from the
 * Nico Grant evidence call.
 *
 * See: docs/epic-100-chain-walk.md (Link 4 — CALL → SCORE, Link 6 — ADAPT → COMPOSE)
 *      gh issue view 611 (Symptom 1 — dual lo_mastery key contracts)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Mocks
// ============================================================================

const mockPrisma = {
  callerAttribute: {
    upsert: vi.fn(),
    findMany: vi.fn(),
    // #1081 Slice 1 — updateCurriculumProgress now reads existing lo_mastery
    // rows so the max(existing, clamped) discipline can be applied. The
    // canonical-key test doesn't exercise the cap path (no maxMasteryTier on
    // the test Playbook config), so the read just needs to resolve to null.
    findUnique: vi.fn().mockResolvedValue(null),
    deleteMany: vi.fn(),
  },
  curriculum: {
    findFirst: vi.fn().mockResolvedValue(null),
  },
  curriculumModule: {
    findFirst: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
  },
  callerModuleProgress: {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    upsert: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

const mockGetKeyPattern = vi.fn();
const mockGetStorageKeys = vi.fn();
vi.mock("@/lib/contracts/registry", () => ({
  ContractRegistry: {
    getKeyPattern: (...args: any[]) => mockGetKeyPattern(...args),
    getStorageKeys: (...args: any[]) => mockGetStorageKeys(...args),
  },
}));

vi.mock("@/lib/system-settings", () => ({
  getTrustSettings: vi.fn().mockResolvedValue({}),
  TRUST_DEFAULTS: {},
}));

// Stub @/lib/logger so the silent-skip → loud-AppLog promotion (2026-06-15)
// doesn't drag in the SystemSetting cache machinery during unit runs. The
// "refuses to write" case asserts mockLog was called with the new subject.
const mockLog = vi.fn();
vi.mock("@/lib/logger", () => ({
  log: (...args: unknown[]) => mockLog(...args),
}));

const CURRICULUM_KEY_PATTERN = "curriculum:{specSlug}:{key}";
const CURRICULUM_STORAGE_KEYS = {
  currentModule: "current_module",
  mastery: "mastery:{moduleId}",
  loMastery: "lo_mastery:{moduleId}:{loRef}",
  lastAccessed: "last_accessed",
};

describe("#611 Fix A — canonical moduleId in lo_mastery storage keys", () => {
  let updateCurriculumProgress: Function;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    mockGetKeyPattern.mockResolvedValue(CURRICULUM_KEY_PATTERN);
    mockGetStorageKeys.mockResolvedValue(CURRICULUM_STORAGE_KEYS);
    mockPrisma.callerAttribute.upsert.mockResolvedValue({});
    mockPrisma.callerAttribute.findMany.mockResolvedValue([]);
    mockPrisma.callerAttribute.findUnique.mockResolvedValue(null);
    mockPrisma.curriculum.findFirst.mockResolvedValue(null);

    const mod = await import("@/lib/curriculum/track-progress");
    updateCurriculumProgress = mod.updateCurriculumProgress;
  });

  it("resolves a display-name moduleId to its canonical slug before key construction", async () => {
    // AI echoes "Part 1: Familiar Topics" instead of the slug "part1".
    // resolveModuleSlug looks up by title (case-insensitive) and returns "part1".
    mockPrisma.curriculumModule.findFirst.mockResolvedValueOnce(null); // direct slug match fails
    mockPrisma.curriculumModule.findMany.mockResolvedValueOnce([{ slug: "part1" }]); // title match succeeds

    await updateCurriculumProgress("caller-nico", "ielts-curriculum", {
      curriculumId: "cur-xyz",
      loMastery: {
        moduleId: "Part 1: Familiar Topics",
        outcomes: { "OUT-01": 0.9 },
      },
    });

    const upserts = mockPrisma.callerAttribute.upsert.mock.calls.map((c: any) => c[0]);
    const loMasteryUpsert = upserts.find((u: any) =>
      u.where.callerId_key_scope.key.includes(":lo_mastery:"),
    );
    expect(loMasteryUpsert).toBeDefined();
    // Canonical slug "part1", NOT the display name "Part 1: Familiar Topics"
    expect(loMasteryUpsert.where.callerId_key_scope.key).toBe(
      "curriculum:ielts-curriculum:lo_mastery:part1:OUT-01",
    );
  });

  it("uses the slug as-is when AI already returns the canonical form", async () => {
    // Happy path — AI returns "part1" directly. resolveModuleSlug finds it
    // by (curriculumId, slug) lookup and returns "part1".
    mockPrisma.curriculumModule.findFirst.mockResolvedValueOnce({ slug: "part1" });

    await updateCurriculumProgress("caller-nico", "ielts-curriculum", {
      curriculumId: "cur-xyz",
      loMastery: {
        moduleId: "part1",
        outcomes: { "OUT-01": 0.75 },
      },
    });

    const upserts = mockPrisma.callerAttribute.upsert.mock.calls.map((c: any) => c[0]);
    const loMasteryUpsert = upserts.find((u: any) =>
      u.where.callerId_key_scope.key.includes(":lo_mastery:"),
    );
    expect(loMasteryUpsert.where.callerId_key_scope.key).toBe(
      "curriculum:ielts-curriculum:lo_mastery:part1:OUT-01",
    );
  });

  it("refuses to write when moduleId cannot be resolved in the curriculum", async () => {
    // Neither slug match nor title match — module doesn't exist in this
    // curriculum. resolveModuleSlug returns null; the write is skipped.
    mockPrisma.curriculumModule.findFirst.mockResolvedValueOnce(null);
    mockPrisma.curriculumModule.findMany.mockResolvedValueOnce([]);

    await updateCurriculumProgress("caller-nico", "ielts-curriculum", {
      curriculumId: "cur-xyz",
      loMastery: {
        moduleId: "ghost-module",
        outcomes: { "OUT-01": 0.5 },
      },
    });

    const loMasteryUpserts = mockPrisma.callerAttribute.upsert.mock.calls.filter(
      (c: any) => c[0].where.callerId_key_scope.key.includes(":lo_mastery:"),
    );
    // No lo_mastery rows written — refusing to write a corrupt key is the
    // contract under #611.
    expect(loMasteryUpserts).toHaveLength(0);

    // 2026-06-15 — the silent-skip is now LOUD. Assert the AppLog row
    // gets emitted with the canonical subject + the skipped outcome refs
    // so a future `/x/logs` rollup / silent-writer detector can pick it
    // up. The pre-fix behaviour was console.warn-only and invisible to
    // operators — root of the 2026-06-13 mastery fix chain.
    const loudLogCall = mockLog.mock.calls.find(
      (c: any[]) => c[1] === "pipeline.aggregate.lo_mastery_skipped",
    );
    expect(loudLogCall).toBeDefined();
    expect(loudLogCall![0]).toBe("system");
    const payload = loudLogCall![2];
    expect(payload.level).toBe("warn");
    expect(payload.callerId).toBe("caller-nico");
    expect(payload.curriculumId).toBe("cur-xyz");
    expect(payload.rawModuleId).toBe("ghost-module");
    expect(payload.skippedOutcomeCount).toBe(1);
    expect(payload.skippedOutcomeRefs).toEqual(["OUT-01"]);
  });

  it("falls back to the raw moduleId when curriculumId is not provided (legacy callers)", async () => {
    // Callers that haven't been migrated yet must not break. The function
    // skips resolution and uses the raw moduleId — same as legacy behaviour.
    await updateCurriculumProgress("caller-nico", "ielts-curriculum", {
      loMastery: {
        moduleId: "raw-id",
        outcomes: { "OUT-01": 0.6 },
      },
    });

    const upserts = mockPrisma.callerAttribute.upsert.mock.calls.map((c: any) => c[0]);
    const loMasteryUpsert = upserts.find((u: any) =>
      u.where.callerId_key_scope.key.includes(":lo_mastery:"),
    );
    expect(loMasteryUpsert.where.callerId_key_scope.key).toBe(
      "curriculum:ielts-curriculum:lo_mastery:raw-id:OUT-01",
    );
    // curriculumModule.findFirst NOT called — no resolution attempt
    expect(mockPrisma.curriculumModule.findFirst).not.toHaveBeenCalled();
  });
});
