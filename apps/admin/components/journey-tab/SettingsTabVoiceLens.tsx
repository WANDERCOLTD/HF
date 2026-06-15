"use client";

/**
 * SettingsTabVoiceLens — Phase 6 of epic #1675 (#1708).
 *
 * Voice settings lens for the Settings tab. Wraps the existing
 * `VoiceConfigSection` zero-change (per Tech Lead's "wrap-only"
 * constraint flagged in the Phase 1 reuse audit).
 *
 * Replaces the legacy Design-tab `VoiceFlowLens` (deleted in this PR)
 * and consolidates the voice editing surface in one place.
 *
 * VoiceConfigSection has its own cascade-aware save loop (its own
 * `/api/voice-providers/...` PATCH route). It's the canonical voice
 * editor; this lens just provides a header + retirement breadcrumb
 * so educators landing here recognise the move from Design > Voice
 * Flow.
 */

import { VoiceConfigSection } from "@/components/voice/VoiceConfigSection";

interface SettingsTabVoiceLensProps {
  courseId: string;
}

export function SettingsTabVoiceLens({ courseId }: SettingsTabVoiceLensProps) {
  return (
    <div
      className="hf-card hf-stack-md"
      data-testid="hf-settings-voice-lens"
    >
      <div className="hf-stack-xs">
        <h3 className="hf-section-title">Voice & calls</h3>
        <p className="hf-section-desc">
          Provider, voice, transcriber, timeouts, and cost cap for this
          course. Previously lived on Design &gt; Voice Flow.
        </p>
      </div>
      <VoiceConfigSection scope="course" scopeId={courseId} />
    </div>
  );
}
