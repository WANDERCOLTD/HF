"use client";

/**
 * useBubblePulse — Phase 4 Slice B (#1698) + Slice C (#1721) of epic #1675.
 *
 * Slice B mounted single-bubble pulse from a selected setting's first
 * previewLocator. Slice C generalised it to MULTI-bubble pulse from a
 * selected BUCKET — pulses every Preview element whose
 * `data-compose-section` appears in any of the bucket's settings'
 * previewLocators.
 *
 * Reads from the DOM via `data-compose-section` tags emitted by
 * PreviewLens (Slice B groundwork).
 *
 * Cleans up the pulse class on selection change so only the currently-
 * selected bucket's bubbles pulse.
 */

import { useEffect } from "react";

import { getSectionsForBucket } from "@/lib/journey/bucket-relations";
import type { JourneyMenuBucketId } from "@/lib/journey/setting-contracts";

const PULSE_CLASS = "hf-preview-pulse";
const PULSE_MS = 1800;

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
    // viewport position with the others).
    const first = matches[0];
    matches.forEach((el) => el.classList.add(PULSE_CLASS));
    first.scrollIntoView({ behavior: "smooth", block: "center" });

    const timer = window.setTimeout(() => {
      matches.forEach((el) => el.classList.remove(PULSE_CLASS));
    }, PULSE_MS);

    return () => {
      window.clearTimeout(timer);
      matches.forEach((el) => el.classList.remove(PULSE_CLASS));
    };
  }, [selectedBucketId, rootRef]);
}
