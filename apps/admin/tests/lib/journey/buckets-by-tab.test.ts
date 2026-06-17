/**
 * Pins BUCKETS_BY_TAB — Track C of the Journey-Design tab refactor.
 *
 * Invariants:
 *  1. Every JourneyMenuBucketId appears in EXACTLY one Course Detail tab
 *     (no omissions, no duplicates across tabs).
 *  2. The `modules` tab is intentionally empty — the Modules tab uses a
 *     per-AuthoredModule scope (module picker LH), not bucket-filtered nav.
 *  3. Every non-`modules` tab has at least one bucket — empty tabs would be
 *     a shell with nothing to render.
 *  4. The set of CourseDetailTabIds matches the 5 we expect.
 */

import { describe, it, expect } from "vitest";

import {
  BUCKETS_BY_TAB,
  TAB_LABELS,
  type CourseDetailTabId,
} from "@/lib/journey/buckets-by-tab";
import { JOURNEY_MENU_BUCKET_IDS } from "@/lib/journey/menu-items";
import type { JourneyMenuBucketId } from "@/lib/journey/setting-contracts";

describe("BUCKETS_BY_TAB — Course Detail tab → bucket mapping", () => {
  it("declares exactly the 5 expected tab ids", () => {
    const expected: CourseDetailTabId[] = [
      "journey",
      "teaching",
      "scoring",
      "voice",
      "modules",
    ];
    expect(Object.keys(BUCKETS_BY_TAB).sort()).toEqual(expected.sort());
    expect(Object.keys(TAB_LABELS).sort()).toEqual(expected.sort());
  });

  it("places every JourneyMenuBucketId on exactly one tab (no omissions)", () => {
    const allBuckets = new Set<JourneyMenuBucketId>();
    for (const buckets of Object.values(BUCKETS_BY_TAB)) {
      for (const b of buckets) allBuckets.add(b);
    }
    // Each bucket present
    for (const id of JOURNEY_MENU_BUCKET_IDS) {
      expect(allBuckets.has(id)).toBe(true);
    }
    // No extras (i.e. nothing in BUCKETS_BY_TAB that isn't a real bucket)
    expect(allBuckets.size).toBe(JOURNEY_MENU_BUCKET_IDS.length);
  });

  it("places every JourneyMenuBucketId on exactly one tab (no duplicates)", () => {
    const seen = new Map<JourneyMenuBucketId, CourseDetailTabId>();
    for (const [tabId, buckets] of Object.entries(BUCKETS_BY_TAB) as Array<
      [CourseDetailTabId, readonly JourneyMenuBucketId[]]
    >) {
      for (const b of buckets) {
        if (seen.has(b)) {
          throw new Error(
            `Bucket ${b} appears on both ${seen.get(b)} and ${tabId}`,
          );
        }
        seen.set(b, tabId);
      }
    }
    expect(seen.size).toBe(JOURNEY_MENU_BUCKET_IDS.length);
  });

  it("intentionally leaves the modules tab empty (per-module scope)", () => {
    expect(BUCKETS_BY_TAB.modules).toEqual([]);
  });

  it("gives every non-modules tab at least one bucket", () => {
    for (const [tabId, buckets] of Object.entries(BUCKETS_BY_TAB) as Array<
      [CourseDetailTabId, readonly JourneyMenuBucketId[]]
    >) {
      if (tabId === "modules") continue;
      expect(buckets.length).toBeGreaterThan(0);
    }
  });
});
