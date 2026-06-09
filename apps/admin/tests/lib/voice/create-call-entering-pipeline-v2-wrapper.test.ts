/**
 * #1342 — V2 wrapper path of createCallEnteringPipeline.
 *
 * When `HF_FLAG_SESSION_MODEL_V2=true`, the builder delegates to
 * `createSession` and creates the Call child linked via `sessionId`.
 * When the flag is off, the original V1 path runs (covered by
 * `create-call-entering-pipeline.test.ts`).
 *
 * The V1 callers (`outbound-dial`, `start`) keep their existing
 * function signature — this lock confirms `sessionId` is plumbed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockPrisma = {
  call: { create: vi.fn() },
  caller: { findUnique: vi.fn() },
};
const mockCreateSession = vi.fn();

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/voice/create-session", () => ({ createSession: mockCreateSession }));

// These are unused on the V2 path but the file imports them.
vi.mock("@/lib/caller/resolve-active-playbook", () => ({
  resolveActivePlaybookId: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/curriculum/resolve-module", () => ({
  resolveCurriculumIdForPlaybook: vi.fn().mockResolvedValue(null),
  resolveModuleByLogicalId: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/curriculum/resolve-default-module", () => ({
  resolveDefaultModuleForCaller: vi.fn().mockResolvedValue(null),
}));

const ENV_VAR = "HF_FLAG_SESSION_MODEL_V2";
let originalFlag: string | undefined;

beforeEach(() => {
  vi.resetAllMocks();
  originalFlag = process.env[ENV_VAR];
  process.env[ENV_VAR] = "true";

  mockCreateSession.mockResolvedValue({
    session: {
      id: "session-v2",
      sequenceNumber: 1,
      learnerFacingNumber: 1,
      kind: "VOICE_CALL",
    },
    playbookId: "pb-1",
    requestedModuleId: "mod-slug",
    curriculumModuleId: "mod-id",
    usedPromptId: "cp-prev",
    voiceConfigSnapshot: { snapshot: "frozen" },
    countsTowardLearnerNumber: true,
    countsTowardPipelineNumber: true,
    skipStages: [],
  });
  mockPrisma.call.create.mockImplementation(
    ({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: "call-v2", ...data }),
  );
  mockPrisma.caller.findUnique.mockResolvedValue({ lastSelectedModuleId: null });
});

afterEach(() => {
  if (originalFlag === undefined) delete process.env[ENV_VAR];
  else process.env[ENV_VAR] = originalFlag;
});

describe("createCallEnteringPipeline — V2 wrapper (HF_FLAG_SESSION_MODEL_V2=true)", () => {
  it("delegates to createSession with kind=VOICE_CALL", async () => {
    const { createCallEnteringPipeline } = await import(
      "@/lib/voice/create-call-entering-pipeline"
    );
    await createCallEnteringPipeline({
      callerId: "caller-1",
      source: "vapi",
      voiceProvider: "vapi",
      requestedModuleId: "part2",
    });

    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    expect(mockCreateSession).toHaveBeenCalledWith({
      callerId: "caller-1",
      kind: "VOICE_CALL",
      source: "vapi",
      voiceProvider: "vapi",
      requestedModuleId: "part2",
    });
  });

  it("links Call.sessionId to the new Session", async () => {
    const { createCallEnteringPipeline } = await import(
      "@/lib/voice/create-call-entering-pipeline"
    );
    const result = await createCallEnteringPipeline({
      callerId: "caller-1",
      source: "vapi",
      voiceProvider: "vapi",
    });

    expect(result.sessionId).toBe("session-v2");
    const createPayload = mockPrisma.call.create.mock.calls[0][0].data;
    expect(createPayload.sessionId).toBe("session-v2");
  });

  it("mirrors learnerFacingNumber to Call.callSequence", async () => {
    mockCreateSession.mockResolvedValueOnce({
      session: { id: "session-v2", sequenceNumber: 5, learnerFacingNumber: 3, kind: "VOICE_CALL" },
      playbookId: "pb-1",
      requestedModuleId: null,
      curriculumModuleId: null,
      usedPromptId: null,
      voiceConfigSnapshot: null,
      countsTowardLearnerNumber: true,
      countsTowardPipelineNumber: true,
      skipStages: [],
    });

    const { createCallEnteringPipeline } = await import(
      "@/lib/voice/create-call-entering-pipeline"
    );
    await createCallEnteringPipeline({
      callerId: "caller-1",
      source: "vapi",
      voiceProvider: "vapi",
    });

    const createPayload = mockPrisma.call.create.mock.calls[0][0].data;
    expect(createPayload.callSequence).toBe(3);
  });

  it("V2 wrapper returns the same CallEntryResult shape as V1 + sessionId", async () => {
    const { createCallEnteringPipeline } = await import(
      "@/lib/voice/create-call-entering-pipeline"
    );
    const result = await createCallEnteringPipeline({
      callerId: "caller-1",
      source: "vapi",
      voiceProvider: "vapi",
    });

    expect(result).toHaveProperty("call");
    expect(result).toHaveProperty("playbookId");
    expect(result).toHaveProperty("requestedModuleId");
    expect(result).toHaveProperty("curriculumModuleId");
    expect(result).toHaveProperty("sessionId");
    expect(result.sessionId).toBe("session-v2");
  });

  it("flag OFF → V2 wrapper not invoked, V1 cascade runs (no createSession call)", async () => {
    process.env[ENV_VAR] = "false";

    const { createCallEnteringPipeline } = await import(
      "@/lib/voice/create-call-entering-pipeline"
    );
    const result = await createCallEnteringPipeline({
      callerId: "caller-1",
      source: "vapi",
      voiceProvider: "vapi",
    });

    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(result.sessionId).toBeNull();
  });
});
