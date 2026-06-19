/**
 * Behavioural pin for `/api/lab/features/[id]/activate` canonical
 * directionality resolver (#2031 S5 — sibling fix to #2030).
 *
 * Pre-fix, the route fell back to `param.directionality || "positive"`
 * for `directionality` — silently producing off-canonical rows when
 * the spec supplied an unknown string. The DB has no CHECK constraint
 * on `Parameter.directionality`; the canonical Set is enforced at CI
 * time only.
 *
 * Post-fix, the route REFUSES to land the Parameter row when the spec
 * supplied a non-null, non-canonical directionality. When the spec
 * supplied nothing, the canonical seed default (`"positive"`) is used.
 *
 * This test pins the canonical-resolver function imported from the
 * shared module at `lib/registry/canonical-directionality.ts`.
 */

import { describe, it, expect } from "vitest";

import {
  CANONICAL_DIRECTIONALITIES,
  resolveCanonicalDirectionality,
} from "@/lib/registry/canonical-directionality";

describe("canonical directionality resolver", () => {
  it("returns the value when paramData.directionality is canonical", () => {
    expect(
      resolveCanonicalDirectionality({ directionality: "positive" }),
    ).toBe("positive");
    expect(
      resolveCanonicalDirectionality({ directionality: "negative" }),
    ).toBe("negative");
    expect(
      resolveCanonicalDirectionality({ directionality: "bidirectional" }),
    ).toBe("bidirectional");
    expect(
      resolveCanonicalDirectionality({ directionality: "neutral" }),
    ).toBe("neutral");
  });

  it("returns null when paramData is null", () => {
    expect(resolveCanonicalDirectionality(null)).toBeNull();
  });

  it("returns null when directionality is missing (caller must default to canonical seed)", () => {
    // The 154-row canonical registry never declares directionality,
    // so this is the dominant path. The route MUST supply the
    // canonical seed default ("positive") rather than skipping.
    expect(resolveCanonicalDirectionality({})).toBeNull();
  });

  it("returns null when directionality is supplied but off-canonical (the bug class)", () => {
    expect(
      resolveCanonicalDirectionality({ directionality: "higher_better" }),
    ).toBeNull();
    expect(
      resolveCanonicalDirectionality({ directionality: "adaptive" }),
    ).toBeNull();
    expect(
      resolveCanonicalDirectionality({ directionality: "lower_better" }),
    ).toBeNull();
  });

  it("returns null for SCREAMING_SNAKE variants (archived-seed-only — must normalise at seed boundary)", () => {
    // POSITIVE / NEUTRAL / NEGATIVE / ADAPTIVE appear in archived
    // seeds. The runtime resolver MUST refuse them so they get
    // normalised at the seed boundary, not at the lab-activate
    // boundary.
    expect(
      resolveCanonicalDirectionality({ directionality: "POSITIVE" }),
    ).toBeNull();
    expect(
      resolveCanonicalDirectionality({ directionality: "NEUTRAL" }),
    ).toBeNull();
    expect(
      resolveCanonicalDirectionality({ directionality: "NEGATIVE" }),
    ).toBeNull();
    expect(
      resolveCanonicalDirectionality({ directionality: "ADAPTIVE" }),
    ).toBeNull();
  });

  it("returns null for non-string candidates (defends against junk shapes)", () => {
    expect(
      resolveCanonicalDirectionality({
        directionality: 1 as unknown as string,
      }),
    ).toBeNull();
    expect(
      resolveCanonicalDirectionality({
        directionality: { nested: true } as unknown as string,
      }),
    ).toBeNull();
  });

  it("matches the 4-tuple from the canonical directionality set", () => {
    // Cross-pin: if the canonical set extends, the route's resolver
    // MUST extend in lock-step.
    expect(CANONICAL_DIRECTIONALITIES.size).toBe(4);
  });
});
