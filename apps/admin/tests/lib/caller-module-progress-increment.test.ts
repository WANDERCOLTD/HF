/**
 * Tests for incrementModuleEvidence — #491 Slice 1.3
 *
 * Exported from app/api/calls/[callId]/pipeline/route.ts. Runs at the end
 * of the AGGREGATE stage and bumps CallerModuleProgress.callCount for the
 * module that this call was attributed to (`Call.curriculumModuleId`).
 *
 * Coverage:
 *  - First call: creates a row with callCount=1, status=IN_PROGRESS.
 *  - Idempotent re-run (same callId): no increment, returns existing count.
 *  - Second call (different callId): bumps callCount to 2, updates lastCallId.
 *  - COMPLETED module: increments callCount but leaves status COMPLETED.
 *  - NOT_STARTED row: promotes to IN_PROGRESS on first increment.
 *  - Null moduleId: no-op (no row created).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// =====================================================
// MOCKS
// =====================================================

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    callerModuleProgress: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    // Unused by incrementModuleEvidence but referenced at module load
    // time by sibling helpers in route.ts. Provide bare stubs so the
    // module under test can be imported without ESM errors.
    analysisSpec: { findFirst: vi.fn() },
    call: { findUnique: vi.fn() },
    callScore: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    callerMemory: { create: vi.fn() },
    callerPersonality: { upsert: vi.fn() },
    personalityObservation: { create: vi.fn() },
    parameter: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
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

const CALLER_ID = "caller-1";
const MODULE_ID = "mod-1";
const CALL_ID_A = "call-A";
const CALL_ID_B = "call-B";

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

// =====================================================
// TESTS
// =====================================================

describe("incrementModuleEvidence (#491 Slice 1.3)", () => {
  let incrementModuleEvidence: typeof import("@/app/api/calls/[callId]/pipeline/route").incrementModuleEvidence;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/calls/[callId]/pipeline/route");
    incrementModuleEvidence = mod.incrementModuleEvidence;
  });

  it("creates a new row with callCount=1 when no progress exists", async () => {
    mockPrisma.callerModuleProgress.findUnique.mockResolvedValue(null);
    mockPrisma.callerModuleProgress.create.mockResolvedValue({ callCount: 1 });

    const log = makeLogger();
    const result = await incrementModuleEvidence(CALL_ID_A, CALLER_ID, MODULE_ID, log as any);

    expect(result).toEqual({ callCount: 1, created: true, skipped: false });
    expect(mockPrisma.callerModuleProgress.findUnique).toHaveBeenCalledWith({
      where: { callerId_moduleId: { callerId: CALLER_ID, moduleId: MODULE_ID } },
      select: { id: true, callCount: true, lastCallId: true, status: true },
    });
    expect(mockPrisma.callerModuleProgress.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        callerId: CALLER_ID,
        moduleId: MODULE_ID,
        callCount: 1,
        status: "IN_PROGRESS",
        lastCallId: CALL_ID_A,
        startedAt: expect.any(Date),
      }),
      select: { callCount: true },
    });
    expect(mockPrisma.callerModuleProgress.update).not.toHaveBeenCalled();
  });

  it("is idempotent when the same call re-runs the pipeline", async () => {
    mockPrisma.callerModuleProgress.findUnique.mockResolvedValue({
      id: "prog-1",
      callCount: 1,
      lastCallId: CALL_ID_A, // same call already counted
      status: "IN_PROGRESS",
    });

    const log = makeLogger();
    const result = await incrementModuleEvidence(CALL_ID_A, CALLER_ID, MODULE_ID, log as any);

    expect(result).toEqual({ callCount: 1, created: false, skipped: true });
    expect(mockPrisma.callerModuleProgress.create).not.toHaveBeenCalled();
    expect(mockPrisma.callerModuleProgress.update).not.toHaveBeenCalled();
  });

  it("increments to 2 when a different call touches the same module", async () => {
    mockPrisma.callerModuleProgress.findUnique.mockResolvedValue({
      id: "prog-1",
      callCount: 1,
      lastCallId: CALL_ID_A,
      status: "IN_PROGRESS",
    });
    mockPrisma.callerModuleProgress.update.mockResolvedValue({ callCount: 2 });

    const log = makeLogger();
    const result = await incrementModuleEvidence(CALL_ID_B, CALLER_ID, MODULE_ID, log as any);

    expect(result).toEqual({ callCount: 2, created: false, skipped: false });
    expect(mockPrisma.callerModuleProgress.update).toHaveBeenCalledWith({
      where: { id: "prog-1" },
      data: expect.objectContaining({
        callCount: { increment: 1 },
        lastCallId: CALL_ID_B,
        status: "IN_PROGRESS",
      }),
      select: { callCount: true },
    });
  });

  it("preserves COMPLETED status while still incrementing the evidence count", async () => {
    mockPrisma.callerModuleProgress.findUnique.mockResolvedValue({
      id: "prog-1",
      callCount: 5,
      lastCallId: "earlier-call",
      status: "COMPLETED",
    });
    mockPrisma.callerModuleProgress.update.mockResolvedValue({ callCount: 6 });

    const log = makeLogger();
    const result = await incrementModuleEvidence(CALL_ID_B, CALLER_ID, MODULE_ID, log as any);

    expect(result).toEqual({ callCount: 6, created: false, skipped: false });
    const updateArg = mockPrisma.callerModuleProgress.update.mock.calls[0][0];
    expect(updateArg.data.status).toBe("COMPLETED");
    expect(updateArg.data.callCount).toEqual({ increment: 1 });
    expect(updateArg.data.lastCallId).toBe(CALL_ID_B);
  });

  it("promotes NOT_STARTED rows to IN_PROGRESS on first increment", async () => {
    mockPrisma.callerModuleProgress.findUnique.mockResolvedValue({
      id: "prog-1",
      callCount: 0,
      lastCallId: null,
      status: "NOT_STARTED",
    });
    mockPrisma.callerModuleProgress.update.mockResolvedValue({ callCount: 1 });

    const log = makeLogger();
    const result = await incrementModuleEvidence(CALL_ID_A, CALLER_ID, MODULE_ID, log as any);

    expect(result.callCount).toBe(1);
    const updateArg = mockPrisma.callerModuleProgress.update.mock.calls[0][0];
    expect(updateArg.data.status).toBe("IN_PROGRESS");
    expect(updateArg.data.startedAt).toBeInstanceOf(Date);
  });

  it("is a no-op when moduleId is null (no attribution)", async () => {
    const log = makeLogger();
    const result = await incrementModuleEvidence(CALL_ID_A, CALLER_ID, null, log as any);

    expect(result).toEqual({ callCount: -1, created: false, skipped: true });
    expect(mockPrisma.callerModuleProgress.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.callerModuleProgress.create).not.toHaveBeenCalled();
    expect(mockPrisma.callerModuleProgress.update).not.toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalledWith(
      expect.stringContaining("no moduleId attribution"),
      expect.objectContaining({ callId: CALL_ID_A, callerId: CALLER_ID })
    );
  });
});
