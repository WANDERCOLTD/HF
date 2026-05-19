/**
 * Tests for `generateDiagnosticFromMock` — #494 E2 Slice 2.6.
 *
 * Deterministic per-learner diagnostic generated after a Mock call's
 * AGGREGATE stage. Inputs: the covered module set + the call's CallScore
 * rows. Outputs: weakest-first focusModules + strongest strengthModule +
 * lowest-scored skill name + canned summary string.
 *
 * Coverage:
 *  1. coveredModuleIds < 2 → returns null (not a Mock).
 *  2. Three modules with mastery [0.3, 0.6, 0.8] → focus = two weakest,
 *     strength = strongest.
 *  3. All masteries tied at 0 → strengthModule = null (no clear winner).
 *  4. No CallScore rows for the call → weakSkill = null.
 *  5. Summary references the module titles.
 *  6. generatedAt is ISO and within ±1s of Date.now().
 */

import { describe, it, expect, vi } from "vitest";

import {
  generateDiagnosticFromMock,
  MAX_FOCUS_MODULES,
  MOCK_MIN_COVERED_MODULES,
} from "@/lib/curriculum/diagnostic-from-mock";

// =====================================================
// MOCKS
// =====================================================

// `generateDiagnosticFromMock` calls `computeModuleMastery` internally — mock
// it so we can drive the mastery values per module without seeding CallScore
// rows. The helper itself is exhaustively tested in compute-mastery.test.ts.
vi.mock("@/lib/curriculum/compute-mastery", () => ({
  computeModuleMastery: vi.fn(),
}));

import { computeModuleMastery } from "@/lib/curriculum/compute-mastery";

const mockComputeMastery = computeModuleMastery as unknown as ReturnType<
  typeof vi.fn
>;

// =====================================================
// FIXTURES
// =====================================================

const CALL_ID = "call-mock-1";
const CALLER_ID = "caller-1";
const CURRICULUM_ID = "curr-ielts";
const MOD_A = "mod-a";
const MOD_B = "mod-b";
const MOD_C = "mod-c";

/**
 * Build a minimal Prisma stub matching the surface area used by
 * `generateDiagnosticFromMock`: callScore.findFirst + curriculumModule.findMany.
 */
function makePrismaStub(opts: {
  lowestScoreParameterName?: string | null;
  moduleTitles?: Record<string, string>;
}) {
  const titles = opts.moduleTitles ?? {};
  return {
    callScore: {
      findFirst: vi.fn(async () => {
        if (opts.lowestScoreParameterName === undefined) return null;
        if (opts.lowestScoreParameterName === null) return null;
        return { parameter: { name: opts.lowestScoreParameterName } };
      }),
    },
    curriculumModule: {
      findMany: vi.fn(async (args: any) => {
        const ids: string[] = args?.where?.id?.in ?? [];
        return ids.map((id) => ({ id, title: titles[id] ?? id }));
      }),
    },
  } as any;
}

// =====================================================
// TESTS
// =====================================================

describe("generateDiagnosticFromMock (#494 E2 Slice 2.6)", () => {
  it("constants are sensible", () => {
    expect(MOCK_MIN_COVERED_MODULES).toBe(2);
    expect(MAX_FOCUS_MODULES).toBe(3);
  });

  it("returns null when coveredModuleIds.length < MOCK_MIN_COVERED_MODULES", async () => {
    // One module covered → not a Mock, no diagnostic.
    const prisma = makePrismaStub({});
    mockComputeMastery.mockClear();

    const result = await generateDiagnosticFromMock(prisma, {
      callId: CALL_ID,
      callerId: CALLER_ID,
      curriculumId: CURRICULUM_ID,
      coveredModuleIds: [MOD_A],
      playbookConfig: null,
    });

    expect(result).toBeNull();
    expect(mockComputeMastery).not.toHaveBeenCalled();
  });

  it("sorts by mastery ascending: focusModules = two weakest, strengthModule = strongest", async () => {
    // Mastery: a=0.3, b=0.6, c=0.8 → focus=[a,b], strength=c.
    mockComputeMastery.mockImplementation(
      async (_p: unknown, args: { moduleId: string }) => {
        const map: Record<string, number> = {
          [MOD_A]: 0.3,
          [MOD_B]: 0.6,
          [MOD_C]: 0.8,
        };
        return {
          mastery: map[args.moduleId] ?? 0,
          evidenceCount: 5,
          shouldMarkCompleted: false,
        };
      },
    );
    const prisma = makePrismaStub({
      lowestScoreParameterName: "fluency",
      moduleTitles: {
        [MOD_A]: "Part 1",
        [MOD_B]: "Part 2",
        [MOD_C]: "Part 3",
      },
    });

    const result = await generateDiagnosticFromMock(prisma, {
      callId: CALL_ID,
      callerId: CALLER_ID,
      curriculumId: CURRICULUM_ID,
      coveredModuleIds: [MOD_C, MOD_A, MOD_B], // unsorted input
      playbookConfig: null,
    });

    expect(result).not.toBeNull();
    expect(result!.focusModules).toEqual([MOD_A, MOD_B]);
    expect(result!.strengthModule).toBe(MOD_C);
    expect(result!.fromCallId).toBe(CALL_ID);
  });

  it("strengthModule = null when every covered mastery is tied at 0", async () => {
    // First Mock for a caller with no prior calls → every module's mastery is
    // 0 (insufficient evidence). No clear winner to surface as a strength.
    mockComputeMastery.mockResolvedValue({
      mastery: 0,
      evidenceCount: 0,
      shouldMarkCompleted: false,
    });
    const prisma = makePrismaStub({
      lowestScoreParameterName: null,
      moduleTitles: { [MOD_A]: "A", [MOD_B]: "B", [MOD_C]: "C" },
    });

    const result = await generateDiagnosticFromMock(prisma, {
      callId: CALL_ID,
      callerId: CALLER_ID,
      curriculumId: CURRICULUM_ID,
      coveredModuleIds: [MOD_A, MOD_B, MOD_C],
      playbookConfig: null,
    });

    expect(result).not.toBeNull();
    expect(result!.strengthModule).toBeNull();
    // focusModules still produced — deterministically ordered by moduleId
    // when masteries tie (stable sort by ID).
    expect(result!.focusModules.length).toBeGreaterThan(0);
    expect(result!.focusModules.length).toBeLessThanOrEqual(MAX_FOCUS_MODULES);
  });

  it("weakSkill = null when no CallScore rows exist for the call", async () => {
    mockComputeMastery.mockResolvedValue({
      mastery: 0.5,
      evidenceCount: 3,
      shouldMarkCompleted: false,
    });
    const prisma = makePrismaStub({
      lowestScoreParameterName: null, // simulates findFirst → null
      moduleTitles: { [MOD_A]: "A", [MOD_B]: "B" },
    });

    const result = await generateDiagnosticFromMock(prisma, {
      callId: CALL_ID,
      callerId: CALLER_ID,
      curriculumId: CURRICULUM_ID,
      coveredModuleIds: [MOD_A, MOD_B],
      playbookConfig: null,
    });

    expect(result).not.toBeNull();
    expect(result!.weakSkill).toBeNull();
  });

  it("summary string substitutes the module titles", async () => {
    mockComputeMastery.mockImplementation(
      async (_p: unknown, args: { moduleId: string }) => {
        const map: Record<string, number> = {
          [MOD_A]: 0.2,
          [MOD_B]: 0.5,
          [MOD_C]: 0.9,
        };
        return {
          mastery: map[args.moduleId] ?? 0,
          evidenceCount: 4,
          shouldMarkCompleted: false,
        };
      },
    );
    const prisma = makePrismaStub({
      lowestScoreParameterName: "pronunciation",
      moduleTitles: {
        [MOD_A]: "Speaking Part 1",
        [MOD_B]: "Speaking Part 2",
        [MOD_C]: "Speaking Part 3",
      },
    });

    const result = await generateDiagnosticFromMock(prisma, {
      callId: CALL_ID,
      callerId: CALLER_ID,
      curriculumId: CURRICULUM_ID,
      coveredModuleIds: [MOD_A, MOD_B, MOD_C],
      playbookConfig: null,
    });

    expect(result).not.toBeNull();
    expect(result!.summary).toContain("Speaking Part 3"); // strength
    expect(result!.summary).toContain("Speaking Part 1"); // focus
    expect(result!.summary).toContain("Speaking Part 2"); // focus
  });

  it("generatedAt is a valid ISO timestamp within ±1s of Date.now()", async () => {
    mockComputeMastery.mockResolvedValue({
      mastery: 0.5,
      evidenceCount: 3,
      shouldMarkCompleted: false,
    });
    const prisma = makePrismaStub({
      lowestScoreParameterName: "fluency",
      moduleTitles: { [MOD_A]: "A", [MOD_B]: "B" },
    });

    const before = Date.now();
    const result = await generateDiagnosticFromMock(prisma, {
      callId: CALL_ID,
      callerId: CALLER_ID,
      curriculumId: CURRICULUM_ID,
      coveredModuleIds: [MOD_A, MOD_B],
      playbookConfig: null,
    });
    const after = Date.now();

    expect(result).not.toBeNull();
    const parsed = Date.parse(result!.generatedAt);
    expect(Number.isFinite(parsed)).toBe(true);
    expect(parsed).toBeGreaterThanOrEqual(before - 1000);
    expect(parsed).toBeLessThanOrEqual(after + 1000);
    // ISO format sanity (contains 'T' + 'Z' or offset)
    expect(result!.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("caps focusModules at MAX_FOCUS_MODULES even with many covered", async () => {
    // 5 covered modules with strictly increasing mastery — focus should be
    // exactly the first 3 (weakest), strength is the highest.
    const MOD_D = "mod-d";
    const MOD_E = "mod-e";
    const masteries: Record<string, number> = {
      [MOD_A]: 0.1,
      [MOD_B]: 0.2,
      [MOD_C]: 0.4,
      [MOD_D]: 0.7,
      [MOD_E]: 0.9,
    };
    mockComputeMastery.mockImplementation(
      async (_p: unknown, args: { moduleId: string }) => ({
        mastery: masteries[args.moduleId] ?? 0,
        evidenceCount: 4,
        shouldMarkCompleted: false,
      }),
    );
    const prisma = makePrismaStub({
      lowestScoreParameterName: "fluency",
      moduleTitles: {},
    });

    const result = await generateDiagnosticFromMock(prisma, {
      callId: CALL_ID,
      callerId: CALLER_ID,
      curriculumId: CURRICULUM_ID,
      coveredModuleIds: [MOD_A, MOD_B, MOD_C, MOD_D, MOD_E],
      playbookConfig: null,
    });

    expect(result).not.toBeNull();
    expect(result!.focusModules).toHaveLength(MAX_FOCUS_MODULES);
    expect(result!.focusModules).toEqual([MOD_A, MOD_B, MOD_C]);
    expect(result!.strengthModule).toBe(MOD_E);
  });

  it("propagates playbookConfig EMA tuning to computeModuleMastery", async () => {
    mockComputeMastery.mockResolvedValue({
      mastery: 0.5,
      evidenceCount: 3,
      shouldMarkCompleted: false,
    });
    const prisma = makePrismaStub({
      lowestScoreParameterName: "fluency",
      moduleTitles: { [MOD_A]: "A", [MOD_B]: "B" },
    });

    await generateDiagnosticFromMock(prisma, {
      callId: CALL_ID,
      callerId: CALLER_ID,
      curriculumId: CURRICULUM_ID,
      coveredModuleIds: [MOD_A, MOD_B],
      playbookConfig: {
        skillScoringEmaHalfLifeDays: 21,
        skillMinCallsToFull: 6,
      } as any,
    });

    expect(mockComputeMastery).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        emaHalfLifeDays: 21,
        minCallsToFull: 6,
      }),
    );
  });
});
