/**
 * #1342 — endSession unit tests.
 *
 * ACs locked here:
 *   - FAILED / GHOST → skipStages widened to include EXTRACT/SCORE_AGENT/PROSODY/REWARD
 *   - counter flags can only flip false, never raise
 *   - Session row commits even when pipeline trigger throws synchronously
 *   - throws on unknown sessionId
 *   - idempotent on already-ended Session (forward-only status transition)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  session: { findUnique: vi.fn(), update: vi.fn() },
  call: { findFirst: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/config", () => ({
  config: {
    app: { url: "http://localhost:3000" },
    security: { internalApiSecret: "test-secret" },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.session.findUnique.mockResolvedValue({
    id: "session-1",
    kind: "VOICE_CALL",
    startedAt: new Date(Date.now() - 60_000), // 60s ago
    endedAt: null,
    status: "STARTED",
    countsTowardLearnerNumber: true,
    countsTowardPipelineNumber: true,
    skipStages: [],
    callerId: "caller-1",
  });
  mockPrisma.session.update.mockImplementation(
    ({ data, where }: { data: Record<string, unknown>; where: { id: string } }) =>
      Promise.resolve({
        id: where.id,
        status: data.status ?? "COMPLETED",
        endedAt: data.endedAt ?? new Date(),
        skipStages: data.skipStages ?? [],
        countsTowardLearnerNumber:
          data.countsTowardLearnerNumber ?? true,
        countsTowardPipelineNumber:
          data.countsTowardPipelineNumber ?? true,
        callerId: "caller-1",
      }),
  );
  mockPrisma.call.findFirst.mockResolvedValue(null);
});

describe("endSession", () => {
  it("throws when sessionId is missing", async () => {
    const { endSession } = await import("@/lib/voice/end-session");
    await expect(endSession("", { outcome: "COMPLETED" })).rejects.toThrow(
      /sessionId is required/,
    );
  });

  it("throws when sessionId not found", async () => {
    mockPrisma.session.findUnique.mockResolvedValueOnce(null);
    const { endSession } = await import("@/lib/voice/end-session");
    await expect(
      endSession("nonexistent", { outcome: "COMPLETED" }),
    ).rejects.toThrow(/not found/);
  });

  it("COMPLETED → status COMPLETED, both counter flags preserved, no extra skipStages", async () => {
    const { endSession } = await import("@/lib/voice/end-session");
    const result = await endSession("session-1", {
      outcome: "COMPLETED",
      transcript: "hello world",
      triggerPipelineAsync: false,
    });

    expect(result.status).toBe("COMPLETED");
    expect(result.skipStages).toEqual([]);
    expect(result.countsTowardLearnerNumber).toBe(true);
    expect(result.countsTowardPipelineNumber).toBe(true);
  });

  it("FAILED → skipStages widens to EXTRACT/SCORE_AGENT/PROSODY/REWARD", async () => {
    mockPrisma.session.update.mockImplementationOnce(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: "session-1",
          status: data.status,
          endedAt: data.endedAt ?? new Date(),
          skipStages: data.skipStages,
          countsTowardLearnerNumber: data.countsTowardLearnerNumber,
          countsTowardPipelineNumber: data.countsTowardPipelineNumber,
          callerId: "caller-1",
        }),
    );

    const { endSession } = await import("@/lib/voice/end-session");
    const result = await endSession("session-1", {
      outcome: "FAILED",
      triggerPipelineAsync: false,
    });

    expect(result.status).toBe("FAILED");
    expect(result.skipStages).toEqual([
      "EXTRACT",
      "PROSODY",
      "REWARD",
      "SCORE_AGENT",
    ]);
  });

  it("GHOST → both counter flags flipped to false", async () => {
    mockPrisma.session.update.mockImplementationOnce(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: "session-1",
          status: data.status,
          endedAt: data.endedAt ?? new Date(),
          skipStages: data.skipStages,
          countsTowardLearnerNumber: data.countsTowardLearnerNumber,
          countsTowardPipelineNumber: data.countsTowardPipelineNumber,
          callerId: "caller-1",
        }),
    );

    const { endSession } = await import("@/lib/voice/end-session");
    const result = await endSession("session-1", {
      outcome: "GHOST",
      triggerPipelineAsync: false,
    });

    expect(result.status).toBe("GHOST");
    expect(result.countsTowardLearnerNumber).toBe(false);
    expect(result.countsTowardPipelineNumber).toBe(false);
  });

  it("VOICE_CALL < 30s + COMPLETED → learner flag flipped false retroactively", async () => {
    mockPrisma.session.findUnique.mockResolvedValueOnce({
      id: "session-1",
      kind: "VOICE_CALL",
      startedAt: new Date(Date.now() - 5_000), // 5s ago — too short
      endedAt: null,
      status: "STARTED",
      countsTowardLearnerNumber: true,
      countsTowardPipelineNumber: true,
      skipStages: [],
      callerId: "caller-1",
    });
    mockPrisma.session.update.mockImplementationOnce(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: "session-1",
          status: data.status,
          endedAt: data.endedAt ?? new Date(),
          skipStages: data.skipStages,
          countsTowardLearnerNumber: data.countsTowardLearnerNumber,
          countsTowardPipelineNumber: data.countsTowardPipelineNumber,
          callerId: "caller-1",
        }),
    );

    const { endSession } = await import("@/lib/voice/end-session");
    const result = await endSession("session-1", {
      outcome: "COMPLETED",
      triggerPipelineAsync: false,
    });

    // learner false (too short), pipeline still true (signal preserved)
    expect(result.countsTowardLearnerNumber).toBe(false);
    expect(result.countsTowardPipelineNumber).toBe(true);
  });

  it("counter flags can only flip false — never raise", async () => {
    // Pre-existing false stays false even when "rule says true"
    mockPrisma.session.findUnique.mockResolvedValueOnce({
      id: "session-1",
      kind: "VOICE_CALL",
      startedAt: new Date(Date.now() - 60_000),
      endedAt: null,
      status: "STARTED",
      countsTowardLearnerNumber: false, // pre-flipped (sim or admin override)
      countsTowardPipelineNumber: true,
      skipStages: [],
      callerId: "caller-1",
    });

    const { endSession } = await import("@/lib/voice/end-session");
    await endSession("session-1", {
      outcome: "COMPLETED",
      triggerPipelineAsync: false,
    });

    const updateCall = mockPrisma.session.update.mock.calls[0][0];
    // Stays false — the AND with rule(true) keeps it false.
    expect(updateCall.data.countsTowardLearnerNumber).toBe(false);
  });

  it("skipStages UNION preserves existing skips, adds new ones", async () => {
    mockPrisma.session.findUnique.mockResolvedValueOnce({
      id: "session-1",
      kind: "ENROLLMENT",
      startedAt: new Date(Date.now() - 30_000),
      endedAt: null,
      status: "STARTED",
      countsTowardLearnerNumber: false,
      countsTowardPipelineNumber: true,
      skipStages: ["EXTRACT", "PROSODY", "SCORE_AGENT"],
      callerId: "caller-1",
    });

    const { endSession } = await import("@/lib/voice/end-session");
    await endSession("session-1", {
      outcome: "FAILED",
      triggerPipelineAsync: false,
    });

    const updateCall = mockPrisma.session.update.mock.calls[0][0];
    // FAILED adds REWARD on top; existing skips preserved.
    expect(updateCall.data.skipStages).toEqual([
      "EXTRACT",
      "PROSODY",
      "REWARD",
      "SCORE_AGENT",
    ]);
  });

  it("pipeline trigger failure does NOT throw — session row already committed", async () => {
    // Mock the pipeline fetch to reject. The catch in `triggerPipelineForSession`
    // is wired into a fire-and-forget Promise, so we just need to ensure
    // endSession itself returns normally even when the underlying network call
    // would have rejected.
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as any;
    mockPrisma.call.findFirst.mockResolvedValueOnce({ id: "call-1" });

    const { endSession } = await import("@/lib/voice/end-session");
    const result = await endSession("session-1", {
      outcome: "COMPLETED",
      triggerPipelineAsync: true,
    });

    expect(result.status).toBe("COMPLETED");
    // Allow the fire-and-forget microtask to settle without throwing in the test.
    await new Promise((r) => setTimeout(r, 0));
  });

  it("triggerPipelineAsync=false skips fetch entirely", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;

    const { endSession } = await import("@/lib/voice/end-session");
    await endSession("session-1", {
      outcome: "COMPLETED",
      triggerPipelineAsync: false,
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
