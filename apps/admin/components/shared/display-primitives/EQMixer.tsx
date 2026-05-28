"use client";

import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Tooltip } from "@/components/shared/Tooltip";
import { DeltaPill } from "./DeltaPill";
import {
  directionOf,
  classForDirection,
} from "@/lib/caller-insights/direction";

export type EQTrack = {
  /** Stable key. */
  id: string;
  /** Display name (jargon is OK — definition surfaces on hover). */
  label: string;
  /** Current value 0–1. */
  current: number;
  /** System default value 0–1. */
  default: number;
  /** Optional plain-English definition for the hover tooltip. */
  definition?: string;
};

export type EQBand = {
  /** Stable key, e.g. "BEHAVIOUR" / "SKILL" / "OTHER". */
  id: string;
  /** Band display label. */
  label: string;
  /** Tracks belonging to this band. */
  tracks: EQTrack[];
};

type EQMixerProps = {
  bands: EQBand[];
  /** Render height per track (drives vertical slider height). Default 100. */
  trackHeight?: number;
  /** Render width per track. Default 24. */
  trackWidth?: number;
};

/**
 * Vertical-slider grid for many same-scale parameters (>8). Each track shows
 * a system-default tick and a current-value dot. Tracks group into bands
 * with collapse/expand. Band with the largest |delta| auto-expands.
 *
 * Tooltip per track surfaces a glossary definition. CSS classes only —
 * positions of dot / tick are the only inline styles (legitimately dynamic).
 *
 * Empty bands render an empty state and self-hide.
 */
export function EQMixer({
  bands,
  trackHeight = 100,
  trackWidth = 24,
}: EQMixerProps): React.ReactElement {
  const total = bands.reduce((s, b) => s + b.tracks.length, 0);

  // Auto-expand the band with the largest absolute delta. Hooks must run on
  // every render — the empty-state early return below must NOT precede this.
  const loudestBandId = pickLoudestBand(bands);
  const [openBands, setOpenBands] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(bands.map((b) => [b.id, b.id === loudestBandId])),
  );

  if (total === 0) {
    return (
      <div className="hf-eq-mixer-empty" role="status">
        No adaptations yet — system is using course defaults.
      </div>
    );
  }

  const toggleBand = (id: string): void => {
    setOpenBands((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="hf-eq-mixer">
      {bands.map((band) => {
        const open = openBands[band.id];
        const direction = directionOf(bandTotalDelta(band));
        return (
          <div
            key={band.id}
            className={`hf-eq-mixer-band ${classForDirection(direction)}`}
          >
            <button
              type="button"
              className="hf-eq-mixer-band-head"
              onClick={() => toggleBand(band.id)}
              aria-expanded={open}
            >
              <span className="hf-eq-mixer-band-label">{band.label}</span>
              <span className="hf-eq-mixer-band-count">
                {band.tracks.length}
              </span>
              <ChevronDown
                size={14}
                className={`hf-eq-mixer-band-chevron${open ? " hf-eq-mixer-band-chevron--open" : ""}`}
              />
            </button>
            {open && (
              <div className="hf-eq-mixer-tracks">
                {band.tracks.map((t) => (
                  <EQTrackView
                    key={t.id}
                    track={t}
                    height={trackHeight}
                    width={trackWidth}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EQTrackView({
  track,
  height,
  width,
}: {
  track: EQTrack;
  height: number;
  width: number;
}): React.ReactElement {
  const delta = track.current - track.default;
  const direction = directionOf(delta, 0.01);
  const tooltipBody = (
    <div className="hf-eq-mixer-tooltip">
      <div className="hf-eq-mixer-tooltip-label">{track.label}</div>
      {track.definition && (
        <div className="hf-eq-mixer-tooltip-def">{track.definition}</div>
      )}
      <div className="hf-eq-mixer-tooltip-values">
        {track.default.toFixed(2)} → {track.current.toFixed(2)}
      </div>
    </div>
  );

  return (
    <Tooltip content={tooltipBody}>
      <div
        className={`hf-eq-mixer-track ${classForDirection(direction)}`}
        style={{ height: `${height}px`, width: `${width}px` }}
        role="img"
        aria-label={`${track.label}: default ${track.default.toFixed(2)}, current ${track.current.toFixed(2)}`}
      >
        <div className="hf-eq-mixer-track-rail" aria-hidden="true" />
        <div
          className="hf-eq-mixer-track-default"
          style={{ bottom: `${track.default * 100}%` }}
          aria-hidden="true"
        />
        <div
          className="hf-eq-mixer-track-current"
          style={{ bottom: `${track.current * 100}%` }}
          aria-hidden="true"
        />
        <div className="hf-eq-mixer-track-delta">
          <DeltaPill value={delta} kind="abs" neutralThreshold={0.01} />
        </div>
      </div>
    </Tooltip>
  );
}

function bandTotalDelta(band: EQBand): number {
  if (band.tracks.length === 0) return 0;
  return band.tracks.reduce((s, t) => s + (t.current - t.default), 0);
}

function pickLoudestBand(bands: EQBand[]): string | undefined {
  let best: { id: string; mag: number } | null = null;
  for (const b of bands) {
    const mag = Math.abs(bandTotalDelta(b));
    if (!best || mag > best.mag) best = { id: b.id, mag };
  }
  return best?.id;
}
