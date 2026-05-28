"use client";

import React from "react";
import {
  directionOf,
  classForDirection,
  type Direction,
} from "@/lib/caller-insights/direction";
import { delta as fmtDelta, type DeltaKind } from "@/lib/caller-insights/formatNum";

type DeltaPillProps = {
  /** Raw delta value. Null / NaN render an em-dash placeholder. */
  value: number | null | undefined;
  /** Format kind — pp (percentage points), abs (two decimals), count (integer). */
  kind?: DeltaKind;
  /** Unit suffix when kind is "count". */
  unit?: string;
  /** Threshold below which a delta is treated as neutral (no +0 noise). */
  neutralThreshold?: number;
  /** Override the auto-derived direction (rare — only when delta sign and direction diverge). */
  forceDirection?: Direction;
};

/**
 * Signed delta as a small inline pill. Auto-coloured by direction
 * (green / red / neutral) via the design-system CSS vars.
 *
 * Delta exactly 0 (or within `neutralThreshold`) renders neutral with no `+`
 * sign — keeps the EQ mixer and trend cards quiet for unchanged params.
 */
export function DeltaPill({
  value,
  kind = "abs",
  unit,
  neutralThreshold = 0,
  forceDirection,
}: DeltaPillProps): React.ReactElement {
  const direction = forceDirection ?? directionOf(value, neutralThreshold);
  const text = fmtDelta(value, kind, unit);

  return (
    <span className={`hf-delta-pill ${classForDirection(direction)}`}>
      {text}
    </span>
  );
}
