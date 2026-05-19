/**
 * Tests for `writeDiagnosticFromMock` — #494 E2 Slice 2.6 (AGGREGATE wiring).
 *
 * Exported from app/api/calls/[callId]/pipeline/route.ts. Called at the
 * end of the AGGREGATE stage when the just-finished call's bound module
 * declares `coversModules.length >= 2`. Persists a single CallerAttribute
 * row keyed by `(callerId, key=fromMock, scope=DIAGNOSTIC)`.
 *
 * Coverage:
 *  1. Mock call (coversModules = [a, b, c]) → CallerAttribute row upserted
 *     with valid serialized DiagnosticFromMock JSON.
 *  2. Non-mock call (coversModules empty) → no diagnostic row created.
 *  3. Diagnostic generation throws → pipeline still returns { written: false }
 *     and a warn is logged. The thrown error MUST NOT propagate.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// =====================================================
// MOCKS
// =====================================================

const { mockPrisma, mockGenerateDiagnosticFromMock } = vi.hoisted(() => ({
  mockPrisma: {
    curriculumModule: { findUnique: vi.fn(), findMany: vi.fn() },
    playbook: { findUnique: vi.fn() },
    callerAttribute: { upsert: vi.fn() },
    // Stubs referenced at route.ts module load time.
    callerModuleProgress: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    callScore: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    analysisSpec: { findFirst: vi.fn() },
    call: { findUnique: vi.fn() },
    callerMemory: { create: vi.fn() },
    callerPersonality: { upsert: vi.fn() },
    personalityObservation: { create: vi.fn() },
    parameter: { findMany: vi.fn() },
  },
  mockGenerateDiagnosticFromMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("@/lib/curriculum/diagnostic-from-mock", () => ({
  generateDiagnosticFromMock: mockGenerateDiagnosticFromMock,
}));

// Avoid pulling in real AI / metering / config registries.
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

const CALL_ID = "call-mock-1";
const CALLER_ID = "caller-1";
const PLAYBOOK_ID = "pb-ielts";
const CURRICULUM_ID = "curr-ielts";
const MOCK_MODULE_ID = "mod-mock";
const PART1_ID = "mod-part1";
const PART2_ID = "mod-part2";
const PART3_ID = "mod-part3";

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

function makeCall(overrides: Partial<{
  id: string;
  playbookId: string | null;
  curriculumModuleId: string | null;
}> = {}) {
  return {
    id: CALL_ID,
    playbookId: PLAYBOOK_ID,
    curriculumModuleId: MOCK_MODULE_ID,
    ...overrides,
  };
}

// =====================================================
// TESTS
// =====================================================

describe("writeDiagnosticFromMock (#494 E2 Slice 2.6)", () => {
  let writeDiagnosticFromMock: typeof import("@/app/api/calls/[callId]/pipeline/route").writeDiagnosticFromMock;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/calls/[callId]/pipeline/route");
    writeDiagnosticFromMock = mod.writeDiagnosticFromMock;
  });

  it("Mock call (coversModules=[a,b,c]) → CallerAttribute row upserted with serialized DiagnosticFromMock JSON", async () => {
    mockPrisma.curriculumModule.findUnique.mockResolvedValue({
      curriculumId: CURRICULUM_ID,
      coversModules: ["part1", "part2", "part3"],
    });
    mockPrisma.playbook.findUnique.mockResolvedValue({
      config: { skillScoringEmaHalfLifeDays: 14, skillMinCallsToFull: 4 },
    });
    const diagnostic = {
      focusModules: [PART1_ID, PART2_ID],
      strengthModule: PART3_ID,
      weakSkill: "fluency",
      summary: "On your Mock, your strongest area was Part 3. To improve, focus next on Part 1, Part 2.",
      fromCallId: CALL_ID,
      generatedAt: "2026-05-19T12:00:00.000Z",
    };
    mockGenerateDiagnosticFromMock.mockResolvedValue(diagnostic);
    mockPrisma.callerAttribute.upsert.mockResolvedValue({});

    const log = makeLogger();
    const result = await writeDiagnosticFromMock(
      CALL_ID,
      CALLER_ID,
      makeCall(),
      [MOCK_MODULE_ID, PART1_ID, PART2_ID, PART3_ID],
      log as any,
    );

    expect(result.written).toBe(true);

    expect(mockGenerateDiagnosticFromMock).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({
        callId: CALL_ID,
        callerId: CALLER_ID,
        curriculumId: CURRICULUM_ID,
        coveredModuleIds: [MOCK_MODULE_ID, PART1_ID, PART2_ID, PART3_ID],
      }),
    );

    expect(mockPrisma.callerAttribute.upsert).toHaveBeenCalledTimes(1);
    const upsertArg = mockPrisma.callerAttribute.upsert.mock.calls[0][0];
    expect(upsertArg.where).toEqual({
      callerId_key_scope: {
        callerId: CALLER_ID,
        key: "fromMock",
        scope: "DIAGNOSTIC",
      },
    });
    // stringValue parses back to a valid DiagnosticFromMock.
    const parsed = JSON.parse(upsertArg.create.stringValue);
    expect(parsed).toEqual(diagnostic);
    expect(upsertArg.create.scope).toBe("DIAGNOSTIC");
    expect(upsertArg.create.key).toBe("fromMock");
    expect(upsertArg.update.stringValue).toBe(upsertArg.create.stringValue);
  });

  it("non-mock call (coversModules empty) → no diagnostic row created", async () => {
    // Bound module exists but coversModules is empty → not a Mock.
    mockPrisma.curriculumModule.findUnique.mockResolvedValue({
      curriculumId: CURRICULUM_ID,
      coversModules: [],
    });

    const log = makeLogger();
    const result = await writeDiagnosticFromMock(
      CALL_ID,
      CALLER_ID,
      makeCall(),
      [MOCK_MODULE_ID], // single credit — bound module only
      log as any,
    );

    expect(result.written).toBe(false);
    expect(mockGenerateDiagnosticFromMock).not.toHaveBeenCalled();
    expect(mockPrisma.callerAttribute.upsert).not.toHaveBeenCalled();
  });

  it("returns { written: false } when moduleEvidenceTargets.length < 2 (early bail)", async () => {
    const log = makeLogger();
    const result = await writeDiagnosticFromMock(
      CALL_ID,
      CALLER_ID,
      makeCall(),
      [MOCK_MODULE_ID],
      log as any,
    );

    expect(result.written).toBe(false);
    // No DB lookups at all — early return before any query.
    expect(mockPrisma.curriculumModule.findUnique).not.toHaveBeenCalled();
    expect(mockGenerateDiagnosticFromMock).not.toHaveBeenCalled();
  });

  it("returns { written: false } when call.curriculumModuleId is null", async () => {
    const log = makeLogger();
    const result = await writeDiagnosticFromMock(
      CALL_ID,
      CALLER_ID,
      makeCall({ curriculumModuleId: null }),
      [], // no targets either
      log as any,
    );

    expect(result.written).toBe(false);
    expect(mockPrisma.curriculumModule.findUnique).not.toHaveBeenCalled();
  });

  it("diagnostic generation throws → returns { written: false }, warn logged, error swallowed", async () => {
    // Critical contract: a thrown error from the generator MUST NOT
    // propagate out of writeDiagnosticFromMock. The pipeline must keep
    // going so mastery writes that have already happened are durable.
    mockPrisma.curriculumModule.findUnique.mockResolvedValue({
      curriculumId: CURRICULUM_ID,
      coversModules: ["part1", "part2", "part3"],
    });
    mockPrisma.playbook.findUnique.mockResolvedValue({ config: {} });
    mockGenerateDiagnosticFromMock.mockRejectedValue(
      new Error("compute-mastery exploded"),
    );

    const log = makeLogger();
    const result = await writeDiagnosticFromMock(
      CALL_ID,
      CALLER_ID,
      makeCall(),
      [MOCK_MODULE_ID, PART1_ID, PART2_ID, PART3_ID],
      log as any,
    );

    expect(result.written).toBe(false);
    expect(mockPrisma.callerAttribute.upsert).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("diagnosticFromMock generation failed"),
      expect.objectContaining({
        callId: CALL_ID,
        callerId: CALLER_ID,
        error: "compute-mastery exploded",
      }),
    );
  });

  it("CallerAttribute.upsert throws → returns { written: false }, warn logged", async () => {
    mockPrisma.curriculumModule.findUnique.mockResolvedValue({
      curriculumId: CURRICULUM_ID,
      coversModules: ["part1", "part2", "part3"],
    });
    mockPrisma.playbook.findUnique.mockResolvedValue({ config: {} });
    mockGenerateDiagnosticFromMock.mockResolvedValue({
      focusModules: [PART1_ID, PART2_ID],
      strengthModule: PART3_ID,
      weakSkill: "fluency",
      summary: "...",
      fromCallId: CALL_ID,
      generatedAt: "2026-05-19T12:00:00.000Z",
    });
    mockPrisma.callerAttribute.upsert.mockRejectedValue(
      new Error("unique violation"),
    );

    const log = makeLogger();
    const result = await writeDiagnosticFromMock(
      CALL_ID,
      CALLER_ID,
      makeCall(),
      [MOCK_MODULE_ID, PART1_ID, PART2_ID, PART3_ID],
      log as any,
    );

    expect(result.written).toBe(false);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("diagnosticFromMock generation failed"),
      expect.objectContaining({ error: "unique violation" }),
    );
  });

  it("playbookConfig pulled from Playbook.config and forwarded to generator", async () => {
    mockPrisma.curriculumModule.findUnique.mockResolvedValue({
      curriculumId: CURRICULUM_ID,
      coversModules: ["part1", "part2"],
    });
    mockPrisma.playbook.findUnique.mockResolvedValue({
      config: {
        skillScoringEmaHalfLifeDays: 28,
        skillMinCallsToFull: 8,
      },
    });
    mockGenerateDiagnosticFromMock.mockResolvedValue({
      focusModules: [PART1_ID],
      strengthModule: PART2_ID,
      weakSkill: "fluency",
      summary: "...",
      fromCallId: CALL_ID,
      generatedAt: "2026-05-19T12:00:00.000Z",
    });
    mockPrisma.callerAttribute.upsert.mockResolvedValue({});

    const log = makeLogger();
    await writeDiagnosticFromMock(
      CALL_ID,
      CALLER_ID,
      makeCall(),
      [MOCK_MODULE_ID, PART1_ID, PART2_ID],
      log as any,
    );

    const args = mockGenerateDiagnosticFromMock.mock.calls[0][1];
    expect(args.playbookConfig).toEqual({
      skillScoringEmaHalfLifeDays: 28,
      skillMinCallsToFull: 8,
    });
  });

  it("call.playbookId null → playbookConfig passed as null, no Playbook lookup", async () => {
    mockPrisma.curriculumModule.findUnique.mockResolvedValue({
      curriculumId: CURRICULUM_ID,
      coversModules: ["part1", "part2"],
    });
    mockGenerateDiagnosticFromMock.mockResolvedValue({
      focusModules: [PART1_ID],
      strengthModule: PART2_ID,
      weakSkill: null,
      summary: "...",
      fromCallId: CALL_ID,
      generatedAt: "2026-05-19T12:00:00.000Z",
    });
    mockPrisma.callerAttribute.upsert.mockResolvedValue({});

    const log = makeLogger();
    await writeDiagnosticFromMock(
      CALL_ID,
      CALLER_ID,
      makeCall({ playbookId: null }),
      [MOCK_MODULE_ID, PART1_ID, PART2_ID],
      log as any,
    );

    expect(mockPrisma.playbook.findUnique).not.toHaveBeenCalled();
    const args = mockGenerateDiagnosticFromMock.mock.calls[0][1];
    expect(args.playbookConfig).toBeNull();
  });
});
