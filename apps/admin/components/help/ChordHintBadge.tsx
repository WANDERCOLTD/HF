"use client";

import React from "react";
import "./chord-hint-badge.css";
import type { ChordBinding } from "@/lib/help/page-help";

interface ChordHintBadgeProps {
  /** "H" or "G" while a chord is armed; null otherwise. */
  activePrefix: string | null;
  /**
   * #752 — optional list of available chord bindings at the current location.
   * When provided, the badge renders each `[letter] — label` so users can
   * discover what's reachable. When omitted (back-compat for callers not yet
   * wired), falls back to the original "press next key…" hint.
   */
  chords?: readonly ChordBinding[];
}

/**
 * Transient badge shown while a chord is armed (after H or G, before the
 * second key). Disappears when the chord completes, times out, or resets.
 *
 * When `chords` is provided, shows the available follow-up letters as a
 * discoverable list — replaces the "press next key…" fallback.
 */
export function ChordHintBadge({
  activePrefix,
  chords,
}: ChordHintBadgeProps): React.ReactElement | null {
  if (!activePrefix) return null;

  const hasChords = chords && chords.length > 0;

  return (
    <div className="hf-chord-hint" role="status" aria-live="polite">
      <div className="hf-chord-hint-row">
        <kbd>{activePrefix}</kbd>
        <span className="hf-chord-hint-sep">·</span>
        {hasChords ? (
          <span className="hf-chord-hint-hint">press next key — or:</span>
        ) : (
          <span className="hf-chord-hint-hint">press next key…</span>
        )}
      </div>
      {hasChords && (
        <dl className="hf-chord-hint-list">
          {chords!.map((c) => (
            <div className="hf-chord-hint-item" key={c.keys}>
              <dt>
                <kbd>{c.keys}</kbd>
              </dt>
              <dd>{c.label}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
