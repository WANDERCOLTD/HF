/**
 * #1922 — pin sensitive-field absence at the redacted tier for uplift.
 */

import { describe, it, expect } from "vitest";
import {
  redactUpliftForTier,
  type UpliftResponseInput,
} from "@/lib/rbac/policies/uplift";

const RAW: UpliftResponseInput = {
  ok: true,
  uplift: {
    confidencePre: 0.4,
    confidencePost: 0.7,
    confidenceDelta: 0.3,
    testScorePre: 30,
    testScorePost: 70,
    knowledgeDelta: 40,
    overallMastery: 0.65,
    totalCalls: 12,
    firstCallAt: "2026-04-01T00:00:00Z",
    latestCallAt: "2026-06-15T00:00:00Z",
    timeOnPlatformDays: 75,
    moduleProgress: [],
    goals: [],
    scoreTrends: [
      {
        parameterId: "param-1",
        scores: [{ callDate: "2026-06-01T00:00:00Z", score: 0.5, confidence: 0.9 }],
      },
    ],
    adaptationEvidence: [
      {
        parameterName: "Pace",
        parameterType: "behavior",
        sectionId: "S1",
        definition: null,
        defaultValue: 0.5,
        currentValue: 0.7,
        delta: 0.2,
        callsUsed: 5,
        confidence: 0.85,
      },
    ],
    memoryCounts: { facts: 3, preferences: 0, events: 0, topics: 0, total: 3 },
    topTopics: [],
    trustScores: [
      { callId: "call-1", score: 0.6, hasLearnerEvidence: true },
    ],
    trustCalls: [],
    callFrequencyPerWeek: 1.5,
    callDates: [],
  },
};

describe("redactUpliftForTier", () => {
  it("strips scoreTrends[].scores[].confidence at redacted", () => {
    const out = redactUpliftForTier(RAW, "redacted");
    expect(out.viewerTier).toBe("redacted");
    const score = (out as unknown as { uplift: { scoreTrends: Array<{ scores: Array<Record<string, unknown>> }> } })
      .uplift.scoreTrends[0].scores[0];
    expect(score).not.toHaveProperty("confidence");
    expect(score.score).toBe(0.5);
  });

  it("strips adaptationEvidence[].confidence at redacted", () => {
    const out = redactUpliftForTier(RAW, "redacted");
    const adapt = (out as unknown as { uplift: { adaptationEvidence: Array<Record<string, unknown>> } })
      .uplift.adaptationEvidence[0];
    expect(adapt).not.toHaveProperty("confidence");
    expect(adapt.parameterName).toBe("Pace");
    expect(adapt.delta).toBe(0.2);
  });

  it("strips trustScores[].hasLearnerEvidence at redacted", () => {
    const out = redactUpliftForTier(RAW, "redacted");
    const trust = (out as unknown as { uplift: { trustScores: Array<Record<string, unknown>> } })
      .uplift.trustScores[0];
    expect(trust).not.toHaveProperty("hasLearnerEvidence");
    expect(trust.callId).toBe("call-1");
    expect(trust.score).toBe(0.6);
  });

  it("passes all sensitive fields through at full tier", () => {
    const out = redactUpliftForTier(RAW, "full");
    expect(out.viewerTier).toBe("full");
    const full = out as UpliftResponseInput;
    expect(full.uplift.scoreTrends[0].scores[0].confidence).toBe(0.9);
    expect(full.uplift.adaptationEvidence[0].confidence).toBe(0.85);
    expect(full.uplift.trustScores[0].hasLearnerEvidence).toBe(true);
  });
});
