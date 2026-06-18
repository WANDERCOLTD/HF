/**
 * #1922 — pin sensitive-field absence at the redacted tier for insights.
 */

import { describe, it, expect } from "vitest";
import { redactInsightsForTier } from "@/lib/rbac/policies/insights";
import type { CallerInsightsResponse } from "@/app/api/callers/[callerId]/insights/route";

const RAW: CallerInsightsResponse = {
  ok: true,
  callerId: "c1",
  momentum: "steady",
  callStreak: 3,
  lastCallDaysAgo: 1,
  totalCalls: 12,
  focusAreas: [
    {
      type: "needs_attention",
      moduleId: "m1",
      moduleName: "Topic Sentences",
      mastery: 0.4,
      reason: "tutor's internal reasoning text",
      recommendation: "suggest 3 practice prompts on transitions",
    },
  ],
  achievements: [
    { icon: "🏆", label: "Streak", value: "3 calls" },
  ],
};

describe("redactInsightsForTier", () => {
  it("strips recommendation + reason from focus areas at redacted", () => {
    const out = redactInsightsForTier(RAW, "redacted");
    expect(out.viewerTier).toBe("redacted");
    const fa = (out as { focusAreas: Array<Record<string, unknown>> }).focusAreas[0];
    expect(fa).not.toHaveProperty("recommendation");
    expect(fa).not.toHaveProperty("reason");
    expect(fa.type).toBe("needs_attention");
    expect(fa.moduleName).toBe("Topic Sentences");
    expect(fa.mastery).toBe(0.4);
  });

  it("achievements pass through unredacted (already learner-facing)", () => {
    const out = redactInsightsForTier(RAW, "redacted");
    expect(out.achievements).toHaveLength(1);
    expect(out.achievements[0].label).toBe("Streak");
  });

  it("passes recommendation through at full tier", () => {
    const out = redactInsightsForTier(RAW, "full");
    expect(out.viewerTier).toBe("full");
    expect((out as CallerInsightsResponse).focusAreas[0].recommendation).toContain("practice");
  });
});
