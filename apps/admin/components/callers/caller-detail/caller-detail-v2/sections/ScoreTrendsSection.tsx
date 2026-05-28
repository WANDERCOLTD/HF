"use client";

import React from "react";
import {
  CardGrid,
  SparklineCard,
} from "@/components/shared/display-primitives";
import { directionOf } from "@/lib/caller-insights/direction";
import { useUpliftData } from "../useUpliftData";
import type { ScoreTrend } from "../../types";
import "./score-trends-section.css";

type Props = {
  callerId: string;
};

/**
 * Score Trends — sparkline-card grid for every parameter with ≥2 call scores.
 *
 * Sorted by trend direction (improving first, declining last) so the
 * concerns surface at the bottom — and tinted via SparklineCard's left-edge
 * stripe. Each card hits its parameter's plain-English definition (from the
 * /uplift route widening in PR 2) as a hover tooltip.
 */
export function ScoreTrendsSection({ callerId }: Props): React.ReactElement {
  const { data, loading } = useUpliftData(callerId);

  if (loading) {
    return (
      <div className="hf-uplift-v2-trends-loading" role="status">
        Loading score trends…
      </div>
    );
  }

  const trends = data?.scoreTrends ?? [];
  const sorted = sortByDirection(trends);

  return (
    <div className="hf-uplift-v2-trends">
      <div className="hf-uplift-v2-trends-head">
        <h3 className="hf-uplift-v2-trends-title">Score trends</h3>
        {trends.length > 0 && (
          <span className="hf-uplift-v2-trends-sub">
            {trends.length} param{trends.length === 1 ? "" : "s"} tracked
          </span>
        )}
      </div>
      {trends.length === 0 ? (
        <div className="hf-uplift-v2-trends-empty">
          No score trends yet — they appear once a parameter has been measured
          twice.
        </div>
      ) : (
        <CardGrid minColumnWidth={220} gap={12}>
          {sorted.map((trend) => {
            const history = trend.scores.map((s) => s.score);
            const labels = trend.scores.map((s) =>
              new Date(s.callDate).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
              }),
            );
            const avg =
              history.length > 0
                ? history.reduce((a, b) => a + b, 0) / history.length
                : null;
            const delta =
              history.length >= 2
                ? history[history.length - 1] - history[0]
                : null;
            return (
              <SparklineCard
                key={trend.parameterId}
                title={trend.parameterName}
                history={history}
                historyLabels={labels}
                avg={avg}
                delta={delta}
              />
            );
          })}
        </CardGrid>
      )}
    </div>
  );
}

/** Improving first, stable middle, declining last. */
function sortByDirection(trends: ScoreTrend[]): ScoreTrend[] {
  const ranked = trends.map((t) => ({
    trend: t,
    rank: rankFor(t),
  }));
  ranked.sort((a, b) => a.rank - b.rank);
  return ranked.map((r) => r.trend);
}

function rankFor(trend: ScoreTrend): number {
  const dir = directionOf(
    trend.scores.map((s) => ({ score: s.score })),
    "trend",
  );
  if (dir === "up") return 0;
  if (dir === "neutral") return 1;
  return 2;
}
