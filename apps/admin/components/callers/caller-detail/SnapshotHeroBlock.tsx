"use client";

/**
 * SnapshotHeroBlock — Wave C1 of the legacy-tab retirement plan.
 *
 * Lifts Uplift v2's HeroSection (Mastery + Confidence + Knowledge donuts
 * with pre/post markers + Calls + Days-active StatTiles + mastery
 * micro-sparkline) into Snapshot v3 so uplift-v2 can retire without
 * losing the headline proof points.
 *
 * Thin wrapper around the legacy `HeroSection` — it already calls
 * `useUpliftData(callerId)` and uses shared `display-primitives`. We
 * mount it inside a `hf-snapshot-section` shell so the layout matches
 * the rest of Snapshot v3.
 *
 * STUDENT scope: the underlying `/api/callers/[id]/uplift` route already
 * gates via `studentAllowedToReadCaller`.
 */

import { HeroSection } from "./caller-detail-v2/sections/HeroSection";

interface SnapshotHeroBlockProps {
  callerId: string;
}

export function SnapshotHeroBlock({ callerId }: SnapshotHeroBlockProps) {
  return (
    <section
      className="hf-snapshot-section"
      data-testid="hf-snapshot-hero"
    >
      <div className="hf-card-compact">
        <div className="hf-category-label">Proof points</div>
        <HeroSection callerId={callerId} />
      </div>
    </section>
  );
}
