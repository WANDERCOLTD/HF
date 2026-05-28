"use client";

import React from "react";
import { Sparkline } from "@/components/shared/Sparkline";
import { DeltaPill } from "./DeltaPill";
import {
  directionOf,
  colorVarForDirection,
} from "@/lib/caller-insights/direction";

type SparklineCardProps = {
  /** Display title for the metric. */
  title: string;
  /** Time series values. <2 points renders a flat baseline + "Not enough data" hint. */
  history: number[];
  /** Optional labels per data point (for the existing Sparkline tooltip). */
  historyLabels?: string[];
  /** Optional target value (renders as a dotted reference line). */
  target?: number | null;
  /** Headline number — typically rolling average. */
  avg?: number | null;
  /** Optional pre→post / period delta — rendered as a DeltaPill. */
  delta?: number | null;
  /** Width / height of the sparkline area. */
  width?: number;
  height?: number;
};

/**
 * Card-shaped sparkline composition. Stroke colour and DeltaPill direction
 * are derived from the series' trend so cards self-tint by direction.
 *
 * Wraps the existing `components/shared/Sparkline` — does not re-implement.
 */
export function SparklineCard({
  title,
  history,
  historyLabels,
  target,
  avg,
  delta,
  width = 140,
  height = 40,
}: SparklineCardProps): React.ReactElement {
  const direction = directionOf(
    history.map((v) => ({ score: v })),
    "trend",
  );
  const strokeColor = colorVarForDirection(direction);
  const tooFew = history.length < 2;

  return (
    <div className={`hf-sparkline-card hf-direction-${direction}`}>
      <div className="hf-sparkline-card-head">
        <span className="hf-sparkline-card-title">{title}</span>
        {delta != null && <DeltaPill value={delta} kind="abs" />}
      </div>
      <div className="hf-sparkline-card-body">
        {tooFew ? (
          <span className="hf-sparkline-card-empty">Not enough data</span>
        ) : (
          <Sparkline
            history={history}
            color={strokeColor}
            width={width}
            height={height}
            label={title}
            historyLabels={historyLabels}
          />
        )}
      </div>
      <div className="hf-sparkline-card-foot">
        {avg != null && !Number.isNaN(avg) && (
          <span className="hf-sparkline-card-avg">avg {avg.toFixed(2)}</span>
        )}
        {target != null && !Number.isNaN(target) && (
          <span className="hf-sparkline-card-target">
            target {target.toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}
