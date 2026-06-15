"use client";

/**
 * SnapshotEngagementBlock — Wave C1 of the legacy-tab retirement plan.
 *
 * Lifts Uplift v2's EngagementSection (memories slice donut + Calls/week
 * StatTile + 14-day CalendarStrip) into Snapshot v3 so uplift-v2 can
 * retire without losing the cadence + memory-shape signal.
 *
 * Thin wrapper around the legacy `EngagementSection` — it already calls
 * `useUpliftData(callerId)` and uses shared `display-primitives`. Mounted
 * inside a `hf-snapshot-section` shell so the layout matches Snapshot v3.
 */

import { EngagementSection } from "./caller-detail-v2/sections/EngagementSection";

interface SnapshotEngagementBlockProps {
  callerId: string;
}

export function SnapshotEngagementBlock({ callerId }: SnapshotEngagementBlockProps) {
  return (
    <section
      className="hf-snapshot-section"
      data-testid="hf-snapshot-engagement"
    >
      <div className="hf-card-compact">
        <EngagementSection callerId={callerId} />
      </div>
    </section>
  );
}
