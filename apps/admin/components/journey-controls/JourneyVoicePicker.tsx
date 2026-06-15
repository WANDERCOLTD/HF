"use client";

import { _FieldShell, _firstCascadeSource } from "./_FieldShell";
import type { JourneyFieldProps } from "./JourneyField";

/** Voice picker primitive — provider + voiceId combo for the Settings
 *  tab. Phase 1 ships the shell; Phase 6 mounts the existing
 *  `VoiceConfigSection` (its autosave loop is untouched per AC risk
 *  note — Phase 1 must not alter VoiceConfigSection). */
export function JourneyVoicePicker({ contract, value }: JourneyFieldProps) {
  const voiceId = typeof value === "string" ? value : "(none)";
  return (
    <_FieldShell
      contract={contract}
      effectiveSource={_firstCascadeSource(contract)}
      isDirty={false}
      isActive={false}
    >
      <div
        className="hf-jf-compound-placeholder"
        data-testid={`hf-jf-voice-${contract.id}`}
      >
        Voice id: <code>{voiceId}</code>
        <div className="hf-jf-help">
          Voice editor mounts in Phase 6 (Settings tab migration —
          wraps existing VoiceConfigSection).
        </div>
      </div>
    </_FieldShell>
  );
}
