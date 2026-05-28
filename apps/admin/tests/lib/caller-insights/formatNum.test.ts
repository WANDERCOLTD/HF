import { describe, it, expect } from "vitest";
import { pct, fraction, count, delta } from "@/lib/caller-insights/formatNum";

describe("formatNum.pct", () => {
  it("rounds ratio to integer percent", () => {
    expect(pct(0.852)).toBe("85%");
    expect(pct(1)).toBe("100%");
    expect(pct(0)).toBe("0%");
  });

  it("returns — for null / undefined / NaN", () => {
    expect(pct(null)).toBe("—");
    expect(pct(undefined)).toBe("—");
    expect(pct(NaN)).toBe("—");
  });
});

describe("formatNum.fraction", () => {
  it("formats with given scale and default 1 decimal", () => {
    expect(fraction(4.21, 5)).toBe("4.2/5");
    expect(fraction(3, 5)).toBe("3.0/5");
  });

  it("honours decimals override", () => {
    expect(fraction(4.211, 5, 2)).toBe("4.21/5");
  });

  it("returns — for missing", () => {
    expect(fraction(null, 5)).toBe("—");
    expect(fraction(NaN, 5)).toBe("—");
  });
});

describe("formatNum.count", () => {
  it("appends unit when given", () => {
    expect(count(12, "calls")).toBe("12 calls");
    expect(count(47, "days")).toBe("47 days");
  });

  it("rounds and stringifies without unit", () => {
    expect(count(12.4)).toBe("12");
    expect(count(0)).toBe("0");
  });

  it("returns — for missing", () => {
    expect(count(null, "calls")).toBe("—");
    expect(count(undefined)).toBe("—");
  });
});

describe("formatNum.delta", () => {
  it("kind=pp rounds to integer pp with sign", () => {
    expect(delta(0.12, "pp")).toBe("+12pp");
    expect(delta(-0.05, "pp")).toBe("-5pp");
    expect(delta(0, "pp")).toBe("0pp");
  });

  it("kind=abs gives 2-decimal signed", () => {
    expect(delta(0.35, "abs")).toBe("+0.35");
    expect(delta(-0.3, "abs")).toBe("-0.30");
    expect(delta(0)).toBe("0.00");
  });

  it("kind=count gives integer signed with optional unit", () => {
    expect(delta(3, "count", "calls")).toBe("+3 calls");
    expect(delta(-2, "count")).toBe("-2");
  });

  it("returns — for missing", () => {
    expect(delta(null, "pp")).toBe("—");
    expect(delta(NaN, "abs")).toBe("—");
  });
});
