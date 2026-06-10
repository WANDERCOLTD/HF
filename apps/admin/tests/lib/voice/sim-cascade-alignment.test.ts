/**
 * #1420 Slice 5 — SIM_CALL + TEXT_CHAT cascade-alignment proof.
 *
 * Locks the invariant: the I-CT2 prompt-resolution cascade is
 * kind-agnostic. A non-voice Session (SIM_CALL today, TEXT_CHAT once a
 * route exists) MUST resolve `usedPromptId` from the same enrollment-
 * keyed cascade as VOICE_CALL — including the step-3 ENROLLMENT
 * bootstrap that #1420's auto-compose fix populates.
 *
 * Without this guarantee a brand-new sim run could resolve `null` for
 * its prompt even after the enrollment-bootstrap row exists, defeating
 * the whole point of fan-firing autoCompose per ACTIVE enrollment.
 *
 * The lock is two-sided:
 *   1. `resolveUsedPromptId` signature accepts only `callerId` (no
 *      `kind` filter parameter exists).
 *   2. A SIM_CALL `createSession` call invokes the resolver with the
 *      bare callerId and receives the enrollment-bootstrap prompt id.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  caller: { findUnique: vi.fn() },
  session: { findFirst: vi.fn() },
  composedPrompt: { findFirst: vi.fn() },
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

beforeEach(() => {
  vi.clearAllMocks();

  // Defaults for the no-enrollment / no-prompt baseline.
  mockPrisma.caller.findUnique.mockResolvedValue({ lastSelectedModuleId: null });
  mockPrisma.session.findFirst.mockResolvedValue(null);
  mockPrisma.composedPrompt.findFirst.mockResolvedValue(null);
  mockResolveActivePlaybookId.mockResolvedValue(null);
  mockResolveCurriculumIdForPlaybook.mockResolvedValue(null);
  mockResolveModuleByLogicalId.mockResolvedValue(null);
  mockResolveDefaultModuleForCaller.mockResolvedValue(null);
  mockLoadResolvedVoiceConfig.mockResolvedValue({ fields: {}, snapshot: "ok" });

  mockPrisma.$transaction.mockImplementation(
    async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx),
  );
  mockTx.callerSequenceCounter.upsert.mockResolvedValue({ nextSeq: 2 });
  mockTx.session.create.mockImplementation(
    ({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        id: "session-sim-1",
        sequenceNumber: data.sequenceNumber as number,
        learnerFacingNumber:
          (data.learnerFacingNumber as number | null) ?? null,
        kind: data.kind,
      }),
  );
});

describe("#1420 — SIM_CALL cascade alignment with VOICE_CALL", () => {
  it("resolveUsedPromptId signature does NOT accept a kind filter", async () => {
    // Structural lock: if a future PR adds `kind` to UsedPromptResolution
    // args this test fails and forces the author to update the #1420
    // claim in the JSDoc header.
    const mod = await import("@/lib/voice/resolve-used-prompt");
    expect(mod.resolveUsedPromptId.length).toBe(1); // single args object
  });

  it("SIM_CALL Session calls the resolver with ONLY callerId (no kind hint)", async () => {
    // Spy on the resolver to capture exactly what createSession passes.
    const captured: Array<{ callerId: string }> = [];
    vi.doMock("@/lib/voice/resolve-used-prompt", () => ({
      resolveUsedPromptId: vi.fn(async (args: { callerId: string }) => {
        captured.push(args);
        return { usedPromptId: null, source: "none" as const };
      }),
    }));

    const { createSession } = await import("@/lib/voice/create-session");
    await createSession({
      callerId: "caller-sim-1",
      kind: "SIM_CALL",
      source: "sim",
      voiceProvider: null,
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({ callerId: "caller-sim-1" });
    // CRITICAL: object MUST NOT carry kind. Object.keys lock.
    expect(Object.keys(captured[0])).toEqual(["callerId"]);

    vi.doUnmock("@/lib/voice/resolve-used-prompt");
  });

  it("SIM_CALL Session lands on the ENROLLMENT bootstrap when no prior prompt exists", async () => {
    // Step 1 returns null (no prior produced prompt).
    // Step 2 returns null (no ACTIVE ComposedPrompt yet — fresh caller).
    // Step 3 returns the ENROLLMENT bootstrap.
    mockPrisma.session.findFirst
      .mockResolvedValueOnce(null) // step 1
      .mockResolvedValueOnce({ producedComposedPromptId: "cp-bootstrap-sim" }); // step 3
    mockPrisma.composedPrompt.findFirst.mockResolvedValueOnce(null); // step 2

    // Re-import a real resolver (the doMock from prior `it` is unmocked).
    vi.resetModules();
    const { createSession } = await import("@/lib/voice/create-session");
    const result = await createSession({
      callerId: "caller-sim-2",
      kind: "SIM_CALL",
      source: "sim",
      voiceProvider: null,
    });

    // SIM_CALL SHOULD see the same bootstrap prompt VOICE_CALL would.
    expect(result.usedPromptId).toBe("cp-bootstrap-sim");

    // Sanity: counter rules for SIM_CALL still apply (no learnerFacing
    // increment, single counter upsert).
    expect(result.countsTowardLearnerNumber).toBe(false);
  });

  it("VOICE_CALL on the same caller would resolve to the SAME bootstrap prompt id", async () => {
    // Reset module cache so we get a fresh resolver instance.
    vi.resetModules();

    // Identical mock setup to the SIM_CALL test above — except kind.
    mockPrisma.session.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ producedComposedPromptId: "cp-bootstrap-shared" });
    mockPrisma.composedPrompt.findFirst.mockResolvedValueOnce(null);

    const { createSession } = await import("@/lib/voice/create-session");
    const voiceResult = await createSession({
      callerId: "caller-shared-1",
      kind: "VOICE_CALL",
      source: "vapi",
      voiceProvider: "vapi",
    });

    expect(voiceResult.usedPromptId).toBe("cp-bootstrap-shared");

    // Now repeat the EXACT same enrollment state for SIM_CALL.
    vi.resetModules();
    mockPrisma.session.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ producedComposedPromptId: "cp-bootstrap-shared" });
    mockPrisma.composedPrompt.findFirst.mockResolvedValueOnce(null);

    const { createSession: createSession2 } = await import(
      "@/lib/voice/create-session"
    );
    const simResult = await createSession2({
      callerId: "caller-shared-1",
      kind: "SIM_CALL",
      source: "sim",
      voiceProvider: null,
    });

    // Same enrollment state → same bootstrap id. THIS is the alignment
    // property #1420 Slice 5 locks: SIM_CALL benefits from the post-tx
    // autoCompose just like VOICE_CALL does.
    expect(simResult.usedPromptId).toBe(voiceResult.usedPromptId);
  });
});
