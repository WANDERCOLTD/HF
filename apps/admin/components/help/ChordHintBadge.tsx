"use client";

import React from "react";
import "./chord-hint-badge.css";
import { useChordContext } from "@/contexts/ChordContext";

/**
 * Transient badge shown while a chord is armed (after H or G, before the
 * second key). Disappears when the chord completes, times out, or resets.
 *
 * Reads both `activePrefix` and `chords` from `ChordContext` (provided
 * globally by `ChordShortcutProvider` in `app/layout.tsx`).
 *
 * Mounted once globally in `app/layout.tsx` alongside `HelpOverlay` (#970).
 * No per-page wiring required — the badge appears anywhere the user is
 * when they arm a chord with H or G.
 */
export function ChordHintBadge(): React.ReactElement | null {
  const { activePrefix, chords } = useChordContext();
  if (!activePrefix) return null;

  const hasChords = chords.length > 0;

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
          {chords.map((c) => (
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
