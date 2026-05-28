import { describe, it, expect } from "vitest";
import {
  directionOf,
  colorVarForDirection,
  classForDirection,
} from "@/lib/caller-insights/direction";

describe("directionOf — single delta", () => {
  it("classifies signed numbers", () => {
    expect(directionOf(0.5)).toBe("up");
    expect(directionOf(-0.5)).toBe("down");
    expect(directionOf(0)).toBe("neutral");
  });

  it("honours threshold so micro-deltas stay neutral", () => {
    expect(directionOf(0.01, 0.05)).toBe("neutral");
    expect(directionOf(0.06, 0.05)).toBe("up");
    expect(directionOf(-0.06, 0.05)).toBe("down");
  });

  it("treats null / undefined / NaN as neutral", () => {
    expect(directionOf(null)).toBe("neutral");
    expect(directionOf(undefined)).toBe("neutral");
    expect(directionOf(NaN)).toBe("neutral");
  });
});

describe("directionOf — trend mode (split-half)", () => {
  it("returns neutral for fewer than 3 scores", () => {
    expect(directionOf([{ score: 0.1 }, { score: 0.9 }], "trend")).toBe("neutral");
  });

  it("classifies a rising trend", () => {
    const scores = [{ score: 0.2 }, { score: 0.3 }, { score: 0.7 }, { score: 0.9 }];
    expect(directionOf(scores, "trend")).toBe("up");
  });

  it("classifies a falling trend", () => {
    const scores = [{ score: 0.9 }, { score: 0.8 }, { score: 0.3 }, { score: 0.2 }];
    expect(directionOf(scores, "trend")).toBe("down");
  });

  it("returns neutral within threshold band", () => {
    const flat = [{ score: 0.5 }, { score: 0.5 }, { score: 0.5 }, { score: 0.5 }];
    expect(directionOf(flat, "trend")).toBe("neutral");
  });
});

describe("colorVarForDirection / classForDirection", () => {
  it("maps direction → css var", () => {
    expect(colorVarForDirection("up")).toBe("var(--status-success-text)");
    expect(colorVarForDirection("down")).toBe("var(--status-error-text)");
    expect(colorVarForDirection("neutral")).toBe("var(--text-muted)");
  });

  it("maps direction → class suffix", () => {
    expect(classForDirection("up")).toBe("hf-direction-up");
    expect(classForDirection("down")).toBe("hf-direction-down");
    expect(classForDirection("neutral")).toBe("hf-direction-neutral");
  });
});
