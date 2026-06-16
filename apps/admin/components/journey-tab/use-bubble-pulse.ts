"use client";

/**
 * useBubblePulse — Phase 4 Slice B (#1698) + Slice C (#1721) + Slice C3
 * (#1738 — persistent-while-selected) of epic #1675.
 *
 * Slice B mounted single-bubble pulse from a selected setting's first
 * previewLocator. Slice C generalised it to MULTI-bubble pulse from a
 * selected BUCKET. Slice C3 changed the pulse from a one-shot 1800ms
 * animation to a **persistent visual signal** that holds for the
 * lifetime of the LH selection — operators reported the 1.8s flash
 * was too brief to follow back to the canvas when scanning the LH.
 *
 * Reads from the DOM via `data-compose-section` tags emitted by
 * PreviewLens. Cleans up on selection change so only the currently-
 * selected bucket's bubbles pulse.
 */

import { useEffect } from "react";

import { getSectionsForBucket } from "@/lib/journey/bucket-relations";
import type { JourneyMenuBucketId } from "@/lib/journey/setting-contracts";

const PULSE_CLASS = "hf-preview-pulse";

export function useBubblePulse(
  rootRef: React.RefObject<HTMLElement | null>,
  selectedBucketId: JourneyMenuBucketId | null,
): void {
  useEffect(() => {
    if (!selectedBucketId) return;
    const root = rootRef.current;
    if (!root) return;

    const sections = getSectionsForBucket(selectedBucketId);
    if (sections.length === 0) return;

    const selectors = sections
      .map((s) => `[data-compose-section="${s}"]`)
      .join(", ");
    const matches = root.querySelectorAll<HTMLElement>(selectors);
    if (matches.length === 0) return;

    // Pulse all matches; scroll the first into view (don't fight for
    // viewport position with the others). The class adds an *infinite*
    // CSS animation — see `.hf-preview-pulse` in `journey-tab.css`. The
    // cleanup below removes the class when selection changes / on
    // unmount.
    const first = matches[0];
    matches.forEach((el) => el.classList.add(PULSE_CLASS));
    first.scrollIntoView({ behavior: "smooth", block: "center" });

    return () => {
      matches.forEach((el) => el.classList.remove(PULSE_CLASS));
    };
  }, [selectedBucketId, rootRef]);
}
