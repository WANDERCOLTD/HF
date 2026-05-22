/**
 * #611 Fix C — priorCallFeedback relevance filter regression tests.
 *
 * Asserts that the "weakest area" summary never names a coaching
 * parameter as weakest when the prior CallScore set is mixed
 * (skill_* + coaching params).
 *
 * Strategy under test:
 *   1. If the prior call has any `skill_*` parameters, the weakest pick
 *      MUST come from that subset (skill-domain relevance).
 *   2. If `CallScore.moduleId` matches the current module on any skill
 *      row, prefer those (module-domain relevance).
 *   3. If no skill params exist (pure coaching playbook), fall back to
 *      the full set (legacy behaviour preserved).
 *
 * See: docs/epic-100-chain-walk.md (Link 5 — SCORE → ADAPT)
 *      gh issue view 611 (Symptom 3 — irrelevant param in priorCallFeedback)
 */

import { describe, it, expect, vi } from "vitest";
import { loadPriorCallFeedback } from "@/lib/prompt/composition/loaders/priorCallFeedback";

interface ScoreRow {
  score: number;
  moduleId: string | null;
  parameterId: string;
  parameter: { name: string; parameterId: string } | null;
}

function makePrismaStub(opts: {
  calls: Array<{
    id: string;
    callerId: string;
    curriculumModuleId: string | null;
    createdAt: Date;
  }>;
  scoresByCall: Record<string, ScoreRow[]>;
}) {
  const call = {
    findFirst: vi.fn(async ({ where, orderBy }: any) => {
      let matches = opts.calls.filter((c) => {
        if (where.callerId && c.callerId !== where.callerId) return false;
        if (where.curriculumModuleId && c.curriculumModuleId !== where.curriculumModuleId) return false;
        if (where.id?.not && c.id === where.id.not) return false;
        return true;
      });
      if (orderBy?.createdAt === "desc") {
        matches = matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }
      return matches[0] ?? null;
    }),
  };
  const callScore = {
    findMany: vi.fn(async ({ where }: any) => {
      return opts.scoresByCall[where.callId] ?? [];
    }),
  };
  return { call, callScore } as any;
}

const NOW = new Date("2026-05-22T10:00:00Z");
const yesterday = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);

describe("#611 Fix C — priorCallFeedback weakest-area relevance", () => {
  it("ignores coaching params when picking weakest area on a skill playbook", async () => {
    // Nico Grant evidence shape — coaching params (action_commitment,
    // goal_clarity) scored 0 in the zero-storm; skill params have real
    // band scores. Pre-#611 behaviour picked action_commitment (0.0). The
    // fix must restrict the pick to skill_* params.
    const prisma = makePrismaStub({
      calls: [
        {
          id: "call-prior",
          callerId: "caller-nico",
          curriculumModuleId: "mod-mock",
          createdAt: yesterday,
        },
      ],
      scoresByCall: {
        "call-prior": [
          {
            score: 0,
            moduleId: null,
            parameterId: "action_commitment",
            parameter: { name: "Action Commitment", parameterId: "action_commitment" },
          },
          {
            score: 0,
            moduleId: null,
            parameterId: "goal_clarity",
            parameter: { name: "Goal Clarity", parameterId: "goal_clarity" },
          },
          {
            score: 0.6,
            moduleId: "mod-mock",
            parameterId: "skill_pronunciation",
            parameter: { name: "Pronunciation", parameterId: "skill_pronunciation" },
          },
          {
            score: 0.4,
            moduleId: "mod-mock",
            parameterId: "skill_fluency",
            parameter: { name: "Fluency", parameterId: "skill_fluency" },
          },
        ],
      },
    });

    const result = await loadPriorCallFeedback(prisma, {
      callerId: "caller-nico",
      moduleId: "mod-mock",
      now: NOW,
    });

    expect(result.hasFeedback).toBe(true);
    // Weakest area must be Fluency (skill_, lowest at 0.4), NOT action_commitment (0.0)
    expect(result.weakestParameterName).toBe("Fluency");
    expect(result.weakestParameterScore).toBe(0.4);
    expect(result.summary).toContain("Fluency");
    expect(result.summary).not.toContain("Action Commitment");
    expect(result.summary).not.toContain("Goal Clarity");
  });

  it("prefers module-scoped skill rows when both module-matched and unscoped skill rows exist", async () => {
    const prisma = makePrismaStub({
      calls: [
        {
          id: "call-prior",
          callerId: "c1",
          curriculumModuleId: "mod-active",
          createdAt: yesterday,
        },
      ],
      scoresByCall: {
        "call-prior": [
          // Other-module skill row — lower score, but irrelevant to current module
          {
            score: 0.2,
            moduleId: "mod-other",
            parameterId: "skill_pronunciation",
            parameter: { name: "Pronunciation", parameterId: "skill_pronunciation" },
          },
          // Current-module skill row — higher score but module-relevant
          {
            score: 0.5,
            moduleId: "mod-active",
            parameterId: "skill_fluency",
            parameter: { name: "Fluency", parameterId: "skill_fluency" },
          },
        ],
      },
    });

    const result = await loadPriorCallFeedback(prisma, {
      callerId: "c1",
      moduleId: "mod-active",
      now: NOW,
    });

    // Should pick Fluency (current module) even though Pronunciation has lower score
    expect(result.weakestParameterName).toBe("Fluency");
  });

  it("falls back to all-rows when prior call has no skill_* params (pure coaching playbook)", async () => {
    // Coaching-only playbook — no skill_* rows; legacy behaviour must
    // still work (weakest pick from full set).
    const prisma = makePrismaStub({
      calls: [
        {
          id: "call-prior",
          callerId: "c1",
          curriculumModuleId: "mod-coaching",
          createdAt: yesterday,
        },
      ],
      scoresByCall: {
        "call-prior": [
          {
            score: 0.3,
            moduleId: null,
            parameterId: "action_commitment",
            parameter: { name: "Action Commitment", parameterId: "action_commitment" },
          },
          {
            score: 0.7,
            moduleId: null,
            parameterId: "goal_clarity",
            parameter: { name: "Goal Clarity", parameterId: "goal_clarity" },
          },
        ],
      },
    });

    const result = await loadPriorCallFeedback(prisma, {
      callerId: "c1",
      moduleId: "mod-coaching",
      now: NOW,
    });

    // Legacy behaviour: lowest of the full set
    expect(result.weakestParameterName).toBe("Action Commitment");
  });

  it("computes overallScore across the FULL set, not just relevance candidates", async () => {
    // Defensive contract: overallScore averages everything (it's a
    // session-level snapshot). The relevance filter only affects the
    // weakest-area pick.
    const prisma = makePrismaStub({
      calls: [
        {
          id: "call-prior",
          callerId: "c1",
          curriculumModuleId: "mod-1",
          createdAt: yesterday,
        },
      ],
      scoresByCall: {
        "call-prior": [
          {
            score: 0.0,
            moduleId: null,
            parameterId: "action_commitment",
            parameter: { name: "Action Commitment", parameterId: "action_commitment" },
          },
          {
            score: 1.0,
            moduleId: "mod-1",
            parameterId: "skill_fluency",
            parameter: { name: "Fluency", parameterId: "skill_fluency" },
          },
        ],
      },
    });

    const result = await loadPriorCallFeedback(prisma, {
      callerId: "c1",
      moduleId: "mod-1",
      now: NOW,
    });

    // overall = (0.0 + 1.0) / 2 = 0.5 — includes the coaching row in the average
    expect(result.overallScore).toBeCloseTo(0.5);
    // weakest-area pick = Fluency (only skill row); coaching ignored
    expect(result.weakestParameterName).toBe("Fluency");
  });
});
