"use client";

/**
 * SnapshotScoreTrendsBlock — Wave C2 of the legacy-tab retirement plan.
 *
 * Lifts Uplift v2's ScoreTrendsSection (per-parameter SparklineCard grid
 * with history + avg + delta + improving-first sort) into Snapshot v3
 * so uplift-v2 can retire without losing the per-parameter trend story.
 *
 * Thin wrapper around the legacy `ScoreTrendsSection`; it already calls
 * `useUpliftData(callerId)` and uses the shared `CardGrid` +
 * `SparklineCard` primitives.
 */

import { ScoreTrendsSection } from "./caller-detail-v2/sections/ScoreTrendsSection";

interface SnapshotScoreTrendsBlockProps {
  callerId: string;
}

export function SnapshotScoreTrendsBlock({ callerId }: SnapshotScoreTrendsBlockProps) {
  return (
    <section
      className="hf-snapshot-section"
      data-testid="hf-snapshot-score-trends"
    >
      <div className="hf-card-compact">
        <ScoreTrendsSection callerId={callerId} />
      </div>
    </section>
  );
}
