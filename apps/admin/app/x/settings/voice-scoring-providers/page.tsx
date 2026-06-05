"use client";

/**
 * Voice Scoring Providers admin page (#1118).
 *
 * Standalone route that wraps the shared VoiceScoringProvidersPanel with
 * a page heading. The same panel renders inside
 * /x/settings#voice_scoring_providers. ADMIN-only — the API enforces auth;
 * this page just renders.
 */

import { VoiceScoringProvidersPanel } from "@/components/settings/VoiceScoringProvidersPanel";

export default function VoiceScoringProvidersPage() {
  return (
    <main className="hf-page">
      <VoiceScoringProvidersPanel showHeading />
    </main>
  );
}
