"use client";

import { useEffect } from "react";

import { trackHelpEvent } from "@/lib/help/track-help-event";

/**
 * Client-side mount-fire for the /x/help/demos page's view telemetry.
 * Lives inside the server-rendered page so the page itself stays an RSC.
 *
 * Epic #1442 Layer 3 Slice 3 — #1484. Empty dep array enforces
 * "exactly once on mount" — re-renders never re-fire the event.
 */
export function HelpDemosTelemetry() {
  useEffect(() => {
    trackHelpEvent({ type: "doc-section-view", target: "demos" });
  }, []);
  return null;
}
