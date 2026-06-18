/**
 * #1922 — pin sensitive-field absence at the redacted tier for lo-mastery.
 */

import { describe, it, expect } from "vitest";
import { redactLoMasteryForTier } from "@/lib/rbac/policies/lo-mastery";
import type { LoMasteryResponse } from "@/app/api/callers/[callerId]/lo-mastery/route";

const RAW: LoMasteryResponse = {
  callerId: "c1",
  playbookId: "p1",
  moduleId: "m1",
  moduleSlug: "intro",
  moduleTitle: "Introduction",
  useFreshMastery: false,
  scratchSourceCallId: null,
  learningObjectives: [
    {
      ref: "LO1",
      description: "Demonstrate understanding",
      mastery: 0.72,
      tier: "Practitioner",
      bandLabel: 3,
      masteryThreshold: 0.7,
      status: "mastered",
      updatedAt: "2026-06-18T12:00:00Z",
    },
  ],
};

describe("redactLoMasteryForTier", () => {
  it("strips raw mastery numeric + tier + bandLabel + masteryThreshold at redacted", () => {
    const out = redactLoMasteryForTier(RAW, "redacted");
    expect(out.viewerTier).toBe("redacted");
    const lo = (out as unknown as { learningObjectives: Array<Record<string, unknown>> })
      .learningObjectives[0];
    expect(lo).not.toHaveProperty("mastery");
    expect(lo).not.toHaveProperty("tier");
    expect(lo).not.toHaveProperty("bandLabel");
    expect(lo).not.toHaveProperty("masteryThreshold");
    expect(lo.status).toBe("mastered");
    expect(lo.ref).toBe("LO1");
  });

  it("passes the raw mastery numeric through at full tier", () => {
    const out = redactLoMasteryForTier(RAW, "full");
    expect(out.viewerTier).toBe("full");
    const lo = (out as LoMasteryResponse).learningObjectives[0];
    expect(lo.mastery).toBe(0.72);
    expect(lo.tier).toBe("Practitioner");
  });
});
