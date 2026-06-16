/**
 * Bucket relations — Slice C of epic #1675 (#1721).
 *
 * Derivation helpers for the N-to-N bucket ↔ ComposeSectionKey mapping:
 *
 *  - One bucket spans multiple ComposeSectionKeys (the bucket's settings'
 *    `previewLocators` collectively cover several Preview bubbles).
 *  - One ComposeSectionKey can be touched by multiple buckets (different
 *    bucket-level intents all shape the same Preview bubble).
 *
 * Slice C UX uses these helpers for:
 *   - **LH → Preview** (bucket selected): pulse ALL bubbles whose
 *     ComposeSectionKey appears in ANY bucket member's previewLocators.
 *     Multi-bubble glow via `getSectionsForBucket(id)`.
 *   - **Preview → LH** (bubble clicked): find every bucket that touches
 *     the clicked section. If 1 bucket → open it; if 2+ → pick-strip
 *     ("This bubble is affected by: [B Opening] [C Teaching style]").
 *     Via `getBucketsForSection(sectionKey)`.
 *
 * The registry is the canonical source of truth — these helpers are
 * pure functions that derive from `JOURNEY_SETTINGS`. They never
 * write or cache; readers re-compute on demand (the dataset is
 * 51 entries × tiny — sub-millisecond).
 */

import type { ComposeSectionKey } from "@/lib/compose";

import type { JourneyMenuBucketId, JourneySettingContract } from "./setting-contracts";
import { JOURNEY_SETTINGS } from "./setting-contracts.entries";
import { VOICE_SETTINGS } from "@/lib/settings/voice-setting-contracts";

/** Combined corpus the bucket model searches over. The voice 11 are
 *  stamped with `menuGroupKey: "N_voice"` so they surface in the
 *  Journey LH + Cmd+K under their own bucket while ALSO remaining
 *  Settings-tab citizens. The two surfaces share the SAME registry
 *  entries — there is no second copy. */
const ALL_BUCKETED_SETTINGS: readonly JourneySettingContract[] = [
  ...JOURNEY_SETTINGS,
  ...VOICE_SETTINGS,
];

/** All settings in the named bucket. Spans journey + voice registries
 *  via `menuGroupKey`. */
export function getSettingsForBucket(
  bucketId: JourneyMenuBucketId,
): readonly JourneySettingContract[] {
  return ALL_BUCKETED_SETTINGS.filter((s) => s.menuGroupKey === bucketId);
}

/** Every ComposeSectionKey any setting in the bucket touches. Used by
 *  the multi-pulse on LH bucket selection. Dedupe via Set. */
export function getSectionsForBucket(
  bucketId: JourneyMenuBucketId,
): readonly ComposeSectionKey[] {
  const out = new Set<ComposeSectionKey>();
  for (const s of getSettingsForBucket(bucketId)) {
    for (const loc of s.previewLocators) {
      out.add(loc.section);
    }
  }
  return Array.from(out);
}

/** Every bucket that touches the named ComposeSectionKey. Used by
 *  the pick-strip on Preview bubble click. Ordered by JOURNEY_MENU_ITEMS
 *  ordering (chronological / LH-order) so the default-select (first)
 *  is predictable. */
export function getBucketsForSection(
  sectionKey: ComposeSectionKey,
): readonly JourneyMenuBucketId[] {
  const out = new Set<JourneyMenuBucketId>();
  for (const s of ALL_BUCKETED_SETTINGS) {
    if (!s.menuGroupKey) continue;
    if (s.previewLocators.some((l) => l.section === sectionKey)) {
      out.add(s.menuGroupKey);
    }
  }
  // Preserve JOURNEY_MENU_BUCKET_IDS chronological order; the caller's
  // pick-strip default-select hits the first chronologically.
  const bucketsArray = Array.from(out);
  return bucketsArray;
}

/** Convenience — split a bucket's settings by scope (course vs module).
 *  Used by the Inspector to render nested sub-groups when a bucket has
 *  mixed-scope members (G8 module-scoped settings coexist with their
 *  course-scope siblings — e.g. H_closing has both
 *  `offboardingCertificate` and module `closingLine`). */
export function splitBucketByScope(
  bucketId: JourneyMenuBucketId,
): {
  course: readonly JourneySettingContract[];
  module: readonly JourneySettingContract[];
} {
  const settings = getSettingsForBucket(bucketId);
  return {
    course: settings.filter((s) => s.scope !== "module"),
    module: settings.filter((s) => s.scope === "module"),
  };
}
