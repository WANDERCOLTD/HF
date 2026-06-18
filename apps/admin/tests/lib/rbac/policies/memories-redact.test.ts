/**
 * #1922 — pin sensitive-field absence at the redacted tier for memories.
 */

import { describe, it, expect } from "vitest";
import { redactMemoriesForTier } from "@/lib/rbac/policies/memories";
import type { MemoriesResponse } from "@/app/api/callers/[callerId]/memories/route";

const RAW: MemoriesResponse = {
  ok: true,
  callerId: "c1",
  memories: [
    {
      id: "m1",
      category: "fact",
      key: "preferred_topic",
      value: "tennis",
      confidence: 0.91,
      evidence: "transcript excerpt with personal context",
      extractedAt: "2026-06-18T12:00:00Z",
      decayFactor: 0.8,
    },
  ],
  summary: {
    factCount: 1,
    preferenceCount: 0,
    eventCount: 0,
    topicCount: 0,
    totalCount: 1,
    lastMemoryAt: "2026-06-18T12:00:00Z",
  },
};

describe("redactMemoriesForTier", () => {
  it("strips confidence + evidence + decayFactor at redacted tier", () => {
    const out = redactMemoriesForTier(RAW, "redacted");
    expect(out.viewerTier).toBe("redacted");
    const mem = (out as { memories: Array<Record<string, unknown>> }).memories[0];
    expect(mem).not.toHaveProperty("confidence");
    expect(mem).not.toHaveProperty("evidence");
    expect(mem).not.toHaveProperty("decayFactor");
    expect(mem.key).toBe("preferred_topic");
    expect(mem.value).toBe("tennis");
  });

  it("passes evidence excerpt through at full tier", () => {
    const out = redactMemoriesForTier(RAW, "full");
    expect(out.viewerTier).toBe("full");
    expect((out as MemoriesResponse).memories[0].evidence).toContain("transcript excerpt");
  });
});
