"use client";

/**
 * PreviewLocatorHint — Phase 4 Slice B of epic #1675 (#1698).
 *
 * Renders a chip strip ABOVE the Preview canvas describing how the
 * selected setting affects the call. Three cases:
 *
 *   1. Setting has no previewLocators (runtime / post-call / scheduling
 *      kinds) → show "Doesn't appear in the call — affects scoring /
 *      runtime / scheduling" caption.
 *   2. Setting's previewLocators reference cross-cutting sections
 *      (behaviorTargets, personality) → show the locator `hint` as a
 *      caption: "Affects how the AI talks across every bubble".
 *   3. Setting maps to single discrete bubbles → handled by the bubble
 *      pulse (see useBubblePulse); this component renders nothing.
 */

import { useMemo } from "react";

import { JOURNEY_SETTINGS_BY_ID } from "@/lib/journey/setting-contracts.entries";
import { VOICE_SETTINGS_BY_ID } from "@/lib/settings/voice-setting-contracts";
import type { ComposeSectionKey } from "@/lib/compose";

/** Sections that don't render as a single Preview bubble — they cross-
 *  cut every bubble (behaviorTargets shapes warmth/length/etc;
 *  personality shapes tone). When the selected setting's primary locator
 *  is one of these, the bubble pulse fails to find a discrete target;
 *  the hint chip explains why. */
const CROSS_CUTTING_SECTIONS: ReadonlySet<ComposeSectionKey> = new Set([
  "behaviorTargets",
  "personality",
  "instructions",
  "modePolicy",
  "firstCallMode",
  "moduleMastery",
  "loMastery",
  "contentTrust",
  "modulesGate",
  "carryOverActions",
  "priorCallFeedback",
  "conversationArtifacts",
  "memoryDeltas",
]);

interface PreviewLocatorHintProps {
  selectedSettingId: string | null;
}

export function PreviewLocatorHint({
  selectedSettingId,
}: PreviewLocatorHintProps) {
  const hintBody = useMemo(() => {
    if (!selectedSettingId) return null;
    const contract =
      JOURNEY_SETTINGS_BY_ID[selectedSettingId] ??
      VOICE_SETTINGS_BY_ID[selectedSettingId];
    if (!contract) return null;

    const locators = contract.previewLocators;
    if (locators.length === 0) {
      // No previewLocators — runtime / post-call / scheduling kinds.
      const kind = contract.composeImpact.kinds[0];
      const label =
        kind === "scoring-weight"
          ? "Affects scoring / mastery — not visible in the call"
          : kind === "sequence-policy"
            ? "Affects module ordering — not visible in the call"
            : kind === "persona-style"
              ? "Affects how the AI talks across every bubble"
              : "Doesn't appear directly in the call";
      return { kind: "no-locator" as const, label };
    }

    const first = locators[0];
    if (CROSS_CUTTING_SECTIONS.has(first.section)) {
      const hint = first.hint ?? "Affects every bubble in the call";
      return { kind: "cross-cutting" as const, label: hint, section: first.section };
    }

    // Discrete bubble locator → useBubblePulse will handle it; render
    // nothing here so the canvas stays clean.
    return null;
  }, [selectedSettingId]);

  if (!hintBody) return null;

  return (
    <div
      className="hf-journey-locator-hint"
      data-testid="hf-journey-locator-hint"
    >
      <span className="hf-journey-locator-hint-chip">
        {hintBody.kind === "cross-cutting" ? hintBody.section : "out-of-call"}
      </span>
      <span>{hintBody.label}</span>
    </div>
  );
}
