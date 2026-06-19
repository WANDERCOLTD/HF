/**
 * Behavioural pin for `/api/lab/features/[id]/activate` canonical
 * scaleType resolver (#2031 S5 — sibling fix to #2030).
 *
 * Pre-fix, the route fell back to `param.scaleType || "0-1"` for
 * `scaleType` — silently producing off-canonical rows when the spec
 * supplied an unknown string. The DB has no CHECK constraint on
 * `Parameter.scaleType`; the canonical Set is enforced at CI time
 * only.
 *
 * Post-fix, the route REFUSES to land the Parameter row when the
 * spec supplied a non-null, non-canonical scaleType. When the spec
 * supplied nothing, the canonical seed default (`"0-1"`) is used —
 * because the 154-row canonical registry never declares scaleType,
 * the dominant path is "absent → default", not "present-and-bad".
 *
 * This test pins the canonical-resolver function imported from the
 * shared module at `lib/registry/canonical-scale-type.ts`. It is a
 * unit test of the resolver — a full route-handler test would
 * require mocking Prisma + auth + spec scanning, which is out of
 * proportion for the contract being pinned.
 */

import { describe, it, expect } from "vitest";

import {
  CANONICAL_SCALE_TYPES,
  resolveCanonicalScaleType,
} from "@/lib/registry/canonical-scale-type";

describe("canonical scaleType resolver", () => {
  it("returns the value when paramData.scaleType is canonical", () => {
    expect(resolveCanonicalScaleType({ scaleType: "0-1" })).toBe("0-1");
    expect(resolveCanonicalScaleType({ scaleType: "-1-1" })).toBe("-1-1");
    expect(resolveCanonicalScaleType({ scaleType: "continuous" })).toBe(
      "continuous",
    );
    expect(resolveCanonicalScaleType({ scaleType: "categorical" })).toBe(
      "categorical",
    );
  });

  it("accepts the secondary canonical members (delta + binary)", () => {
    // Both appear in archived seeds + carry valid semantics; keeping
    // them in the canonical set avoids regressing existing rows.
    expect(resolveCanonicalScaleType({ scaleType: "delta" })).toBe("delta");
    expect(resolveCanonicalScaleType({ scaleType: "binary" })).toBe("binary");
  });

  it("returns null when paramData is null (caller must error / default)", () => {
    expect(resolveCanonicalScaleType(null)).toBeNull();
  });

  it("returns null when scaleType is missing (caller must default to canonical seed)", () => {
    // The 154-row canonical registry never declares scaleType, so
    // this is the dominant path. The route MUST supply the canonical
    // seed default ("0-1") rather than skipping.
    expect(resolveCanonicalScaleType({})).toBeNull();
  });

  it("returns null when scaleType is supplied but off-canonical (the bug class)", () => {
    expect(resolveCanonicalScaleType({ scaleType: "ratio" })).toBeNull();
    expect(resolveCanonicalScaleType({ scaleType: "percentage" })).toBeNull();
    expect(resolveCanonicalScaleType({ scaleType: "scale" })).toBeNull();
    expect(resolveCanonicalScaleType({ scaleType: "0-100" })).toBeNull();
  });

  it("returns null for non-string candidates (defends against junk shapes)", () => {
    expect(
      resolveCanonicalScaleType({
        scaleType: 42 as unknown as string,
      }),
    ).toBeNull();
    expect(
      resolveCanonicalScaleType({
        scaleType: { nested: true } as unknown as string,
      }),
    ).toBeNull();
    expect(
      resolveCanonicalScaleType({
        scaleType: ["0-1"] as unknown as string,
      }),
    ).toBeNull();
  });

  it("matches the 6-tuple from the canonical scaleType set", () => {
    // Cross-pin: if the canonical set extends (e.g., #2031 v1.1
    // adds a 7th value), the route's resolver MUST extend in
    // lock-step or sync will start refusing valid rows.
    expect(CANONICAL_SCALE_TYPES.size).toBe(6);
  });
});
