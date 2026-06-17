/**
 * Pins `bucket-to-tab` — Phase P3b of epic #1850.
 *
 * Invariants:
 *  1. Every `JourneyMenuBucketId` resolves to exactly one tab via
 *     `bucketToTab(bucketId)`.
 *  2. The Modules tab is intentionally excluded from the reverse map
 *     (it has no buckets — per-AuthoredModule scope).
 *  3. The reverse map and the forward `BUCKETS_BY_TAB` are mutual
 *     inverses — applying both round-trips correctly.
 */

import { describe, it, expect } from "vitest";

import {
  BUCKETS_BY_TAB,
  type CourseDetailTabId,
} from "@/lib/journey/buckets-by-tab";
import { bucketToTab } from "@/lib/journey/bucket-to-tab";
import { JOURNEY_MENU_BUCKET_IDS } from "@/lib/journey/menu-items";
import type { JourneyMenuBucketId } from "@/lib/journey/setting-contracts";

describe("bucket-to-tab — reverse map of BUCKETS_BY_TAB", () => {
  it("resolves every JourneyMenuBucketId to a single tab", () => {
    for (const bucketId of JOURNEY_MENU_BUCKET_IDS) {
      const tab = bucketToTab(bucketId);
      expect(tab).not.toBeNull();
    }
  });

  it("does not return the modules tab (modules has no buckets)", () => {
    for (const bucketId of JOURNEY_MENU_BUCKET_IDS) {
      expect(bucketToTab(bucketId)).not.toBe("modules");
    }
  });

  it("round-trips: every (tab → buckets) entry inverts cleanly", () => {
    for (const [tabId, buckets] of Object.entries(BUCKETS_BY_TAB) as Array<
      [CourseDetailTabId, readonly JourneyMenuBucketId[]]
    >) {
      for (const bucketId of buckets) {
        expect(bucketToTab(bucketId)).toBe(tabId);
      }
    }
  });

  it("returns null for an unknown bucket id (defensive)", () => {
    // Force a non-existent id past the type system to confirm the
    // fallback branch is exercised. Real callsites never reach this.
    const fake = "Z_does_not_exist" as JourneyMenuBucketId;
    expect(bucketToTab(fake)).toBeNull();
  });
});
