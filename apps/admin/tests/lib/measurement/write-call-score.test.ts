/**
 * Pins the structural contract of `writeCallScore` (#1539).
 *
 * The helper is the SOLE PATH for writing `CallScore` rows from the
 * production pipeline. Every test in this file pins a structural
 * invariant — if any test goes red, a future edit has either (a)
 * weakened the analysisSpecId requirement, (b) changed the idempotence
 * shape, or (c) re-introduced the spec-lineage gap this PR closes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    callScore: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";

import {
  writeCallScore,
  MEASUREMENT_SENTINEL_SPEC_IDS,
} from "@/lib/measurement/write-call-score";

const mockedFindFirst = prisma.callScore.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const mockedCreate = prisma.callScore.create as unknown as ReturnType<
  typeof vi.fn
>;
const mockedUpdate = prisma.callScore.update as unknown as ReturnType<
  typeof vi.fn
>;

beforeEach(() => {
  mockedFindFirst.mockReset();
  mockedCreate.mockReset();
  mockedUpdate.mockReset();
});

describe("writeCallScore — structural contract", () => {
  it("rejects empty analysisSpecId", async () => {
    await expect(
      writeCallScore({
        callId: "call-1",
        callerId: "caller-1",
        parameterId: "IELTS-FLUENCY",
        analysisSpecId: "",
        moduleId: null,
        score: 0.7,
        confidence: 0.8,
        evidence: ["x"],
      }),
    ).rejects.toThrow(/analysisSpecId is required/);
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only analysisSpecId", async () => {
    await expect(
      writeCallScore({
        callId: "call-1",
        callerId: "caller-1",
        parameterId: "IELTS-FLUENCY",
        analysisSpecId: "   ",
        moduleId: null,
        score: 0.7,
        confidence: 0.8,
        evidence: ["x"],
      }),
    ).rejects.toThrow(/analysisSpecId is required/);
  });

  it("rejects undefined cast through `as any`", async () => {
    await expect(
      writeCallScore({
        callId: "call-1",
        callerId: "caller-1",
        parameterId: "IELTS-FLUENCY",
        analysisSpecId: undefined as unknown as string,
        moduleId: null,
        score: 0.7,
        confidence: 0.8,
        evidence: ["x"],
      }),
    ).rejects.toThrow(/analysisSpecId is required/);
  });

  it("creates a new row when none exists, stamping analysisSpecId", async () => {
    mockedFindFirst.mockResolvedValueOnce(null);
    mockedCreate.mockResolvedValueOnce({ id: "score-new" });

    const result = await writeCallScore({
      callId: "call-1",
      callerId: "caller-1",
      parameterId: "IELTS-FLUENCY",
      analysisSpecId: "spec-abc",
      moduleId: "mod-1",
      score: 0.7,
      confidence: 0.8,
      evidence: ["AI batched analysis"],
      scoredBy: "claude_batched_v2",
      reasoning: "Strong fluency cues",
      hasLearnerEvidence: true,
      evidenceQuality: 0.6,
    });

    expect(result).toEqual({ id: "score-new", created: true });
    expect(mockedCreate).toHaveBeenCalledOnce();
    const createArg = mockedCreate.mock.calls[0]![0];
    expect(createArg.data.analysisSpecId).toBe("spec-abc");
    expect(createArg.data.callId).toBe("call-1");
    expect(createArg.data.parameterId).toBe("IELTS-FLUENCY");
    expect(createArg.data.moduleId).toBe("mod-1");
    expect(createArg.data.scoredBy).toBe("claude_batched_v2");
  });

  it("updates an existing row in place when (callId, parameterId, moduleId) matches", async () => {
    mockedFindFirst.mockResolvedValueOnce({ id: "score-existing" });
    mockedUpdate.mockResolvedValueOnce({ id: "score-existing" });

    const result = await writeCallScore({
      callId: "call-1",
      callerId: "caller-1",
      parameterId: "IELTS-FLUENCY",
      analysisSpecId: "spec-abc",
      moduleId: "mod-1",
      score: 0.9,
      confidence: 0.9,
      evidence: ["AI batched analysis (re-run)"],
    });

    expect(result).toEqual({ id: "score-existing", created: false });
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(mockedUpdate).toHaveBeenCalledOnce();
    const updateArg = mockedUpdate.mock.calls[0]![0];
    expect(updateArg.data.analysisSpecId).toBe("spec-abc");
    expect(updateArg.data.score).toBe(0.9);
  });

  it("filters findFirst by moduleId so per-segment writes don't collide with bound-module writes", async () => {
    mockedFindFirst.mockResolvedValueOnce(null);
    mockedCreate.mockResolvedValueOnce({ id: "score-segment" });

    await writeCallScore({
      callId: "call-1",
      callerId: "caller-1",
      parameterId: "IELTS-FLUENCY",
      analysisSpecId: "spec-abc",
      moduleId: "mod-part1",
      score: 0.5,
      confidence: 0.7,
      evidence: ["Segment: part1"],
    });

    expect(mockedFindFirst).toHaveBeenCalledWith({
      where: {
        callId: "call-1",
        parameterId: "IELTS-FLUENCY",
        moduleId: "mod-part1",
      },
      select: { id: true },
    });
  });

  it("omits moduleId from create payload when null (preserves schema default)", async () => {
    mockedFindFirst.mockResolvedValueOnce(null);
    mockedCreate.mockResolvedValueOnce({ id: "score-unbound" });

    await writeCallScore({
      callId: "call-1",
      callerId: "caller-1",
      parameterId: "PERSONALITY-OPENNESS",
      analysisSpecId: "spec-pers",
      moduleId: null,
      score: 0.6,
      confidence: 0.5,
      evidence: ["AI batched analysis"],
    });

    const createArg = mockedCreate.mock.calls[0]![0];
    expect("moduleId" in createArg.data).toBe(false);
  });

  it("forwards segmentKey into the create payload (#1702 per-part annotation)", async () => {
    mockedFindFirst.mockResolvedValueOnce(null);
    mockedCreate.mockResolvedValueOnce({ id: "score-seg" });

    await writeCallScore({
      callId: "call-1",
      callerId: "caller-1",
      parameterId: "skill_fluency_and_coherence_fc",
      analysisSpecId: "spec-abc",
      moduleId: "mod-part2",
      score: 0.7,
      confidence: 0.8,
      evidence: ["Segment: part2"],
      segmentKey: "part2",
    });

    expect(mockedCreate.mock.calls[0]![0].data.segmentKey).toBe("part2");
  });

  it("forwards segmentKey into the update payload on re-run", async () => {
    mockedFindFirst.mockResolvedValueOnce({ id: "score-existing" });
    mockedUpdate.mockResolvedValueOnce({ id: "score-existing" });

    await writeCallScore({
      callId: "call-1",
      callerId: "caller-1",
      parameterId: "skill_fluency_and_coherence_fc",
      analysisSpecId: "spec-abc",
      moduleId: "mod-part2",
      score: 0.9,
      confidence: 0.9,
      evidence: ["Segment: part2 (re-run)"],
      segmentKey: "part2",
    });

    expect(mockedUpdate.mock.calls[0]![0].data.segmentKey).toBe("part2");
  });

  it("defaults segmentKey to null when omitted (non-Mock paths unchanged)", async () => {
    mockedFindFirst.mockResolvedValueOnce(null);
    mockedCreate.mockResolvedValueOnce({ id: "score-whole-call" });

    await writeCallScore({
      callId: "call-1",
      callerId: "caller-1",
      parameterId: "skill_pronunciation_p",
      analysisSpecId: MEASUREMENT_SENTINEL_SPEC_IDS.PROSODY,
      moduleId: null,
      score: 0.6,
      confidence: 0.9,
      evidence: ["prosody/ielts:band=6.0"],
    });

    // create branch omits the key entirely when null → schema default (null).
    expect("segmentKey" in mockedCreate.mock.calls[0]![0].data).toBe(false);

    // update branch always writes it explicitly as null.
    mockedFindFirst.mockResolvedValueOnce({ id: "score-existing" });
    mockedUpdate.mockResolvedValueOnce({ id: "score-existing" });
    await writeCallScore({
      callId: "call-1",
      callerId: "caller-1",
      parameterId: "skill_pronunciation_p",
      analysisSpecId: MEASUREMENT_SENTINEL_SPEC_IDS.PROSODY,
      moduleId: null,
      score: 0.6,
      confidence: 0.9,
      evidence: ["prosody/ielts:band=6.0"],
    });
    expect(mockedUpdate.mock.calls[0]![0].data.segmentKey).toBe(null);
  });

  it("accepts sentinel spec ids for non-LLM writers", async () => {
    mockedFindFirst.mockResolvedValueOnce(null);
    mockedCreate.mockResolvedValueOnce({ id: "score-prosody" });

    await writeCallScore({
      callId: "call-1",
      callerId: "caller-1",
      parameterId: "skill_fluency_and_coherence_fc",
      analysisSpecId: MEASUREMENT_SENTINEL_SPEC_IDS.PROSODY,
      moduleId: null,
      score: 0.7,
      confidence: 0.9,
      evidence: ["prosody/ielts:band=6.5"],
      scoredBy: "prosody_v1",
    });

    expect(mockedCreate).toHaveBeenCalledOnce();
    expect(mockedCreate.mock.calls[0]![0].data.analysisSpecId).toBe(
      "PROSODY-SCORE-V1",
    );
  });
});
