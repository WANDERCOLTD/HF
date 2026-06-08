import { describe, it, expect } from "vitest";
import { BAND_MAX, bandColorVar, chartPoints } from "@/lib/band";

describe("bandColorVar", () => {
  it("maps band thresholds to the right tokens", () => {
    expect(bandColorVar(7.5)).toBe("var(--band-high)");
    expect(bandColorVar(6.0)).toBe("var(--band-mid)");
    expect(bandColorVar(4.5)).toBe("var(--band-low)");
    expect(bandColorVar(3.0)).toBe("var(--band-poor)");
  });
});

describe("chartPoints", () => {
  it("returns empty for fewer than two points", () => {
    expect(chartPoints([5])).toBe("");
  });

  it("spreads points evenly across the x-axis", () => {
    const pts = chartPoints([5, 6, 7]).split(" ");
    expect(pts).toHaveLength(3);
    expect(pts[0].startsWith("0,")).toBe(true);
    expect(pts[2].startsWith("100,")).toBe(true);
  });

  it("places the highest value above the lowest (smaller y)", () => {
    const [p0, p1] = chartPoints([5, 6]).split(" ");
    const y0 = Number(p0.split(",")[1]);
    const y1 = Number(p1.split(",")[1]);
    expect(y1).toBeLessThan(y0);
  });

  it("exposes the IELTS max band", () => {
    expect(BAND_MAX).toBe(9);
  });
});
