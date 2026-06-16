/**
 * #1749 (epic #1700 Theme 11) — per-session score-delta narrator.
 *
 * Pins that `loadPriorCallFeedback` surfaces `priorCriterionScores`
 * for skill_* parameters from the prior call, deduped + sorted by name.
 * The composer renders these as a continuity-narration line so the
 * tutor cites concrete numbers (anti-fabrication pin #1006 Maya class).
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prompt/composition/loaders/synthesizePriorCallRecap", () => ({
  synthesizePriorCallRecap: vi.fn(async () => null),
  RICH_TRANSCRIPT_SLICE_LIMIT: 6000,
}));

import { loadPriorCallFeedback } from "@/lib/prompt/composition/loaders/priorCallFeedback";

const NOW = new Date("2026-05-26T10:00:00Z");
const PRIOR_CALL_AT = new Date("2026-05-25T09:00:00Z");
const CALLER_ID = "caller-1";
const MODULE_ID = "mod-1";
const PRIOR_CALL_ID = "call-prior";

function makePrisma(
  scores: Array<{
    score: number;
    parameterId: string;
    parameterName: string;
    moduleId?: string | null;
  }>,
) {
  return {
    call: {
      findFirst: vi.fn(async () => ({ id: PRIOR_CALL_ID, createdAt: PRIOR_CALL_AT })),
      findUnique: vi.fn(async () => null),
    },
    callScore: {
      findMany: vi.fn(async () =>
        scores.map((s) => ({
          score: s.score,
          moduleId: s.moduleId === undefined ? MODULE_ID : s.moduleId,
          parameterId: s.parameterId,
          parameter: { name: s.parameterName, parameterId: s.parameterId },
        })),
      ),
    },
    systemSetting: { findUnique: vi.fn(async () => null) },
    usageEvent: { findMany: vi.fn(async () => []) },
    composedPrompt: { findFirst: vi.fn(async () => null) },
    auditLog: { findFirst: vi.fn(async () => null), create: vi.fn() },
    caller: { findUnique: vi.fn(async () => null) },
  } as unknown as Parameters<typeof loadPriorCallFeedback>[0];
}

describe("priorCallFeedback — priorCriterionScores (#1749)", () => {
  it("emits per-criterion scoreboard for all skill_* parameters", async () => {
    const prisma = makePrisma([
      { score: 0.55, parameterId: "skill_fluency", parameterName: "Fluency" },
      { score: 0.72, parameterId: "skill_grammar", parameterName: "Grammar" },
      { score: 0.61, parameterId: "skill_lexical", parameterName: "Lexical Resource" },
    ]);
    const result = await loadPriorCallFeedback(prisma, {
      callerId: CALLER_ID,
      moduleId: MODULE_ID,
      now: NOW,
    });
    expect(result.priorCriterionScores).toBeDefined();
    expect(result.priorCriterionScores!.length).toBe(3);
    // Sorted by parameterName alphabetical.
    expect(result.priorCriterionScores![0].parameterName).toBe("Fluency");
    expect(result.priorCriterionScores![1].parameterName).toBe("Grammar");
    expect(result.priorCriterionScores![2].parameterName).toBe("Lexical Resource");
    expect(result.priorCriterionScores![0].score).toBeCloseTo(0.55, 2);
  });

  it("filters non-skill parameters from the scoreboard (relevance filter)", async () => {
    // Mix skill_* with coaching parameters — only skill_* appear.
    const prisma = makePrisma([
      { score: 0.55, parameterId: "skill_fluency", parameterName: "Fluency" },
      { score: 0.2, parameterId: "action_commitment", parameterName: "Action Commitment" },
      { score: 0.72, parameterId: "skill_grammar", parameterName: "Grammar" },
    ]);
    const result = await loadPriorCallFeedback(prisma, {
      callerId: CALLER_ID,
      moduleId: MODULE_ID,
      now: NOW,
    });
    expect(result.priorCriterionScores!.length).toBe(2);
    expect(
      result.priorCriterionScores!.find((s) => s.parameterId === "action_commitment"),
    ).toBeUndefined();
  });

  it("falls back to all parameters when no skill_* exist", async () => {
    // Pure coaching playbook — no skill_* rows. The full set surfaces.
    const prisma = makePrisma([
      { score: 0.4, parameterId: "warmth", parameterName: "Warmth" },
      { score: 0.6, parameterId: "challenge", parameterName: "Challenge" },
    ]);
    const result = await loadPriorCallFeedback(prisma, {
      callerId: CALLER_ID,
      moduleId: MODULE_ID,
      now: NOW,
    });
    expect(result.priorCriterionScores!.length).toBe(2);
  });

  it("dedupes parameters appearing more than once (per-segment writes)", async () => {
    // Mock exam writes 12 rows (3 parts × 4 skills) — same parameterId
    // appears 3× with different segmentKeys. Scoreboard dedupes.
    const prisma = makePrisma([
      { score: 0.55, parameterId: "skill_fluency", parameterName: "Fluency", moduleId: "part1" },
      { score: 0.6, parameterId: "skill_fluency", parameterName: "Fluency", moduleId: "part2" },
      { score: 0.65, parameterId: "skill_fluency", parameterName: "Fluency", moduleId: "part3" },
    ]);
    const result = await loadPriorCallFeedback(prisma, {
      callerId: CALLER_ID,
      moduleId: "part1",
      now: NOW,
    });
    // moduleSkillScores filter keeps part1; dedupe keeps single row.
    const fluencyRows = result.priorCriterionScores!.filter(
      (s) => s.parameterId === "skill_fluency",
    );
    expect(fluencyRows.length).toBe(1);
  });

  it("returns empty priorCriterionScores when no prior call", async () => {
    const prisma = {
      ...makePrisma([]),
      call: {
        findFirst: vi.fn(async () => null), // no prior call
        findUnique: vi.fn(async () => null),
      },
    } as unknown as Parameters<typeof loadPriorCallFeedback>[0];
    const result = await loadPriorCallFeedback(prisma, {
      callerId: CALLER_ID,
      moduleId: MODULE_ID,
      now: NOW,
    });
    expect(result.hasFeedback).toBe(false);
    expect(result.priorCriterionScores).toBeUndefined();
  });
});
