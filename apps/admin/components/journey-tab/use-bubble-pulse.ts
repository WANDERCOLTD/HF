"use client";

/**
 * useBubblePulse — Phase 4 Slice B of epic #1675 (#1698).
 *
 * When the Inspector selects a setting, find the matching Preview
 * bubble(s) via `contract.previewLocators[].section` and pulse them
 * + scroll into view. Reads from the DOM via `data-compose-section`
 * tags emitted by PreviewLens (#1698 Slice A — same PR).
 *
 * Cleans up the pulse class on selection change so only the currently-
 * selected setting's bubble pulses.
 *
 * Non-goals (would be Slice B+):
 *   - Bubble → Inspector direction (Phase 4A Slice A already handles
 *     this via `onSelectSection` → CourseJourneyTab.handlePreviewSectionSelect).
 *   - Multi-section setting → pulse ALL matching bubbles (today we
 *     pulse the first locator only; the chip strip below the canvas
 *     summarises the others).
 */

import { useEffect } from "react";

import { JOURNEY_SETTINGS_BY_ID } from "@/lib/journey/setting-contracts.entries";
import { VOICE_SETTINGS_BY_ID } from "@/lib/settings/voice-setting-contracts";

const PULSE_CLASS = "hf-preview-pulse";
const PULSE_MS = 1800;

export function useBubblePulse(
  rootRef: React.RefObject<HTMLElement | null>,
  selectedSettingId: string | null,
): void {
  useEffect(() => {
    if (!selectedSettingId) return;
    const root = rootRef.current;
    if (!root) return;

    const contract =
      JOURNEY_SETTINGS_BY_ID[selectedSettingId] ??
      VOICE_SETTINGS_BY_ID[selectedSettingId];
    if (!contract) return;
    const firstLocator = contract.previewLocators[0];
    if (!firstLocator) return;

    const sel = `[data-compose-section="${firstLocator.section}"]`;
    const matches = root.querySelectorAll<HTMLElement>(sel);
    if (matches.length === 0) return;

    // Pulse the first match + scroll it into view; tag the rest with the
    // class but don't scroll them (avoids fighting for viewport position).
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
  }, [selectedSettingId, rootRef]);
}
