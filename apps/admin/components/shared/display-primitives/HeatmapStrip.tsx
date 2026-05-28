"use client";

import React from "react";
import { Tooltip } from "@/components/shared/Tooltip";

type HeatmapCell = {
  /** Identifier used as React key + tooltip body. */
  key: string;
  /** Visible label below the cell. */
  label: string;
  /** Mastery / score 0–1. Drives fill intensity. */
  value: number | null | undefined;
  /** Optional sub-label below the value (e.g. "12 calls"). */
  sub?: string;
  /** Optional tooltip content; falls back to `label`. */
  tooltip?: React.ReactNode;
  /** Optional click handler for drilldown. */
  onClick?: () => void;
};

type HeatmapStripProps = {
  cells: HeatmapCell[];
  /** Min cell width before the strip starts to scroll horizontally. */
  minCellWidth?: number;
  /** Render an empty-state message when cells is empty. */
  emptyText?: string;
};

/**
 * Horizontal heatmap strip — ordered items 0–1, course-sequence semantics.
 * Used for module mastery across a course.
 *
 * Fill intensity is a 5-step ramp so the eye reads the shape of progression
 * pre-attentively. Hover surfaces the full label and mastery in a tooltip.
 */
export function HeatmapStrip({
  cells,
  minCellWidth = 88,
  emptyText = "No data yet.",
}: HeatmapStripProps): React.ReactElement {
  if (cells.length === 0) {
    return (
      <div className="hf-heatmap-empty" role="status">
        {emptyText}
      </div>
    );
  }

  return (
    <div
      className="hf-heatmap-strip"
      style={{ gridAutoColumns: `minmax(${minCellWidth}px, 1fr)` }}
    >
      {cells.map((cell) => {
        const valueIsMissing = cell.value == null || Number.isNaN(cell.value);
        const tier = valueIsMissing ? 0 : tierFor(cell.value as number);
        const cellClass = [
          "hf-heatmap-cell",
          `hf-heatmap-cell--t${tier}`,
          cell.onClick ? "hf-heatmap-cell--clickable" : "",
          valueIsMissing ? "hf-heatmap-cell--empty" : "",
        ]
          .filter(Boolean)
          .join(" ");

        const valueLabel = valueIsMissing
          ? "—"
          : `${Math.round((cell.value as number) * 100)}%`;

        const node = (
          <button
            type="button"
            className={cellClass}
            onClick={cell.onClick}
            disabled={!cell.onClick}
            aria-label={`${cell.label}: ${valueLabel}`}
          >
            <span className="hf-heatmap-cell-fill" aria-hidden="true" />
            <span className="hf-heatmap-cell-label">{cell.label}</span>
            <span className="hf-heatmap-cell-value">{valueLabel}</span>
            {cell.sub && <span className="hf-heatmap-cell-sub">{cell.sub}</span>}
          </button>
        );

        return (
          <Tooltip key={cell.key} content={cell.tooltip ?? cell.label}>
            {node}
          </Tooltip>
        );
      })}
    </div>
  );
}

function tierFor(value: number): 1 | 2 | 3 | 4 | 5 {
  if (value < 0.2) return 1;
  if (value < 0.4) return 2;
  if (value < 0.6) return 3;
  if (value < 0.8) return 4;
  return 5;
}
