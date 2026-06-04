"use client";

/**
 * Voice Providers admin page (AnyVoice #1031).
 *
 * Standalone route that wraps the shared VoiceProvidersPanel with a page
 * heading. The same panel renders inside `/x/settings#voice_providers`.
 * ADMIN-only — the API enforces auth; this page just renders.
 */

import { VoiceProvidersPanel } from "@/components/settings/VoiceProvidersPanel";

export default function VoiceProvidersPage() {
  return (
    <main className="hf-page">
      <VoiceProvidersPanel showHeading />
    </main>
  );
}
