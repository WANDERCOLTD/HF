/**
 * #1922 — pin the sensitive-field absence at the redacted tier.
 *
 * Whitelist-default-safe: a new field added to CallerSkillEvidenceItem
 * will NOT auto-flow to the redacted shape unless `skills-evidence.ts`
 * is updated. This test asserts the current sensitive-strip contract.
 */

import { describe, it, expect } from "vitest";
import { redactSkillsEvidenceForTier } from "@/lib/rbac/policies/skills-evidence";
import type { CallerSkillEvidenceResponse } from "@/app/api/callers/[callerId]/skills-evidence/route";

const RAW: CallerSkillEvidenceResponse = {
  callerId: "c1",
  playbookId: "p1",
  limit: 3,
  empty: false,
  rows: [
    {
      skillRef: "SKILL-1",
      parameterId: "param-1",
      parameterName: "Fluency",
      evidence: [
        {
          callId: "call-1",
          measuredAt: "2026-06-18T12:00:00Z",
          score: 0.72,
          confidence: 0.95,
          excerpts: ["learner quote"],
          reasoning: "operator-only rationale text",
          analysisSpecName: "MEASURE-FLUENCY-V1",
          hasLearnerEvidence: true,
          evidenceQuality: 0.8,
          scoredBy: "claude-sonnet-4-6",
        },
      ],
      segments: [],
    },
  ],
};

describe("redactSkillsEvidenceForTier", () => {
  it("strips sensitive fields at the redacted tier", () => {
    const out = redactSkillsEvidenceForTier(RAW, "redacted");
    expect(out.viewerTier).toBe("redacted");
    const item = (out as unknown as { rows: Array<{ evidence: Array<Record<string, unknown>> }> }).rows[0]
      .evidence[0];
    expect(item).not.toHaveProperty("reasoning");
    expect(item).not.toHaveProperty("analysisSpecName");
    expect(item).not.toHaveProperty("evidenceQuality");
    expect(item).not.toHaveProperty("scoredBy");
    expect(item).not.toHaveProperty("confidence");
    expect(item.callId).toBe("call-1");
    expect(item.score).toBe(0.72);
    expect(item.excerpts).toEqual(["learner quote"]);
  });

  it("passes the full payload through at the full tier", () => {
    const out = redactSkillsEvidenceForTier(RAW, "full");
    expect(out.viewerTier).toBe("full");
    const item = (out as CallerSkillEvidenceResponse & { rows: typeof RAW.rows })
      .rows[0].evidence[0];
    expect(item.reasoning).toBe("operator-only rationale text");
    expect(item.confidence).toBe(0.95);
  });

  it("diagnostic tier returns same shape as full", () => {
    const out = redactSkillsEvidenceForTier(RAW, "diagnostic");
    expect(out.viewerTier).toBe("diagnostic");
  });
});
