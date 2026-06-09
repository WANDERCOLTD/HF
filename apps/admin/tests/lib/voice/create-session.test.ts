/**
 * #1342 — createSession unit tests.
 *
 * Locks the resolution cascade + the per-class counter rules. The
 * race-safe atomic counter assertion runs against a real Prisma in
 * `tests/integration/sessions/1342-builders.integration.test.ts`.
 *
 * ACs locked here (mapped 1:1 from issue body):
 *   - voiceConfigSnapshot only populated on VOICE_CALL / SIM_CALL
 *   - learnerFacingNumber gated by class flag (VOICE_CALL=yes, SIM_CALL=no)
 *   - requestedModuleId arg wins over lastSelectedModuleId
 *   - intentId persisted on ENROLLMENT sessions
 *   - skipStages derived correctly per kind
 *   - usedPromptId pulled from the cascade resolver
 *   - playbookId null tolerated (no throw on missing enrollment)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  caller: { findUnique: vi.fn() },
  $transaction: vi.fn(),
};

const mockTx = {
  callerSequenceCounter: { upsert: vi.fn() },
  session: { create: vi.fn() },
};

const mockResolveActivePlaybookId = vi.fn();
const mockResolveCurriculumIdForPlaybook = vi.fn();
const mockResolveModuleByLogicalId = vi.fn();
const mockResolveDefaultModuleForCaller = vi.fn();
const mockLoadResolvedVoiceConfig = vi.fn();
const mockResolveUsedPromptId = vi.fn();

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@prisma/client", () => ({ Prisma: {} }));

vi.mock("@/lib/caller/resolve-active-playbook", () => ({
  resolveActivePlaybookId: mockResolveActivePlaybookId,
}));

vi.mock("@/lib/curriculum/resolve-module", () => ({
  resolveCurriculumIdForPlaybook: mockResolveCurriculumIdForPlaybook,
  resolveModuleByLogicalId: mockResolveModuleByLogicalId,
}));

vi.mock("@/lib/curriculum/resolve-default-module", () => ({
  resolveDefaultModuleForCaller: mockResolveDefaultModuleForCaller,
}));

vi.mock("@/lib/voice/load-voice-config", () => ({
  loadResolvedVoiceConfig: mockLoadResolvedVoiceConfig,
}));

vi.mock("@/lib/voice/resolve-used-prompt", () => ({
  resolveUsedPromptId: mockResolveUsedPromptId,
}));

beforeEach(() => {
  vi.clearAllMocks();

  // Sensible defaults that exercise the no-enrollment path.
  mockPrisma.caller.findUnique.mockResolvedValue({ lastSelectedModuleId: null });
  mockResolveActivePlaybookId.mockResolvedValue(null);
  mockResolveCurriculumIdForPlaybook.mockResolvedValue(null);
  mockResolveModuleByLogicalId.mockResolvedValue(null);
  mockResolveDefaultModuleForCaller.mockResolvedValue(null);
  mockLoadResolvedVoiceConfig.mockResolvedValue({ fields: {}, snapshot: "ok" });
  mockResolveUsedPromptId.mockResolvedValue({ usedPromptId: null, source: "none" });

  // Default $transaction → run the callback against mockTx.
  mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<unknown>) => {
    return await cb(mockTx);
  });

  // Counter upsert: return nextSeq=2 by default (assigned = 1)
  mockTx.callerSequenceCounter.upsert.mockResolvedValue({ nextSeq: 2 });

  // Session create: echo data + assign an id
  mockTx.session.create.mockImplementation(
    ({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        id: "session-1",
        sequenceNumber: data.sequenceNumber as number,
        learnerFacingNumber: (data.learnerFacingNumber as number | null) ?? null,
        kind: data.kind,
      }),
  );
});

describe("createSession", () => {
  it("throws if callerId is missing", async () => {
    const { createSession } = await import("@/lib/voice/create-session");
    await expect(
      // @ts-expect-error: testing runtime guard
      createSession({ kind: "VOICE_CALL" }),
    ).rejects.toThrow(/callerId is required/);
  });

  it("no enrollment → returns playbookId null, doesn't throw, Session row still created", async () => {
    mockResolveActivePlaybookId.mockResolvedValueOnce(null);

    const { createSession } = await import("@/lib/voice/create-session");
    const result = await createSession({
      callerId: "caller-no-enrol",
      kind: "VOICE_CALL",
      source: "vapi",
      voiceProvider: "vapi",
    });

    expect(result.playbookId).toBeNull();
    expect(result.curriculumModuleId).toBeNull();
    expect(result.session.id).toBe("session-1");
    expect(mockTx.session.create).toHaveBeenCalledTimes(1);
  });

  it("happy path — playbook + module + requested slug all resolved", async () => {
    mockResolveActivePlaybookId.mockResolvedValueOnce("pb-1");
    mockResolveCurriculumIdForPlaybook.mockResolvedValueOnce("curr-1");
    mockResolveModuleByLogicalId.mockResolvedValueOnce({ id: "mod-1" });

    const { createSession } = await import("@/lib/voice/create-session");
    const result = await createSession({
      callerId: "caller-1",
      kind: "VOICE_CALL",
      source: "vapi",
      voiceProvider: "vapi",
      requestedModuleId: "part2",
    });

    expect(result.playbookId).toBe("pb-1");
    expect(result.requestedModuleId).toBe("part2");
    expect(result.curriculumModuleId).toBe("mod-1");
  });

  it("explicit requestedModuleId arg wins over Caller.lastSelectedModuleId", async () => {
    mockResolveActivePlaybookId.mockResolvedValueOnce("pb-1");
    mockResolveCurriculumIdForPlaybook.mockResolvedValueOnce("curr-1");
    mockPrisma.caller.findUnique.mockResolvedValueOnce({
      lastSelectedModuleId: "from-caller",
    });
    mockResolveModuleByLogicalId.mockResolvedValueOnce({ id: "mod-explicit" });

    const { createSession } = await import("@/lib/voice/create-session");
    const result = await createSession({
      callerId: "caller-1",
      kind: "VOICE_CALL",
      source: "vapi",
      voiceProvider: "vapi",
      requestedModuleId: "from-arg",
    });

    expect(result.requestedModuleId).toBe("from-arg");
    // findUnique should NOT be called for the lastSelectedModuleId
    // lookup when the arg is supplied.
    expect(mockPrisma.caller.findUnique).not.toHaveBeenCalled();
  });

  it("lastSelectedModuleId used when no arg", async () => {
    mockResolveActivePlaybookId.mockResolvedValueOnce("pb-1");
    mockResolveCurriculumIdForPlaybook.mockResolvedValueOnce("curr-1");
    mockPrisma.caller.findUnique.mockResolvedValueOnce({
      lastSelectedModuleId: "from-caller",
    });
    mockResolveModuleByLogicalId.mockResolvedValueOnce({ id: "mod-from-caller" });

    const { createSession } = await import("@/lib/voice/create-session");
    const result = await createSession({
      callerId: "caller-1",
      kind: "VOICE_CALL",
      source: "vapi",
      voiceProvider: "vapi",
    });

    expect(result.requestedModuleId).toBe("from-caller");
    expect(result.curriculumModuleId).toBe("mod-from-caller");
  });

  it("VOICE_CALL → learnerFacingNumber assigned (counter call made)", async () => {
    mockTx.callerSequenceCounter.upsert
      .mockResolvedValueOnce({ nextSeq: 2 }) // kind counter
      .mockResolvedValueOnce({ nextSeq: 2 }); // learnerFacing counter

    const { createSession } = await import("@/lib/voice/create-session");
    const result = await createSession({
      callerId: "caller-1",
      kind: "VOICE_CALL",
      source: "vapi",
      voiceProvider: "vapi",
    });

    expect(result.countsTowardLearnerNumber).toBe(true);
    expect(mockTx.callerSequenceCounter.upsert).toHaveBeenCalledTimes(2);
    // Second upsert must be on 'learnerFacing' kind.
    expect(mockTx.callerSequenceCounter.upsert.mock.calls[1][0]).toMatchObject({
      where: { callerId_kind: { callerId: "caller-1", kind: "learnerFacing" } },
    });
  });

  it("SIM_CALL → learner counter NOT incremented (sim is harness)", async () => {
    const { createSession } = await import("@/lib/voice/create-session");
    const result = await createSession({
      callerId: "caller-1",
      kind: "SIM_CALL",
      source: "sim",
      voiceProvider: null,
    });

    expect(result.countsTowardLearnerNumber).toBe(false);
    // Only ONE counter upsert — the per-(callerId, kind) one. No
    // learnerFacing counter call.
    expect(mockTx.callerSequenceCounter.upsert).toHaveBeenCalledTimes(1);
  });

  it("ENROLLMENT → skipStages includes EXTRACT/SCORE_AGENT/PROSODY", async () => {
    const { createSession } = await import("@/lib/voice/create-session");
    const result = await createSession({
      callerId: "caller-1",
      kind: "ENROLLMENT",
      source: "join",
      voiceProvider: null,
      intentId: "intent-abc",
    });

    expect(result.skipStages).toEqual(["EXTRACT", "PROSODY", "SCORE_AGENT"]);
    // intentId persisted.
    const createData = mockTx.session.create.mock.calls[0][0].data;
    expect(createData.intentId).toBe("intent-abc");
  });

  it("voiceConfigSnapshot populated for VOICE_CALL", async () => {
    mockLoadResolvedVoiceConfig.mockResolvedValueOnce({
      fields: { autoPipeline: { value: true } },
      snapshot: "frozen",
    });

    const { createSession } = await import("@/lib/voice/create-session");
    const result = await createSession({
      callerId: "caller-1",
      kind: "VOICE_CALL",
      source: "vapi",
      voiceProvider: "vapi",
    });

    expect(result.voiceConfigSnapshot).toBeTruthy();
    expect((result.voiceConfigSnapshot as Record<string, unknown>).snapshot).toBe(
      "frozen",
    );
  });

  it("voiceConfigSnapshot NOT populated for ENROLLMENT (no voice context)", async () => {
    const { createSession } = await import("@/lib/voice/create-session");
    const result = await createSession({
      callerId: "caller-1",
      kind: "ENROLLMENT",
      source: "join",
      voiceProvider: null,
    });

    expect(result.voiceConfigSnapshot).toBeNull();
    expect(mockLoadResolvedVoiceConfig).not.toHaveBeenCalled();
  });

  it("voiceConfigSnapshot failure is tolerated — Session still created", async () => {
    mockLoadResolvedVoiceConfig.mockRejectedValueOnce(new Error("voice config broken"));

    const { createSession } = await import("@/lib/voice/create-session");
    const result = await createSession({
      callerId: "caller-1",
      kind: "VOICE_CALL",
      source: "vapi",
      voiceProvider: "vapi",
    });

    // Session row still landed
    expect(result.session.id).toBe("session-1");
    expect(result.voiceConfigSnapshot).toBeNull();
  });

  it("usedPromptId pulled from cascade resolver", async () => {
    mockResolveUsedPromptId.mockResolvedValueOnce({
      usedPromptId: "cp-from-cascade",
      source: "previous-session",
    });

    const { createSession } = await import("@/lib/voice/create-session");
    const result = await createSession({
      callerId: "caller-1",
      kind: "VOICE_CALL",
      source: "vapi",
      voiceProvider: "vapi",
    });

    expect(result.usedPromptId).toBe("cp-from-cascade");
  });

  it("sequence assignment uses pre-increment value of nextSeq", async () => {
    mockTx.callerSequenceCounter.upsert.mockResolvedValueOnce({ nextSeq: 5 });

    const { createSession } = await import("@/lib/voice/create-session");
    const result = await createSession({
      callerId: "caller-1",
      kind: "SIM_CALL",
      source: "sim",
      voiceProvider: null,
    });

    // Returned nextSeq is post-increment (5), assigned is pre-increment (4).
    expect(result.session.sequenceNumber).toBe(4);
  });
});
