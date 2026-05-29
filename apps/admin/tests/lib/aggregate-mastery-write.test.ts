/**
 * Tests for `writeModuleMastery` — #494 E2 Slice 2.2.
 *
 * Exported from app/api/calls/[callId]/pipeline/route.ts. Called by the
 * AGGREGATE stage for each module credited with evidence on the current
 * call, recomputes mastery via `computeModuleMastery`, and updates
 * `CallerModuleProgress.mastery` / `status` / `completedAt`.
 *
 * Coverage:
 *  1. Idempotent re-run: mastery written once, second call no-ops when
 *     the recomputed value matches the existing row.
 *  2. Crossing the threshold flips status from IN_PROGRESS → COMPLETED
 *     with completedAt set.
 *  3. No CallerModuleProgress row → no mastery write attempted (caller
 *     never had a call attributed to this module).
 *  4. Already-COMPLETED row does not re-stamp `completedAt`.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// =====================================================
// MOCKS
// =====================================================

const { mockPrisma, mockComputeModuleMastery } = vi.hoisted(() => ({
  mockPrisma: {
    callerModuleProgress: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    callScore: { count: vi.fn(), findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    curriculumModule: { findUnique: vi.fn(), findMany: vi.fn() },
    playbook: { findUnique: vi.fn() },
    // Stubs referenced at route.ts module load time.
    analysisSpec: { findFirst: vi.fn() },
    call: { findUnique: vi.fn() },
    callerMemory: { create: vi.fn() },
    callerPersonality: { upsert: vi.fn() },
    personalityObservation: { create: vi.fn() },
    parameter: { findMany: vi.fn() },
  },
  mockComputeModuleMastery: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("@/lib/curriculum/compute-mastery", () => ({
  computeModuleMastery: mockComputeModuleMastery,
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

const CALLER_ID = "caller-1";
const MODULE_ID = "mod-1";

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

describe("writeModuleMastery (#494 E2 Slice 2.2)", () => {
  let writeModuleMastery: typeof import("@/app/api/calls/[callId]/pipeline/route").writeModuleMastery;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/calls/[callId]/pipeline/route");
    writeModuleMastery = mod.writeModuleMastery;
  });

  it("skips when no CallerModuleProgress row exists", async () => {
    mockPrisma.callerModuleProgress.findUnique.mockResolvedValue(null);

    const log = makeLogger();
    const result = await writeModuleMastery(CALLER_ID, MODULE_ID, {}, log as any);

    expect(result).toEqual({
      mastery: 0,
      evidenceCount: 0,
      statusFlipped: false,
      skipped: true,
    });
    expect(mockComputeModuleMastery).not.toHaveBeenCalled();
    expect(mockPrisma.callerModuleProgress.update).not.toHaveBeenCalled();
  });

  it("writes mastery and flips IN_PROGRESS → COMPLETED when threshold crossed", async () => {
    mockPrisma.callerModuleProgress.findUnique.mockResolvedValue({
      id: "prog-1",
      mastery: 0.5,
      status: "IN_PROGRESS",
      completedAt: null,
    });
    mockComputeModuleMastery.mockResolvedValue({
      mastery: 0.85,
      evidenceCount: 4,
      shouldMarkCompleted: true,
    });
    mockPrisma.callerModuleProgress.update.mockResolvedValue({});

    const log = makeLogger();
    const result = await writeModuleMastery(
      CALLER_ID,
      MODULE_ID,
      { masteryThreshold: 0.7, emaHalfLifeDays: 14, minCallsToFull: 4 },
      log as any,
    );

    expect(result.mastery).toBe(0.85);
    expect(result.evidenceCount).toBe(4);
    expect(result.statusFlipped).toBe(true);
    expect(result.skipped).toBe(false);

    expect(mockComputeModuleMastery).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({
        callerId: CALLER_ID,
        moduleId: MODULE_ID,
        masteryThreshold: 0.7,
        emaHalfLifeDays: 14,
        minCallsToFull: 4,
      }),
    );
    const updateArg = mockPrisma.callerModuleProgress.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: "prog-1" });
    expect(updateArg.data.mastery).toBe(0.85);
    expect(updateArg.data.status).toBe("COMPLETED");
    expect(updateArg.data.completedAt).toBeInstanceOf(Date);
  });

  it("is idempotent when mastery and status are unchanged", async () => {
    // Re-running AGGREGATE on the same call → CallScore rows haven't moved,
    // so the EMA recomputes the same value. No DB write should be issued.
    mockPrisma.callerModuleProgress.findUnique.mockResolvedValue({
      id: "prog-1",
      mastery: 0.62,
      status: "IN_PROGRESS",
      completedAt: null,
    });
    mockComputeModuleMastery.mockResolvedValue({
      mastery: 0.62,
      evidenceCount: 3,
      shouldMarkCompleted: false,
    });

    const log = makeLogger();
    const result = await writeModuleMastery(CALLER_ID, MODULE_ID, {}, log as any);

    expect(result).toEqual({
      mastery: 0.62,
      evidenceCount: 3,
      statusFlipped: false,
      skipped: true,
    });
    expect(mockPrisma.callerModuleProgress.update).not.toHaveBeenCalled();
  });

  it("updates mastery without flipping status when threshold not met", async () => {
    mockPrisma.callerModuleProgress.findUnique.mockResolvedValue({
      id: "prog-1",
      mastery: 0.4,
      status: "IN_PROGRESS",
      completedAt: null,
    });
    mockComputeModuleMastery.mockResolvedValue({
      mastery: 0.55,
      evidenceCount: 3,
      shouldMarkCompleted: false,
    });
    mockPrisma.callerModuleProgress.update.mockResolvedValue({});

    const log = makeLogger();
    const result = await writeModuleMastery(CALLER_ID, MODULE_ID, {}, log as any);

    expect(result.statusFlipped).toBe(false);
    expect(result.skipped).toBe(false);
    const updateArg = mockPrisma.callerModuleProgress.update.mock.calls[0][0];
    expect(updateArg.data.mastery).toBe(0.55);
    expect(updateArg.data.status).toBeUndefined();
    expect(updateArg.data.completedAt).toBeUndefined();
  });

  it("does not re-stamp completedAt when status is already COMPLETED", async () => {
    // Idempotency rule: once COMPLETED, downgrade is impossible and we
    // must not overwrite the original completedAt timestamp on every
    // subsequent call.
    mockPrisma.callerModuleProgress.findUnique.mockResolvedValue({
      id: "prog-1",
      mastery: 0.9,
      status: "COMPLETED",
      completedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mockComputeModuleMastery.mockResolvedValue({
      mastery: 0.92,
      evidenceCount: 5,
      shouldMarkCompleted: true,
    });
    mockPrisma.callerModuleProgress.update.mockResolvedValue({});

    const log = makeLogger();
    const result = await writeModuleMastery(CALLER_ID, MODULE_ID, {}, log as any);

    expect(result.mastery).toBe(0.92);
    // Mastery moved 0.9 → 0.92 so we DO write; but completedAt must NOT
    // be touched and status stays COMPLETED.
    expect(result.statusFlipped).toBe(false);
    expect(result.skipped).toBe(false);
    const updateArg = mockPrisma.callerModuleProgress.update.mock.calls[0][0];
    expect(updateArg.data.mastery).toBe(0.92);
    expect(updateArg.data.status).toBeUndefined();
    expect(updateArg.data.completedAt).toBeUndefined();
  });

  it("is fully idempotent when the row is already COMPLETED and mastery matches", async () => {
    mockPrisma.callerModuleProgress.findUnique.mockResolvedValue({
      id: "prog-1",
      mastery: 0.92,
      status: "COMPLETED",
      completedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mockComputeModuleMastery.mockResolvedValue({
      mastery: 0.92,
      evidenceCount: 5,
      shouldMarkCompleted: true,
    });

    const log = makeLogger();
    const result = await writeModuleMastery(CALLER_ID, MODULE_ID, {}, log as any);

    expect(result.skipped).toBe(true);
    expect(mockPrisma.callerModuleProgress.update).not.toHaveBeenCalled();
  });

  // ── #950: NOT_STARTED → IN_PROGRESS promotion ──────────────

  it("#950 — promotes NOT_STARTED → IN_PROGRESS when mastery rises above 0", async () => {
    // Reproduces the dirty state: row exists at NOT_STARTED with mastery=0
    // (legacy updateModuleMastery wrote it that way after all-zero LO
    // scores), then a re-aggregate produces non-zero EMA mastery.
    mockPrisma.callerModuleProgress.findUnique.mockResolvedValue({
      id: "prog-stuck",
      mastery: 0,
      status: "NOT_STARTED",
      completedAt: null,
    });
    mockComputeModuleMastery.mockResolvedValue({
      mastery: 0.62,
      evidenceCount: 2,
      shouldMarkCompleted: false,
    });
    mockPrisma.callerModuleProgress.update.mockResolvedValue({});

    const log = makeLogger();
    const result = await writeModuleMastery(CALLER_ID, MODULE_ID, {}, log as any);

    expect(result.mastery).toBe(0.62);
    expect(result.skipped).toBe(false);
    const updateArg = mockPrisma.callerModuleProgress.update.mock.calls[0][0];
    expect(updateArg.data.mastery).toBe(0.62);
    expect(updateArg.data.status).toBe("IN_PROGRESS");
    expect(updateArg.data.startedAt).toBeInstanceOf(Date);
    // COMPLETED transition must NOT fire — non-zero but below threshold.
    expect(updateArg.data.completedAt).toBeUndefined();
  });

  it("#950 — repairs the stuck state even when EMA mastery is unchanged", async () => {
    // Pipeline force-re-runs after the row was already left in the dirty
    // NOT_STARTED+mastery>0 state. Mastery EMA recomputes to the same
    // value (no new CallScore rows). Without the targeted repair this
    // would short-circuit at the idempotency guard and the stuck row
    // would never recover. With #950 the repair path detects the dirty
    // state and writes the promotion through.
    mockPrisma.callerModuleProgress.findUnique.mockResolvedValue({
      id: "prog-stuck",
      mastery: 0.62,
      status: "NOT_STARTED",
      completedAt: null,
    });
    mockComputeModuleMastery.mockResolvedValue({
      mastery: 0.62,
      evidenceCount: 2,
      shouldMarkCompleted: false,
    });
    mockPrisma.callerModuleProgress.update.mockResolvedValue({});

    const log = makeLogger();
    const result = await writeModuleMastery(CALLER_ID, MODULE_ID, {}, log as any);

    expect(result.skipped).toBe(false);
    expect(mockPrisma.callerModuleProgress.update).toHaveBeenCalledTimes(1);
    const updateArg = mockPrisma.callerModuleProgress.update.mock.calls[0][0];
    expect(updateArg.data.status).toBe("IN_PROGRESS");
    expect(updateArg.data.startedAt).toBeInstanceOf(Date);
  });

  it("#950 — does NOT promote when mastery stays at 0 (status legitimately NOT_STARTED)", async () => {
    // A first-ever recompute on a brand-new caller before any scoring has
    // landed should not invent IN_PROGRESS out of thin air. The promotion
    // is gated on mastery > 0.
    mockPrisma.callerModuleProgress.findUnique.mockResolvedValue({
      id: "prog-new",
      mastery: 0,
      status: "NOT_STARTED",
      completedAt: null,
    });
    mockComputeModuleMastery.mockResolvedValue({
      mastery: 0,
      evidenceCount: 0,
      shouldMarkCompleted: false,
    });

    const log = makeLogger();
    const result = await writeModuleMastery(CALLER_ID, MODULE_ID, {}, log as any);

    expect(result.skipped).toBe(true);
    expect(mockPrisma.callerModuleProgress.update).not.toHaveBeenCalled();
  });

  it("#950 — preserves COMPLETED transition over the new NOT_STARTED repair", async () => {
    // Belt-and-braces: if shouldFlipToCompleted fires AND the row happens
    // to be NOT_STARTED (corrupted state recovered all the way to
    // COMPLETED in one go), the COMPLETED flip wins. status must be
    // COMPLETED, not IN_PROGRESS.
    mockPrisma.callerModuleProgress.findUnique.mockResolvedValue({
      id: "prog-jump",
      mastery: 0.3,
      status: "NOT_STARTED",
      completedAt: null,
    });
    mockComputeModuleMastery.mockResolvedValue({
      mastery: 0.95,
      evidenceCount: 5,
      shouldMarkCompleted: true,
    });
    mockPrisma.callerModuleProgress.update.mockResolvedValue({});

    const log = makeLogger();
    const result = await writeModuleMastery(CALLER_ID, MODULE_ID, {}, log as any);

    expect(result.statusFlipped).toBe(true);
    const updateArg = mockPrisma.callerModuleProgress.update.mock.calls[0][0];
    expect(updateArg.data.status).toBe("COMPLETED");
    expect(updateArg.data.completedAt).toBeInstanceOf(Date);
    // startedAt must NOT be set when going straight to COMPLETED.
    expect(updateArg.data.startedAt).toBeUndefined();
  });
});
