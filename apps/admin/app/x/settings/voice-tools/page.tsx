"use client";

/**
 * Voice Tools admin page (AnyVoice #1043).
 *
 * Standalone page for the system-wide per-tool enable/disable surface.
 * Toggles write to the TOOLS-001 spec's `enabled` field.
 */

import { VoiceToolsPanel } from "@/components/settings/VoiceToolsPanel";

export default function VoiceToolsPage() {
  return (
    <main className="hf-page">
      <VoiceToolsPanel showHeading />
    </main>
  );
}
