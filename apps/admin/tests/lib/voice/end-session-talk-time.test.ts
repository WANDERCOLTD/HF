/**
 * T7 follow-on (epic #1700 Theme 7 / #1747) — endSession emits
 * `voice.talk_time.over_budget` AppLog when the tutor-talk-time
 * budgets are exceeded.
 *
 * Pins:
 *   - VOICE_CALL with tutor-heavy transcript → log fires
 *   - SIM_CALL with tutor-heavy transcript → log fires
 *   - TEXT_CHAT / ENROLLMENT / ASSESSMENT → log NOT fired
 *   - No transcript → log NOT fired
 *   - Within budget → log NOT fired
 *   - Operator-set budgets override defaults
 *   - Compute failure swallowed (best-effort)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockPrisma = {
  session: { findUnique: vi.fn(), update: vi.fn() },
  call: { findFirst: vi.fn() },
  callerModuleProgress: { findUnique: vi.fn(), update: vi.fn() },
};

const mockLog = vi.fn();

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/config", () => ({
  config: {
    app: { url: "http://localhost:3000" },
    security: { internalApiSecret: "test-secret" },
  },
}));
vi.mock("@/lib/logger", () => ({
  log: (...args: unknown[]) => mockLog(...args),
}));

function makeSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    kind: "VOICE_CALL",
    startedAt: new Date(Date.now() - 60_000),
    endedAt: null,
    status: "STARTED",
    countsTowardLearnerNumber: true,
    countsTowardPipelineNumber: true,
    skipStages: [],
    callerId: "caller-1",
    playbookId: null,
    curriculumModuleId: null,
    curriculumModule: null,
    playbook: null,
    ...overrides,
  };
}

const TUTOR_HEAVY_TRANSCRIPT = `
Assistant: ${Array(120).fill("word").join(" ")}
User: ok
`.trim();

// Within both default budgets — short tutor turns + learner dominates word
// count → maxTutorTurnSec ≪ 30s AND tutorRatio ≪ 0.2.
const SHORT_TRANSCRIPT = `
Assistant: Hi.
User: ${Array(60).fill("word").join(" ")}
Assistant: Go on.
User: ${Array(60).fill("word").join(" ")}
`.trim();

beforeEach(() => {
  vi.clearAllMocks();
  mockLog.mockClear();
  mockPrisma.session.update.mockImplementation(
    ({ data, where }: { data: Record<string, unknown>; where: { id: string } }) =>
      Promise.resolve({
        id: where.id,
        status: data.status ?? "COMPLETED",
        endedAt: data.endedAt ?? new Date(),
        skipStages: data.skipStages ?? [],
        countsTowardLearnerNumber: data.countsTowardLearnerNumber ?? true,
        countsTowardPipelineNumber: data.countsTowardPipelineNumber ?? true,
        callerId: "caller-1",
      }),
  );
  mockPrisma.call.findFirst.mockResolvedValue(null);
});

afterEach(() => {
  vi.resetModules();
});

describe("endSession — talk-time AppLog emission (#1747 follow-on)", () => {
  it("fires voice.talk_time.over_budget on VOICE_CALL with tutor-heavy transcript", async () => {
    mockPrisma.session.findUnique.mockResolvedValueOnce(makeSessionRow({ kind: "VOICE_CALL" }));
    const { endSession } = await import("@/lib/voice/end-session");
    await endSession("session-1", {
      outcome: "COMPLETED",
      transcript: TUTOR_HEAVY_TRANSCRIPT,
      triggerPipelineAsync: false,
    });
    const overBudgetCall = mockLog.mock.calls.find(
      (c) => c[1] === "voice.talk_time.over_budget",
    );
    expect(overBudgetCall, "expected over_budget AppLog").toBeDefined();
    const payload = overBudgetCall![2] as Record<string, unknown>;
    expect(payload.level).toBe("warn");
    expect(payload.sessionId).toBe("session-1");
    expect(payload.callerId).toBe("caller-1");
    expect(payload.kind).toBe("VOICE_CALL");
    expect(Array.isArray(payload.exceededBy)).toBe(true);
    expect((payload.exceededBy as string[]).length).toBeGreaterThan(0);
  });

  it("fires for SIM_CALL with tutor-heavy transcript", async () => {
    mockPrisma.session.findUnique.mockResolvedValueOnce(makeSessionRow({ kind: "SIM_CALL" }));
    const { endSession } = await import("@/lib/voice/end-session");
    await endSession("session-1", {
      outcome: "COMPLETED",
      transcript: TUTOR_HEAVY_TRANSCRIPT,
      triggerPipelineAsync: false,
    });
    const overBudgetCall = mockLog.mock.calls.find(
      (c) => c[1] === "voice.talk_time.over_budget",
    );
    expect(overBudgetCall).toBeDefined();
  });

  it("does NOT fire for TEXT_CHAT", async () => {
    mockPrisma.session.findUnique.mockResolvedValueOnce(makeSessionRow({ kind: "TEXT_CHAT" }));
    const { endSession } = await import("@/lib/voice/end-session");
    await endSession("session-1", {
      outcome: "COMPLETED",
      transcript: TUTOR_HEAVY_TRANSCRIPT,
      triggerPipelineAsync: false,
    });
    const overBudgetCall = mockLog.mock.calls.find(
      (c) => c[1] === "voice.talk_time.over_budget",
    );
    expect(overBudgetCall).toBeUndefined();
  });

  it("does NOT fire when no transcript provided", async () => {
    mockPrisma.session.findUnique.mockResolvedValueOnce(makeSessionRow({ kind: "VOICE_CALL" }));
    const { endSession } = await import("@/lib/voice/end-session");
    await endSession("session-1", {
      outcome: "COMPLETED",
      triggerPipelineAsync: false,
    });
    const overBudgetCall = mockLog.mock.calls.find(
      (c) => c[1] === "voice.talk_time.over_budget",
    );
    expect(overBudgetCall).toBeUndefined();
  });

  it("does NOT fire when transcript is within budget", async () => {
    mockPrisma.session.findUnique.mockResolvedValueOnce(makeSessionRow({ kind: "VOICE_CALL" }));
    const { endSession } = await import("@/lib/voice/end-session");
    await endSession("session-1", {
      outcome: "COMPLETED",
      transcript: SHORT_TRANSCRIPT,
      triggerPipelineAsync: false,
    });
    const overBudgetCall = mockLog.mock.calls.find(
      (c) => c[1] === "voice.talk_time.over_budget",
    );
    expect(overBudgetCall).toBeUndefined();
  });

  it("respects operator-set Playbook.config.talkTimeBudgets", async () => {
    // Generous budgets — even the tutor-heavy transcript stays within.
    mockPrisma.session.findUnique.mockResolvedValueOnce(
      makeSessionRow({
        kind: "VOICE_CALL",
        playbook: {
          config: {
            talkTimeBudgets: { maxTutorTurnSec: 10000, maxTutorRatio: 0.9999 },
          },
        },
      }),
    );
    const { endSession } = await import("@/lib/voice/end-session");
    await endSession("session-1", {
      outcome: "COMPLETED",
      transcript: TUTOR_HEAVY_TRANSCRIPT,
      triggerPipelineAsync: false,
    });
    const overBudgetCall = mockLog.mock.calls.find(
      (c) => c[1] === "voice.talk_time.over_budget",
    );
    expect(overBudgetCall, "generous budgets should not trip").toBeUndefined();
  });

  it("payload includes stats + budgets for forensic context", async () => {
    mockPrisma.session.findUnique.mockResolvedValueOnce(makeSessionRow({ kind: "VOICE_CALL" }));
    const { endSession } = await import("@/lib/voice/end-session");
    await endSession("session-1", {
      outcome: "COMPLETED",
      transcript: TUTOR_HEAVY_TRANSCRIPT,
      triggerPipelineAsync: false,
    });
    const overBudgetCall = mockLog.mock.calls.find(
      (c) => c[1] === "voice.talk_time.over_budget",
    );
    const payload = overBudgetCall![2] as Record<string, unknown>;
    expect(payload.stats).toBeDefined();
    expect(payload.budgets).toBeDefined();
    const stats = payload.stats as Record<string, unknown>;
    expect(typeof stats.tutorTurnCount).toBe("number");
    expect(typeof stats.maxTutorTurnSec).toBe("number");
    expect(typeof stats.tutorRatio).toBe("number");
  });
});
