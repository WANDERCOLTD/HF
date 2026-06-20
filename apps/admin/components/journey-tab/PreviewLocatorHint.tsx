"use client";

/**
 * PreviewLocatorHint — Slice B (#1698) + Slice C (#1721).
 *
 * Two responsibilities:
 *
 * 1. **Bucket-selected hint chip** — when a bucket is selected and any of
 *    its settings are cross-cutting (no discrete Preview bubble), render
 *    an explanatory chip above the canvas. Slice B handled the
 *    single-setting case; Slice C extends to a bucket's worth of
 *    settings.
 *
 * 2. **Bubble-click pick-strip (Slice C)** — when a Preview bubble is
 *    clicked and 2+ buckets touch the bubble's section, render a small
 *    chip strip: "This bubble is affected by: [B Opening] [C Teaching
 *    style] [F Stall]". Click a chip → switch the LH selection to that
 *    bucket. Default-select (the LH-chronological first) auto-applies
 *    before the strip appears, so the strip is a "choose differently"
 *    affordance, not a "must choose" gate.
 */

import { useMemo } from "react";

import type { ComposeSectionKey } from "@/lib/compose";
import {
  CROSS_CUTTING_SECTIONS,
  getBucketsForSection,
  getSettingsForBucket,
} from "@/lib/journey/bucket-relations";
import { JOURNEY_MENU_ITEMS_BY_ID } from "@/lib/journey/menu-items";
import type { JourneyMenuBucketId } from "@/lib/journey/setting-contracts";

interface PreviewLocatorHintProps {
  selectedBucketId: JourneyMenuBucketId | null;
  /** When the user just clicked a Preview bubble, the bubble's section
   *  is passed here. When 2+ buckets touch it, render the pick-strip. */
  pickStripSection?: ComposeSectionKey | null;
  /** Click handler — switches LH selection. */
  onSelectBucket: (id: JourneyMenuBucketId) => void;
}

export function PreviewLocatorHint({
  selectedBucketId,
  pickStripSection,
  onSelectBucket,
}: PreviewLocatorHintProps) {
  const pickStripBuckets = useMemo(() => {
    if (!pickStripSection) return [];
    return getBucketsForSection(pickStripSection);
  }, [pickStripSection]);

  const crossCuttingHint = useMemo(() => {
    if (!selectedBucketId) return null;
    const settings = getSettingsForBucket(selectedBucketId);
    if (settings.length === 0) return null;
    // Look for any cross-cutting locator in the bucket's settings.
    for (const s of settings) {
      for (const loc of s.previewLocators) {
        if (CROSS_CUTTING_SECTIONS.has(loc.section)) {
          return loc.hint ?? "Affects every bubble in the call";
        }
      }
    }
    return null;
  }, [selectedBucketId]);

  // Pick-strip wins when both could render — bubble click is the more
  // recent user intent.
  if (pickStripBuckets.length >= 2) {
    return (
      <div
        className="hf-journey-locator-hint hf-journey-pick-strip"
        data-testid="hf-journey-pick-strip"
        role="toolbar"
        aria-label="Buckets affecting this bubble"
      >
        <span className="hf-journey-locator-hint-chip">affects</span>
        <span>This bubble is affected by:</span>
        {pickStripBuckets.slice(0, 3).map((bid) => {
          const bucket = JOURNEY_MENU_ITEMS_BY_ID[bid];
          return (
            <button
              key={bid}
              type="button"
              className={`hf-chip ${selectedBucketId === bid ? "hf-chip-selected" : ""}`}
              onClick={() => onSelectBucket(bid)}
              data-testid={`hf-journey-pick-chip-${bid}`}
            >
              {bucket.label}
            </button>
          );
        })}
        {pickStripBuckets.length > 3 ? (
          <span className="hf-journey-pick-overflow">
            +{pickStripBuckets.length - 3} more
          </span>
        ) : null}
      </div>
    );
  }

  if (crossCuttingHint) {
    return (
      <div
        className="hf-journey-locator-hint"
        data-testid="hf-journey-locator-hint"
      >
        <span className="hf-journey-locator-hint-chip">cross-cutting</span>
        <span>{crossCuttingHint}</span>
      </div>
    );
  }

  return null;
}
