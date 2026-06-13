/**
 * Tests for `lib/banding/tier-colors.ts` — the shared tier→colour/glyph/label
 * convention consumed by `<TierCell>`, `<BandChip>`, `CohortLearningAggregate`
 * (after migration), and the upcoming Sprint 2/3/4 lenses.
 *
 * Pins three load-bearing properties:
 *
 *   1. Every recognised tier name returns a CSS-token expression (no hex)
 *   2. Unknown tier names fall back to the muted "?" defence-in-depth pair
 *   3. Special states (AWAITING_EVIDENCE, ABOVE_TARGET) have distinct visuals
 *      from any actual tier — educator must be able to distinguish "we don't
 *      know yet" from "bottom tier"
 */

import { describe, it, expect } from "vitest";
import {
  ABOVE_TARGET,
  AWAITING_EVIDENCE,
  tierBackground,
  tierColor,
  tierGlyph,
  tierLabel,
} from "@/lib/banding/tier-colors";

describe("tierColor — returns CSS tokens for every recognised tier", () => {
  const RECOGNISED_TIERS = [
    // 3-tier
    "emerging",
    "developing",
    "secure",
    // CTO 4-tier
    "foundation",
    "practitioner",
    "distinction",
    // CEFR 6-tier
    "a1",
    "a2",
    "b1",
    "b2",
    "c1",
    "c2",
    // Special states
    AWAITING_EVIDENCE,
    ABOVE_TARGET,
  ];

  it.each(RECOGNISED_TIERS)(
    "%s returns a CSS-token expression (no hardcoded hex)",
    (tier) => {
      const color = tierColor(tier);
      expect(color).toMatch(/^(var\(--|color-mix\()/);
      expect(color).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    },
  );

  it("unknown tier falls back to muted text token", () => {
    expect(tierColor("totally-unknown")).toBe("var(--text-muted)");
  });

  it("awaiting_evidence is distinct from any actual tier colour", () => {
    const awaiting = tierColor(AWAITING_EVIDENCE);
    expect(awaiting).toBe("var(--text-muted)");
    // No other named tier maps to plain muted — they're either var(--accent-*) or
    // var(--status-*) or a color-mix expression.
    expect(tierColor("emerging")).not.toBe(awaiting);
    expect(tierColor("foundation")).not.toBe(awaiting);
  });

  it("above_target uses a brighter green than 'distinction' (visually celebratory)", () => {
    const above = tierColor(ABOVE_TARGET);
    expect(above).toMatch(/color-mix.+success-text/);
    expect(above).not.toBe(tierColor("distinction"));
  });
});

describe("tierGlyph — colourblind-safe shape per tier", () => {
  it("awaiting_evidence renders the empty-square glyph", () => {
    expect(tierGlyph(AWAITING_EVIDENCE)).toBe("▢");
  });

  it("above_target renders the upward-arrow glyph", () => {
    expect(tierGlyph(ABOVE_TARGET)).toBe("↑");
  });

  it("each known tier maps to a non-empty glyph", () => {
    const tiers = [
      "emerging",
      "developing",
      "secure",
      "foundation",
      "practitioner",
      "distinction",
      "a1",
      "a2",
      "b1",
      "b2",
      "c1",
      "c2",
    ];
    for (const t of tiers) {
      const g = tierGlyph(t);
      expect(g).toBeTruthy();
      expect(g.length).toBeGreaterThan(0);
      expect(g).not.toBe("?");
    }
  });

  it("unknown tier falls back to '?' (defence-in-depth)", () => {
    expect(tierGlyph("totally-unknown")).toBe("?");
  });
});

describe("tierLabel — display label", () => {
  it("title-cases 3-tier names", () => {
    expect(tierLabel("emerging")).toBe("Emerging");
    expect(tierLabel("developing")).toBe("Developing");
    expect(tierLabel("secure")).toBe("Secure");
  });

  it("title-cases 4-tier CTO names", () => {
    expect(tierLabel("foundation")).toBe("Foundation");
    expect(tierLabel("distinction")).toBe("Distinction");
  });

  it("CEFR codes stay uppercase", () => {
    expect(tierLabel("a1")).toBe("A1");
    expect(tierLabel("b2")).toBe("B2");
    expect(tierLabel("c2")).toBe("C2");
  });

  it("special states have explicit labels", () => {
    expect(tierLabel(AWAITING_EVIDENCE)).toBe("Awaiting evidence");
    expect(tierLabel(ABOVE_TARGET)).toBe("Above target");
  });

  it("empty / nullish tier falls back to 'Unknown'", () => {
    expect(tierLabel("")).toBe("Unknown");
  });
});

describe("tierBackground — wraps tierColor with color-mix() at 12% alpha", () => {
  it("returns a color-mix() expression with 12% alpha against transparent", () => {
    expect(tierBackground("secure")).toContain("color-mix(in srgb");
    expect(tierBackground("secure")).toContain("12%");
    expect(tierBackground("secure")).toContain("transparent");
  });

  it("never contains hardcoded hex", () => {
    for (const t of ["emerging", "developing", "secure", "foundation", "practitioner", "distinction"]) {
      expect(tierBackground(t)).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    }
  });
});
