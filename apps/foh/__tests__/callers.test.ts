import { describe, it, expect } from "vitest";
import {
  callerHighlights,
  masteryPct,
  reshapeRoster,
  SAMPLE_ROSTER,
} from "@/lib/callers";

describe("callerHighlights", () => {
  it("aggregates totals and averages", () => {
    const h = callerHighlights(SAMPLE_ROSTER);
    expect(h.totalCallers).toBe(SAMPLE_ROSTER.length);
    expect(h.totalCalls).toBe(SAMPLE_ROSTER.reduce((s, c) => s + c.totalCalls, 0));
    expect(h.avgMasteryPct).toBeGreaterThan(0);
    expect(h.avgMasteryPct).toBeLessThanOrEqual(100);
  });

  it("picks the most active and top-mastery callers", () => {
    const h = callerHighlights(SAMPLE_ROSTER);
    expect(h.mostActive?.name).toBe("Daniel Okonkwo"); // 31 calls
    expect(h.topMastery?.name).toBe("Chloe Bennett"); // 0.89
  });

  it("counts triage-attention callers", () => {
    const h = callerHighlights(SAMPLE_ROSTER);
    expect(h.needsAttention).toBe(
      SAMPLE_ROSTER.filter((c) => c.triage === "attention").length,
    );
  });

  it("degrades safely on an empty roster", () => {
    const h = callerHighlights([]);
    expect(h).toMatchObject({ totalCallers: 0, totalCalls: 0, mostActive: null, topMastery: null });
  });
});

describe("masteryPct", () => {
  it("converts 0–1 mastery to a percentage", () => {
    expect(masteryPct({ ...SAMPLE_ROSTER[0], mastery: 0.82 })).toBe(82);
    expect(masteryPct({ ...SAMPLE_ROSTER[0], mastery: null })).toBe(0);
  });
});

describe("reshapeRoster", () => {
  it("maps HF RosterCaller rows and fills defaults", () => {
    const rows = [{ id: "x", name: "Test", totalCalls: 5, momentum: "steady", triage: "active" }];
    const [c] = reshapeRoster(rows);
    expect(c).toMatchObject({ id: "x", name: "Test", totalCalls: 5, momentum: "steady", triage: "active" });
    expect(c.recentCallDates).toEqual([]);
    expect(c.mastery).toBeNull();
  });

  it("handles an empty/missing roster", () => {
    expect(reshapeRoster([])).toEqual([]);
    expect(reshapeRoster(undefined as any)).toEqual([]);
  });
});
