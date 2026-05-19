/**
 * Tests for resolveModuleEvidenceTargets — #491 Slice 1.4
 *
 * Exported from app/api/calls/[callId]/pipeline/route.ts. Used by the
 * AGGREGATE stage to build the deduped set of CurriculumModule ids that
 * should receive callCount evidence for this call. Slice 1.3 credited only
 * the bound module (`Call.curriculumModuleId`); Slice 1.4 fans out via the
 * authored `coversModules: string[]` array on the bound module so an IELTS
 * Mock counts as evidence for part1 + part2 + part3.
 *
 * Coverage:
 *  - Mock module with coversModules=[part1,part2,part3] → 4 credits (mock + 3 parts).
 *  - Authored module with coversModules undefined → 1 credit (regression of 1.3).
 *  - AI-authored module with coversModules=[] → 1 credit (regression of 1.3).
 *  - coversModules contains an unknown slug → warn + skip, credit the rest.
 *  - call.curriculumModuleId null → empty credit set, no DB hits.
 *  - Bound CurriculumModule row missing → log warn + return [bound] only.
 *  - Duplicate slug in coversModules → deduped.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// =====================================================
// MOCKS
// =====================================================

const { mockPrisma, mockResolveModuleByLogicalId } = vi.hoisted(() => ({
  mockPrisma: {
    callerModuleProgress: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    curriculumModule: {
      findUnique: vi.fn(),
    },
    // Unused but referenced at route module load time.
    analysisSpec: { findFirst: vi.fn() },
    call: { findUnique: vi.fn() },
    callScore: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    callerMemory: { create: vi.fn() },
    callerPersonality: { upsert: vi.fn() },
    personalityObservation: { create: vi.fn() },
    parameter: { findMany: vi.fn() },
  },
  mockResolveModuleByLogicalId: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("@/lib/curriculum/resolve-module", () => ({
  resolveModuleByLogicalId: mockResolveModuleByLogicalId,
  resolveCurriculumIdForPlaybook: vi.fn(),
}));

// Avoid pulling in real AI / metering / config registries when the route
// module loads.
vi.mock("@/lib/ai/client", () => ({
  isEngineAvailable: vi.fn(() => true),
}));
vi.mock("@/lib/metering", () => ({
  getConfiguredMeteredAICompletion: vi.fn(),
  logMockAIUsage: vi.fn(),
}));
vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn(() => false),
}));

// =====================================================
// FIXTURES
// =====================================================

const CALL_ID = "call-1";
const CURRICULUM_ID = "curr-ielts";
const MOCK_MODULE_ID = "mod-mock-uuid";
const PART1_MODULE_ID = "mod-part1-uuid";
const PART2_MODULE_ID = "mod-part2-uuid";
const PART3_MODULE_ID = "mod-part3-uuid";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    getLogs: vi.fn(() => []),
    getDuration: vi.fn(() => 0),
  };
}

function makeCall(overrides: Partial<{ id: string; playbookId: string | null; curriculumModuleId: string | null }> = {}) {
  return {
    id: CALL_ID,
    playbookId: "pb-ielts",
    curriculumModuleId: MOCK_MODULE_ID,
    ...overrides,
  };
}

// =====================================================
// TESTS
// =====================================================

describe("resolveModuleEvidenceTargets (#491 Slice 1.4)", () => {
  let resolveModuleEvidenceTargets: typeof import("@/app/api/calls/[callId]/pipeline/route").resolveModuleEvidenceTargets;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/calls/[callId]/pipeline/route");
    resolveModuleEvidenceTargets = mod.resolveModuleEvidenceTargets;
  });

  it("fans out for a Mock with coversModules=[part1,part2,part3] (4 credits)", async () => {
    mockPrisma.curriculumModule.findUnique.mockResolvedValue({
      id: MOCK_MODULE_ID,
      slug: "mock",
      curriculumId: CURRICULUM_ID,
      coversModules: ["part1", "part2", "part3"],
    });
    mockResolveModuleByLogicalId.mockImplementation(async (_curriculumId: string, slug: string) => {
      if (slug === "part1") return { id: PART1_MODULE_ID };
      if (slug === "part2") return { id: PART2_MODULE_ID };
      if (slug === "part3") return { id: PART3_MODULE_ID };
      return null;
    });

    const log = makeLogger();
    const targets = await resolveModuleEvidenceTargets(makeCall(), log as any);

    expect(targets).toEqual([
      MOCK_MODULE_ID,
      PART1_MODULE_ID,
      PART2_MODULE_ID,
      PART3_MODULE_ID,
    ]);
    expect(mockResolveModuleByLogicalId).toHaveBeenCalledTimes(3);
    expect(mockResolveModuleByLogicalId).toHaveBeenCalledWith(CURRICULUM_ID, "part1");
    expect(mockResolveModuleByLogicalId).toHaveBeenCalledWith(CURRICULUM_ID, "part2");
    expect(mockResolveModuleByLogicalId).toHaveBeenCalledWith(CURRICULUM_ID, "part3");
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("authored module with coversModules undefined → single credit (Slice 1.3 regression)", async () => {
    mockPrisma.curriculumModule.findUnique.mockResolvedValue({
      id: MOCK_MODULE_ID,
      slug: "mod-1",
      curriculumId: CURRICULUM_ID,
      // coversModules omitted entirely
    });

    const log = makeLogger();
    const targets = await resolveModuleEvidenceTargets(makeCall(), log as any);

    expect(targets).toEqual([MOCK_MODULE_ID]);
    expect(mockResolveModuleByLogicalId).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("AI-generated module with coversModules=[] → single credit (Slice 1.3 regression)", async () => {
    mockPrisma.curriculumModule.findUnique.mockResolvedValue({
      id: MOCK_MODULE_ID,
      slug: "mod-ai",
      curriculumId: CURRICULUM_ID,
      coversModules: [],
    });

    const log = makeLogger();
    const targets = await resolveModuleEvidenceTargets(makeCall(), log as any);

    expect(targets).toEqual([MOCK_MODULE_ID]);
    expect(mockResolveModuleByLogicalId).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("logs and skips an unresolved coversModules slug, credits the rest", async () => {
    mockPrisma.curriculumModule.findUnique.mockResolvedValue({
      id: MOCK_MODULE_ID,
      slug: "mock",
      curriculumId: CURRICULUM_ID,
      coversModules: ["part1", "part-typo", "part3"],
    });
    mockResolveModuleByLogicalId.mockImplementation(async (_curriculumId: string, slug: string) => {
      if (slug === "part1") return { id: PART1_MODULE_ID };
      if (slug === "part3") return { id: PART3_MODULE_ID };
      return null; // part-typo doesn't resolve
    });

    const log = makeLogger();
    const targets = await resolveModuleEvidenceTargets(makeCall(), log as any);

    expect(targets).toEqual([MOCK_MODULE_ID, PART1_MODULE_ID, PART3_MODULE_ID]);
    expect(mockResolveModuleByLogicalId).toHaveBeenCalledTimes(3);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("coversModules slug did not resolve"),
      expect.objectContaining({
        callId: CALL_ID,
        boundModuleId: MOCK_MODULE_ID,
        curriculumId: CURRICULUM_ID,
        unresolvedSlug: "part-typo",
      }),
    );
  });

  it("returns empty when call.curriculumModuleId is null (no DB lookups)", async () => {
    const log = makeLogger();
    const targets = await resolveModuleEvidenceTargets(
      makeCall({ curriculumModuleId: null }),
      log as any,
    );

    expect(targets).toEqual([]);
    expect(mockPrisma.curriculumModule.findUnique).not.toHaveBeenCalled();
    expect(mockResolveModuleByLogicalId).not.toHaveBeenCalled();
  });

  it("warns and returns [bound] when the bound CurriculumModule row is missing", async () => {
    mockPrisma.curriculumModule.findUnique.mockResolvedValue(null);

    const log = makeLogger();
    const targets = await resolveModuleEvidenceTargets(makeCall(), log as any);

    expect(targets).toEqual([MOCK_MODULE_ID]);
    expect(mockResolveModuleByLogicalId).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("bound CurriculumModule not found"),
      expect.objectContaining({ callId: CALL_ID, moduleId: MOCK_MODULE_ID }),
    );
  });

  it("dedupes when coversModules resolves to the bound module or a repeat", async () => {
    mockPrisma.curriculumModule.findUnique.mockResolvedValue({
      id: MOCK_MODULE_ID,
      slug: "mock",
      curriculumId: CURRICULUM_ID,
      coversModules: ["mock", "part1", "part1"], // self-ref + duplicate
    });
    mockResolveModuleByLogicalId.mockImplementation(async (_curriculumId: string, slug: string) => {
      if (slug === "mock") return { id: MOCK_MODULE_ID };
      if (slug === "part1") return { id: PART1_MODULE_ID };
      return null;
    });

    const log = makeLogger();
    const targets = await resolveModuleEvidenceTargets(makeCall(), log as any);

    expect(targets).toEqual([MOCK_MODULE_ID, PART1_MODULE_ID]);
  });

  it("ignores non-string entries in coversModules (defensive against bad seed data)", async () => {
    mockPrisma.curriculumModule.findUnique.mockResolvedValue({
      id: MOCK_MODULE_ID,
      slug: "mock",
      curriculumId: CURRICULUM_ID,
      // Bad authoring data — Prisma string[] would catch this at DB layer once
      // Slice 2.4 lands, but the helper is defensive in the meantime.
      coversModules: ["part1", null, "", 42],
    });
    mockResolveModuleByLogicalId.mockImplementation(async (_curriculumId: string, slug: string) => {
      if (slug === "part1") return { id: PART1_MODULE_ID };
      return null;
    });

    const log = makeLogger();
    const targets = await resolveModuleEvidenceTargets(makeCall(), log as any);

    expect(targets).toEqual([MOCK_MODULE_ID, PART1_MODULE_ID]);
    expect(mockResolveModuleByLogicalId).toHaveBeenCalledTimes(1);
    expect(mockResolveModuleByLogicalId).toHaveBeenCalledWith(CURRICULUM_ID, "part1");
  });
});
