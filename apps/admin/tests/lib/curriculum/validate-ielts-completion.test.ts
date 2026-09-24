/**
 * Behavioural tests for `lib/curriculum/validate-ielts-completion.ts` (#1953).
 *
 * Pins (Boaz/Eldar pre-voice gap analysis Cross-cutting A bar):
 *   - 4 IELTS criteria scored > 0 on the call's aggregate row → complete
 *   - Any criterion missing → not complete, missing[] reports the gap
 *   - Any criterion at score === 0 → not complete (Boaz: "non-null, non-zero")
 *   - Per-phase rows (segmentKey IS NOT NULL) are NOT counted toward the gate
 *   - Throws on missing callId
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    callScore: {
      findMany: vi.fn(),
    },
  },
}));

import { validateIeltsCompletion } from "@/lib/curriculum/validate-ielts-completion";
import { prisma } from "@/lib/prisma";

const findMany = prisma.callScore.findMany as ReturnType<typeof vi.fn>;

const FC = "skill_fluency_and_coherence_fc";
const P = "skill_pronunciation_p";
const LR = "skill_lexical_resource_lr";
const GRA = "skill_grammatical_range_and_accuracy_gra";

describe("validateIeltsCompletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns complete=true when all 4 criteria score > 0 on the aggregate row", async () => {
    findMany.mockResolvedValue([
      { parameterId: FC, score: 0.75 },
      { parameterId: P, score: 0.5 },
      { parameterId: LR, score: 0.66 },
      { parameterId: GRA, score: 0.83 },
    ]);

    const result = await validateIeltsCompletion("call-1");

    expect(result.complete).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("reports missing parameter when a criterion row is absent", async () => {
    findMany.mockResolvedValue([
      { parameterId: FC, score: 0.75 },
      { parameterId: P, score: 0.5 },
      { parameterId: LR, score: 0.66 },
      // GRA missing
    ]);

    const result = await validateIeltsCompletion("call-1");

    expect(result.complete).toBe(false);
    expect(result.missing).toEqual([GRA]);
  });

  it("treats score === 0 as missing (Boaz: non-null, non-zero)", async () => {
    findMany.mockResolvedValue([
      { parameterId: FC, score: 0.75 },
      { parameterId: P, score: 0 },
      { parameterId: LR, score: 0.66 },
      { parameterId: GRA, score: 0.83 },
    ]);

    const result = await validateIeltsCompletion("call-1");

    expect(result.complete).toBe(false);
    expect(result.missing).toEqual([P]);
  });

  it("reports all 4 missing when no rows exist", async () => {
    findMany.mockResolvedValue([]);

    const result = await validateIeltsCompletion("call-1");

    expect(result.complete).toBe(false);
    expect(result.missing).toEqual([FC, P, LR, GRA]);
  });

  it("ignores per-phase rows — queries with segmentKey: null", async () => {
    findMany.mockResolvedValue([
      { parameterId: FC, score: 0.75 },
      { parameterId: P, score: 0.5 },
      { parameterId: LR, score: 0.66 },
      { parameterId: GRA, score: 0.83 },
    ]);

    await validateIeltsCompletion("call-1");

    expect(findMany).toHaveBeenCalledWith({
      where: {
        callId: "call-1",
        parameterId: { in: [FC, P, LR, GRA] },
        segmentKey: null,
      },
      select: { parameterId: true, score: true },
    });
  });

  it("throws on missing callId", async () => {
    await expect(validateIeltsCompletion("")).rejects.toThrow(
      "validateIeltsCompletion: callId is required",
    );
  });
});
