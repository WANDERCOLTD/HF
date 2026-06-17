/**
 * Tests for `lib/banding/presets.ts` — the per-playbook tier-mapping presets
 * consumed by `BandingPicker.tsx` and `scoreToTier()`.
 *
 * Structural coverage (registry-options-coverage) already pins that every
 * preset's `value` is a member of the canonical set. These tests pin the
 * BEHAVIOURAL invariants the structural gate can't see:
 *
 *   1. `getPreset()` resolution semantics — known id, unknown id, nullish
 *      all funnel to a defined preset (Generic 4-tier is the documented
 *      default, #1657).
 *   2. Every preset exposes the four fixed threshold slots `scoreToTier`
 *      indexes by, in strictly ascending order with `secure === 1.0`.
 *   3. Framework presets (IELTS / CEFR / 5-level) carry native `tierLabels`
 *      so a CEFR course renders "B1" not "Developing"; the neutral presets
 *      (generic / source-derived / custom) intentionally do not.
 */

import { describe, it, expect } from "vitest";
import { TIER_PRESETS, getPreset, type TierPresetId } from "@/lib/banding/presets";

const SLOTS = ["approachingEmerging", "emerging", "developing", "secure"] as const;

describe("getPreset", () => {
  it("resolves a known preset id to its own entry", () => {
    expect(getPreset("ielts-speaking").id).toBe("ielts-speaking");
    expect(getPreset("cefr").id).toBe("cefr");
  });

  it("falls back to Generic 4-tier for an unknown id", () => {
    expect(getPreset("not-a-real-preset").id).toBe("generic");
  });

  it("falls back to Generic 4-tier for nullish input", () => {
    expect(getPreset(undefined).id).toBe("generic");
    expect(getPreset(null).id).toBe("generic");
    expect(getPreset("").id).toBe("generic");
  });

  it("never returns undefined for any input", () => {
    for (const id of [undefined, null, "", "garbage", "generic", "cefr"]) {
      expect(getPreset(id as TierPresetId)).toBeDefined();
    }
  });
});

describe("TIER_PRESETS threshold invariants", () => {
  const ids = Object.keys(TIER_PRESETS) as TierPresetId[];

  it.each(ids)("%s exposes all four fixed threshold + band slots", (id) => {
    const { thresholds, tierBands } = TIER_PRESETS[id].mapping;
    for (const slot of SLOTS) {
      expect(thresholds[slot]).toBeTypeOf("number");
      expect(tierBands?.[slot]).toBeTypeOf("number");
    }
  });

  it.each(ids)("%s has strictly ascending thresholds topping out at 1.0", (id) => {
    const t = TIER_PRESETS[id].mapping.thresholds;
    expect(t.approachingEmerging).toBeLessThan(t.emerging);
    expect(t.emerging).toBeLessThan(t.developing);
    expect(t.developing).toBeLessThan(t.secure);
    expect(t.secure).toBe(1.0);
  });

  it("each preset's id matches its map key (no copy-paste drift)", () => {
    for (const id of ids) {
      expect(TIER_PRESETS[id].id).toBe(id);
    }
  });
});

describe("TIER_PRESETS tierLabels", () => {
  it("framework presets carry native tier labels", () => {
    expect(TIER_PRESETS["ielts-speaking"].tierLabels?.secure).toBe("Band 7");
    expect(TIER_PRESETS.cefr.tierLabels?.emerging).toBe("B1");
    expect(TIER_PRESETS["5-level"].tierLabels?.approachingEmerging).toBe("Novice");
  });

  it("neutral presets intentionally omit tierLabels (fall back to default names)", () => {
    expect(TIER_PRESETS.generic.tierLabels).toBeUndefined();
    expect(TIER_PRESETS["source-derived"].tierLabels).toBeUndefined();
    expect(TIER_PRESETS.custom.tierLabels).toBeUndefined();
  });

  it("when present, tierLabels cover all four slots", () => {
    for (const id of Object.keys(TIER_PRESETS) as TierPresetId[]) {
      const labels = TIER_PRESETS[id].tierLabels;
      if (!labels) continue;
      for (const slot of SLOTS) {
        expect(labels[slot]).toBeTruthy();
      }
    }
  });
});
