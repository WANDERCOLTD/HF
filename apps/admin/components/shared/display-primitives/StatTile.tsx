"use client";

import React from "react";
import { Tooltip } from "@/components/shared/Tooltip";

type StatTileProps = {
  /** Headline value to render. Pass the already-formatted string from `formatNum`. */
  value: string | null | undefined;
  /** Short label below the value, e.g. "Calls", "Days active". */
  label: string;
  /** Optional sub-label or unit (e.g. "this week", "vs last month"). */
  sub?: string;
  /** Optional Lucide icon node to render top-left. */
  icon?: React.ReactNode;
  /** Optional plain-English definition; shown as a delayed-hover tooltip on the label. */
  definition?: string;
  /** Render in a compact mode (smaller font / padding) for dense sections. */
  compact?: boolean;
};

/**
 * Single-count headline tile. Use when the data is one number worth showing
 * by itself — counts (Calls, Days), top-line ratios, single-figure summaries.
 *
 * Renders "—" placeholder when value is null / undefined.
 */
export function StatTile({
  value,
  label,
  sub,
  icon,
  definition,
  compact,
}: StatTileProps): React.ReactElement {
  const displayValue = value ?? "—";

  return (
    <div className={`hf-stat-tile${compact ? " hf-stat-tile--compact" : ""}`}>
      {icon && <span className="hf-stat-tile-icon">{icon}</span>}
      <span className="hf-stat-tile-value">{displayValue}</span>
      <Tooltip content={definition ?? ""}>
        <span className="hf-stat-tile-label">{label}</span>
      </Tooltip>
      {sub && <span className="hf-stat-tile-sub">{sub}</span>}
    </div>
  );
}
