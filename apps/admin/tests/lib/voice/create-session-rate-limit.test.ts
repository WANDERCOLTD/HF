/**
 * #2056 (sub-epic G of #2049) — createSession rate-limit unit tests.
 *
 * Covers the runtime gates added to `createSession` for the 3 contracts
 * `callCountPolicy` / `maxCallsPerDay` / agent-tuner-NLP (latter tested
 * separately at the component layer).
 *
 * Pins:
 *   - hard_cap + cap reached → throws `CallRateLimitError`, no Session
 *     row created (counter NOT advanced), AppLog row emitted with
 *     subject `call.rate_limit.over_cap`.
 *   - hard_cap + under cap → session created normally, no log.
 *   - soft_cap + cap reached → session created, AppLog row emitted with
 *     subject `call.rate_limit.soft_cap_hit`.
 *   - unlimited policy + cap configured → cap ignored, session created.
 *   - rate-limit skipped for ENROLLMENT / ASSESSMENT kinds (operator /
 *     pre-playbook contexts).
 *   - no per-day Session.count query when policy=unlimited (perf — the
 *     short-circuit avoids unnecessary DB round-trips).
 *
 * Lattice survey notes:
 *   - Sibling writer survey: `lib/voice/create-session.ts` is the only
 *     `prisma.session.create` chokepoint (ESLint `hf-call/no-bare-call-create`
 *     enforces). Adding rate-limit logic INSIDE the chokepoint keeps the
 *     gate single-source.
 *   - Default-deny: rate-limit short-circuits to no-op for ENROLLMENT /
 *     ASSESSMENT kinds — they don't burn the learner's daily budget.
 *   - Cascade respect: `callCountPolicy` + `maxCallsPerDay` live on
 *     `Playbook.config` and are read via the pure helpers in
 *     `lib/journey/runtime-gates.ts`.
 *   - Convention conflict: `Session.startedAt` is the established
 *     timestamp for the per-day count (matches existing
 *     `@@index([callerId, startedAt])`).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  caller: { findUnique: vi.fn() },
  playbook: { findUnique: vi.fn() },
  session: {
    count: vi.fn(),
    create: vi.fn(),
  },
  callerSequenceCounter: { upsert: vi.fn() },
  appLog: { create: vi.fn() },
  $transaction: vi.fn(),
};

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

// Stub the resolver chain — none of these are under test here.
vi.mock("@/lib/caller/resolve-active-playbook", () => ({
  resolveActivePlaybookId: vi.fn(async () => "playbook-rate-limit"),
}));
vi.mock("@/lib/curriculum/resolve-module", () => ({
  resolveCurriculumIdForPlaybook: vi.fn(async () => null),
  resolveModuleByLogicalId: vi.fn(async () => null),
}));
vi.mock("@/lib/curriculum/resolve-default-module", () => ({
  resolveDefaultModuleForCaller: vi.fn(async () => null),
}));
vi.mock("@/lib/voice/load-voice-config", () => ({
  loadResolvedVoiceConfig: vi.fn(async () => ({ provider: "test" })),
}));
vi.mock("@/lib/voice/resolve-used-prompt", () => ({
  resolveUsedPromptId: vi.fn(async () => ({ usedPromptId: null })),
}));
vi.mock("@/lib/journey/module-settings-flag", () => ({
  isIeltsModuleSettingsEnabled: vi.fn(() => false),
}));
vi.mock("@/lib/voice/select-pinned-card", () => ({
  selectPinnedCardForModule: vi.fn(() => null),
}));
vi.mock("@/lib/voice/session-rules", () => ({
  initialCounterFlags: vi.fn(() => ({
    countsTowardLearnerNumber: true,
    countsTowardPipelineNumber: true,
  })),
  deriveSkipStages: vi.fn(() => []),
}));
// Capture `log()` calls so we can assert AppLog subjects.
const loggerCalls: Array<{
  type: string;
  stage: string;
  data?: Record<string, unknown>;
}> = [];
vi.mock("@/lib/logger", () => ({
  log: (type: string, stage: string, data?: Record<string, unknown>) => {
    loggerCalls.push({ type, stage, data });
  },
}));

function setPlaybookConfig(config: Record<string, unknown> | null): void {
  mockPrisma.playbook.findUnique.mockResolvedValue({ config });
}

function setUsedToday(n: number): void {
  mockPrisma.session.count.mockResolvedValue(n);
}

function bindTransactionPassthrough(): void {
  // The transaction callback writes via tx — proxy tx → mockPrisma so
  // the test sees session.create / counter.upsert calls.
  mockPrisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mockPrisma) => Promise<unknown>) =>
      callback(mockPrisma),
  );
  mockPrisma.callerSequenceCounter.upsert.mockResolvedValue({ nextSeq: 2 });
  mockPrisma.session.create.mockResolvedValue({
    id: "session-new",
    sequenceNumber: 1,
    learnerFacingNumber: 1,
    kind: "VOICE_CALL",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  loggerCalls.length = 0;
  mockPrisma.caller.findUnique.mockResolvedValue({ lastSelectedModuleId: null });
  bindTransactionPassthrough();
});

describe("createSession — rate limit (hard_cap)", () => {
  it("throws CallRateLimitError when usedToday >= maxCallsPerDay", async () => {
    setPlaybookConfig({ callCountPolicy: "hard_cap", maxCallsPerDay: 3 });
    setUsedToday(3);
    const { createSession } = await import("@/lib/voice/create-session");
    const { CallRateLimitError } = await import(
      "@/lib/journey/runtime-gates"
    );
    await expect(
      createSession({ callerId: "caller-1", kind: "VOICE_CALL" }),
    ).rejects.toBeInstanceOf(CallRateLimitError);

    // Counter NOT advanced, no session row created.
    expect(mockPrisma.session.create).not.toHaveBeenCalled();
    expect(mockPrisma.callerSequenceCounter.upsert).not.toHaveBeenCalled();
  });

  it("emits AppLog subject call.rate_limit.over_cap on block", async () => {
    setPlaybookConfig({ callCountPolicy: "hard_cap", maxCallsPerDay: 2 });
    setUsedToday(5);
    const { createSession } = await import("@/lib/voice/create-session");
    await expect(
      createSession({ callerId: "caller-1", kind: "VOICE_CALL" }),
    ).rejects.toThrow();

    const overCap = loggerCalls.find(
      (c) => c.stage === "call.rate_limit.over_cap",
    );
    expect(overCap).toBeDefined();
    expect(overCap!.data).toMatchObject({
      cap: 2,
      usedToday: 5,
      policy: "hard_cap",
      kind: "VOICE_CALL",
    });
  });

  it("allows when usedToday is below cap (no log)", async () => {
    setPlaybookConfig({ callCountPolicy: "hard_cap", maxCallsPerDay: 5 });
    setUsedToday(2);
    const { createSession } = await import("@/lib/voice/create-session");
    const result = await createSession({
      callerId: "caller-1",
      kind: "VOICE_CALL",
    });
    expect(result.session.id).toBe("session-new");
    expect(loggerCalls.find((c) => c.stage.startsWith("call.rate_limit"))).toBeUndefined();
  });
});

describe("createSession — rate limit (soft_cap)", () => {
  it("allows the session but logs soft_cap_hit when cap reached", async () => {
    setPlaybookConfig({ callCountPolicy: "soft_cap", maxCallsPerDay: 3 });
    setUsedToday(3);
    const { createSession } = await import("@/lib/voice/create-session");
    const result = await createSession({
      callerId: "caller-1",
      kind: "VOICE_CALL",
    });
    expect(result.session.id).toBe("session-new");

    const softCap = loggerCalls.find(
      (c) => c.stage === "call.rate_limit.soft_cap_hit",
    );
    expect(softCap).toBeDefined();
    expect(softCap!.data).toMatchObject({
      cap: 3,
      usedToday: 3,
      policy: "soft_cap",
    });
  });

  it("does NOT log when usedToday is under cap", async () => {
    setPlaybookConfig({ callCountPolicy: "soft_cap", maxCallsPerDay: 3 });
    setUsedToday(2);
    const { createSession } = await import("@/lib/voice/create-session");
    await createSession({ callerId: "caller-1", kind: "VOICE_CALL" });
    expect(loggerCalls.find((c) => c.stage.startsWith("call.rate_limit"))).toBeUndefined();
  });
});

describe("createSession — rate limit (unlimited)", () => {
  it("ignores maxCallsPerDay when policy is unlimited", async () => {
    setPlaybookConfig({ callCountPolicy: "unlimited", maxCallsPerDay: 1 });
    setUsedToday(50);
    const { createSession } = await import("@/lib/voice/create-session");
    const result = await createSession({
      callerId: "caller-1",
      kind: "VOICE_CALL",
    });
    expect(result.session.id).toBe("session-new");
    // session.count should NOT have been called — perf short-circuit.
    expect(mockPrisma.session.count).not.toHaveBeenCalled();
  });

  it("treats absent policy as unlimited (default behaviour)", async () => {
    setPlaybookConfig({}); // no policy, no cap
    setUsedToday(0);
    const { createSession } = await import("@/lib/voice/create-session");
    await createSession({ callerId: "caller-1", kind: "VOICE_CALL" });
    expect(mockPrisma.session.count).not.toHaveBeenCalled();
  });
});

describe("createSession — rate limit skipped for non-rate-limited kinds", () => {
  it("does NOT consult cap for ENROLLMENT sessions", async () => {
    setPlaybookConfig({ callCountPolicy: "hard_cap", maxCallsPerDay: 1 });
    setUsedToday(100);
    const { createSession } = await import("@/lib/voice/create-session");
    const result = await createSession({
      callerId: "caller-1",
      kind: "ENROLLMENT",
    });
    expect(result.session.id).toBe("session-new");
    expect(mockPrisma.session.count).not.toHaveBeenCalled();
  });

  it("does NOT consult cap for ASSESSMENT sessions", async () => {
    setPlaybookConfig({ callCountPolicy: "hard_cap", maxCallsPerDay: 1 });
    setUsedToday(100);
    const { createSession } = await import("@/lib/voice/create-session");
    const result = await createSession({
      callerId: "caller-1",
      kind: "ASSESSMENT",
    });
    expect(result.session.id).toBe("session-new");
    expect(mockPrisma.session.count).not.toHaveBeenCalled();
  });
});

describe("createSession — rate limit when no Playbook is attributed", () => {
  it("skips cap evaluation when playbookId resolves to null", async () => {
    const resolveActive = await import("@/lib/caller/resolve-active-playbook");
    vi.mocked(resolveActive.resolveActivePlaybookId).mockResolvedValueOnce(null);
    const { createSession } = await import("@/lib/voice/create-session");
    const result = await createSession({
      callerId: "caller-1",
      kind: "VOICE_CALL",
    });
    expect(result.session.id).toBe("session-new");
    expect(mockPrisma.playbook.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.session.count).not.toHaveBeenCalled();
  });
});
