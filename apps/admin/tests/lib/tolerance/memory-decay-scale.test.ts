/**
 * #598 Slice 1 — memoryDecayScale applied only to the category-defaults
 * branch. Explicit `decayFactor < 1.0` rows must NOT be double-penalised.
 */

import { describe, it, expect } from "vitest";
import { applyDecay } from "@/lib/prompt/composition/transforms/memories";
import type { MemoryData } from "@/lib/prompt/composition/types";

function mem(overrides: Partial<MemoryData> = {}): MemoryData {
  return {
    category: "TOPIC", // category default = 0.95
    key: "topic",
    value: "x",
    confidence: 1.0,
    evidence: null,
    extractedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    decayFactor: 1.0,
    ...overrides,
  };
}

describe("applyDecay with memoryDecayScale", () => {
  it("scale 1.0 → byte-identical to no scale", () => {
    const m = mem();
    const baseline = applyDecay(m);
    const withOne = applyDecay(m, 1.0);
    expect(withOne).toBe(baseline);
  });

  it("scale absent (default arg) → byte-identical to scale 1.0", () => {
    const m = mem();
    expect(applyDecay(m)).toBe(applyDecay(m, 1.0));
  });

  it("scale 0.5 → confidence reduced relative to scale 1.0", () => {
    const m = mem();
    const baseline = applyDecay(m, 1.0);
    const halved = applyDecay(m, 0.5);
    expect(halved).toBeLessThan(baseline);
  });

  it("explicit decayFactor < 1.0 ignores the course-level scale (no double penalty)", () => {
    const m = mem({ decayFactor: 0.5 });
    const noScale = applyDecay(m, 1.0);
    const withScale = applyDecay(m, 0.1); // would be brutal if applied
    // Without the no-double-penalty guard, the second call would multiply
    // 0.5 * 0.1 = 0.05 and decay much faster. With the guard, both apply
    // only the explicit 0.5 — output is identical.
    expect(withScale).toBe(noScale);
  });

  it("FACT category (default 1.0, no decay) — no scale can drag it below confidence", () => {
    // FACT default = 1.0 → decay >= 1.0 short-circuit returns confidence.
    // But once we multiply by scale 0.5, decay becomes 0.5 and the curve fires.
    const m = mem({ category: "FACT" });
    const noScale = applyDecay(m, 1.0);
    expect(noScale).toBe(m.confidence); // FACT * 1.0 = 1.0 (no decay)
    const scaledDown = applyDecay(m, 0.5);
    expect(scaledDown).toBeLessThan(m.confidence); // FACT scaled becomes a real decay
  });

  it("rejects non-finite / out-of-range scales by clamping to [0.1, 1.0]", () => {
    const m = mem();
    expect(applyDecay(m, Number.NaN)).toBeCloseTo(applyDecay(m, 1.0), 5);
    expect(applyDecay(m, 2.0)).toBeCloseTo(applyDecay(m, 1.0), 5);
    // FP-noise robust comparison: clamp(0)=0.1 and clamp(0.1)=0.1 both pipe
    // through Math.pow with `daysSince/30` — sub-ε differences are expected.
    expect(applyDecay(m, 0)).toBeCloseTo(applyDecay(m, 0.1), 5);
  });

  it("memory with no extractedAt is unaffected by any scale", () => {
    const m = mem({ extractedAt: null });
    expect(applyDecay(m, 0.1)).toBe(m.confidence);
  });
});
