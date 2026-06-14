/**
 * Round-trip pin for #1657 — the IELTS → Generic 4-tier SYSTEM-default flip.
 *
 * Together with `skill-tier-mapping.test.ts`, these vitests assert that:
 *   1. `getPreset(null)` returns the new Generic preset (not IELTS).
 *   2. `getPreset("ielts-speaking")` returns the IELTS preset with bands 3/4/5.5/7.
 *   3. `scoreToTier` with no mapping arg produces Generic bands.
 *   4. `scoreToTier` with the IELTS preset mapping produces IELTS bands.
 *   5. The Custom preset seed is no longer IELTS-shaped.
 *   6. Every preset's mapping is internally consistent (thresholds + tierBands shape).
 */

import { describe, it, expect } from "vitest";
import { TIER_PRESETS, getPreset } from "@/lib/banding/presets";
import { scoreToTier } from "@/lib/goals/track-progress";

describe("#1657 — IELTS → Generic SYSTEM-default flip", () => {
  it("getPreset(null) returns the Generic 4-tier preset", () => {
    const p = getPreset(null);
    expect(p.id).toBe("generic");
    expect(p.label).toContain("Generic");
    expect(p.mapping.tierBands.secure).toBe(4);
    expect(p.mapping.tierBands.approachingEmerging).toBe(1);
  });

  it("getPreset(undefined) returns Generic", () => {
    expect(getPreset(undefined).id).toBe("generic");
  });

  it("getPreset('unknown-string') falls back to Generic, not IELTS", () => {
    expect(getPreset("does-not-exist").id).toBe("generic");
  });

  it("IELTS Speaking preset still carries IELTS bands 3/4/5.5/7", () => {
    const p = TIER_PRESETS["ielts-speaking"];
    expect(p.mapping.tierBands.approachingEmerging).toBe(3);
    expect(p.mapping.tierBands.emerging).toBe(4);
    expect(p.mapping.tierBands.developing).toBe(5.5);
    expect(p.mapping.tierBands.secure).toBe(7);
  });

  it("IELTS Speaking preset has explicit 'Band X' tier labels", () => {
    const p = TIER_PRESETS["ielts-speaking"];
    expect(p.tierLabels?.secure).toBe("Band 7");
    expect(p.tierLabels?.approachingEmerging).toBe("Band 3");
  });

  it("Custom preset seed is Generic-shaped (no longer IELTS)", () => {
    const p = TIER_PRESETS.custom;
    expect(p.mapping.tierBands.secure).toBe(4);
    expect(p.mapping.thresholds.emerging).toBe(0.5);
  });

  it("scoreToTier(0.99) with no mapping arg returns Generic band 4", () => {
    const r = scoreToTier(0.99);
    expect(r.band).toBe(4);
    expect(r.tier).toBe("Secure");
  });

  it("scoreToTier(0.99, IELTS mapping) returns IELTS band 7", () => {
    const r = scoreToTier(0.99, TIER_PRESETS["ielts-speaking"].mapping);
    expect(r.band).toBe(7);
    expect(r.tier).toBe("Secure");
  });

  it("scoreToTier(0.4) with no mapping arg sits in Generic emerging tier (band 2)", () => {
    const r = scoreToTier(0.4);
    expect(r.band).toBe(2);
    expect(r.tier).toBe("Emerging");
  });

  it("scoreToTier(0.1) with no mapping arg sits below Generic approachingEmerging (band 1)", () => {
    const r = scoreToTier(0.1);
    expect(r.band).toBe(1);
  });

  it("every preset has the four tier slots populated for thresholds + tierBands", () => {
    for (const id of Object.keys(TIER_PRESETS) as (keyof typeof TIER_PRESETS)[]) {
      const p = TIER_PRESETS[id];
      const t = p.mapping.thresholds;
      const b = p.mapping.tierBands;
      expect(typeof t.approachingEmerging).toBe("number");
      expect(typeof t.emerging).toBe("number");
      expect(typeof t.developing).toBe("number");
      expect(typeof t.secure).toBe("number");
      expect(typeof b.approachingEmerging).toBe("number");
      expect(typeof b.emerging).toBe("number");
      expect(typeof b.developing).toBe("number");
      expect(typeof b.secure).toBe("number");
    }
  });
});
