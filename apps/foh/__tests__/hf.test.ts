import { describe, it, expect } from "vitest";
import { reshapeReadiness } from "@/lib/hf";

// Captured from a real GET https://dev.humanfirstfoundation.com/api/system/readiness
const SAMPLE = {
  ok: true,
  ready: true,
  stats: { totalCallers: 88, totalCalls: 148, totalMemories: 503, analyzedCalls: 77, callersWithPrompts: 0 },
  sources: {
    knowledge: { status: "red", count: 0, label: "Knowledge Docs", link: "/knowledge-docs" },
    transcripts: { status: "amber", count: 0, label: "Processed Files", link: "/transcripts" },
    callers: { status: "green", count: 88, label: "Callers", link: "/callers" },
  },
  timestamp: "2026-06-08T11:05:03.959Z",
};

describe("reshapeReadiness", () => {
  it("maps HF stats into the view model", () => {
    const v = reshapeReadiness(SAMPLE, "https://dev.humanfirstfoundation.com");
    expect(v.connected).toBe(true);
    expect(v.ready).toBe(true);
    expect(v.stats).toEqual({ callers: 88, calls: 148, memories: 503, analyzedCalls: 77 });
    expect(v.hfTimestamp).toBe("2026-06-08T11:05:03.959Z");
  });

  it("flattens the sources map into a typed array", () => {
    const v = reshapeReadiness(SAMPLE, "x");
    const callers = v.sources.find((s) => s.key === "callers");
    expect(callers).toEqual({ key: "callers", label: "Callers", status: "green", count: 88 });
    expect(v.sources).toHaveLength(3);
  });

  it("degrades safely on an empty payload", () => {
    const v = reshapeReadiness({}, "x");
    expect(v.stats).toEqual({ callers: 0, calls: 0, memories: 0, analyzedCalls: 0 });
    expect(v.sources).toEqual([]);
  });
});
