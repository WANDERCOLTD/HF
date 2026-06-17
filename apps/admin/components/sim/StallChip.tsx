/**
 * #1743 (epic #1700 Theme 2b) — fade-in stall chip shown above SimChat
 * when the client-side stall detector decides the learner has gone quiet.
 *
 * Pure presentational. Renders nothing when `text` is `null`. Styling
 * sits on `hf-stall-chip` (CSS in `app/globals.css`).
 */

"use client";

import React from "react";

interface StallChipProps {
  text: string | null;
}

export function StallChip({ text }: StallChipProps): React.ReactElement | null {
  if (!text) return null;
  return (
    <div
      className="hf-stall-chip"
      role="status"
      aria-live="polite"
      data-testid="stall-chip"
    >
      {text}
    </div>
  );
}
