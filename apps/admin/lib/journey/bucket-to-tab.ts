/**
 * bucket-to-tab — reverse map of `BUCKETS_BY_TAB`.
 *
 * Phase P3b of epic #1850 — cross-tab Inspector hints. When the
 * operator clicks a Preview bubble whose owning bucket lives on a
 * different tab, we need to know which tab owns the bucket so the
 * cross-tab hint card can offer to jump there.
 *
 * Pinned by `tests/lib/journey/bucket-to-tab.test.ts` — every
 * `JourneyMenuBucketId` must resolve to exactly one
 * `CourseDetailTabId`. The vitest fails CI if `BUCKETS_BY_TAB` ever
 * places a bucket on zero / multiple tabs (the source-side invariant
 * is also pinned by `tests/lib/journey/buckets-by-tab.test.ts`, but
 * this reverse map adds defence-in-depth for the consumer path).
 */

import type { JourneyMenuBucketId } from "./setting-contracts";

import {
  BUCKETS_BY_TAB,
  type CourseDetailTabId,
} from "./buckets-by-tab";

/** Materialise once at module load — the source map is `as const`. */
const REVERSE_MAP: ReadonlyMap<JourneyMenuBucketId, CourseDetailTabId> =
  (() => {
    const out = new Map<JourneyMenuBucketId, CourseDetailTabId>();
    for (const [tabId, buckets] of Object.entries(BUCKETS_BY_TAB) as Array<
      [CourseDetailTabId, readonly JourneyMenuBucketId[]]
    >) {
      for (const bucketId of buckets) {
        out.set(bucketId, tabId);
      }
    }
    return out;
  })();

/** Which tab owns the named bucket. Returns `null` only when the
 *  bucket id is unknown — the vitest above proves no live bucket id
 *  hits that branch. */
export function bucketToTab(
  bucketId: JourneyMenuBucketId,
): CourseDetailTabId | null {
  return REVERSE_MAP.get(bucketId) ?? null;
}
