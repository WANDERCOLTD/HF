"use client";

import React from "react";
import "./chord-hint-badge.css";

interface ChordHintBadgeProps {
  /** "H" or "G" while a chord is armed; null otherwise. */
  activePrefix: string | null;
}

/**
 * Transient badge shown while a chord is armed (after H or G, before the
 * second key). Disappears when the chord completes, times out, or resets.
 */
export function ChordHintBadge({ activePrefix }: ChordHintBadgeProps): React.ReactElement | null {
  if (!activePrefix) return null;
  return (
    <div className="hf-chord-hint" role="status" aria-live="polite">
      <kbd>{activePrefix}</kbd>
      <span className="hf-chord-hint-sep">·</span>
      <span className="hf-chord-hint-hint">press next key…</span>
    </div>
  );
}
