"use client";

/**
 * SnapshotSkillChartBlock — Wave C2 of the legacy-tab retirement plan.
 *
 * Lifts Uplift v2's SkillChartSection (multi-line SkillTrendChartCard +
 * Skill Radar) into Snapshot v3 so uplift-v2 can retire without losing
 * the skill-shape view.
 *
 * The legacy section accepts optional `scores` / `callerTargets` props
 * for the time-series chart. We don't have a route returning that exact
 * tuple on Snapshot today, so we mount it with empty arrays — the Radar
 * (driven by `useUpliftData` scoreTrends inside the legacy component)
 * still renders, and the time-series side shows the empty-state until
 * the SkillTrendChartCard data source is wired (Wave C2 follow-on).
 */

import { SkillChartSection } from "./caller-detail-v2/sections/SkillChartSection";

interface SnapshotSkillChartBlockProps {
  callerId: string;
}

export function SnapshotSkillChartBlock({ callerId }: SnapshotSkillChartBlockProps) {
  return (
    <section
      className="hf-snapshot-section"
      data-testid="hf-snapshot-skill-chart"
    >
      <div className="hf-card-compact">
        <SkillChartSection callerId={callerId} />
      </div>
    </section>
  );
}
