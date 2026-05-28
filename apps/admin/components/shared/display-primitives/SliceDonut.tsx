"use client";

import React from "react";

type Slice = {
  /** Slice label (used in tooltip / legend). */
  label: string;
  /** Slice raw value (will be normalised by total). */
  value: number;
  /** Optional explicit colour. Defaults rotate through the design-system palette. */
  color?: string;
};

type SliceDonutProps = {
  slices: Slice[];
  size?: number;
  strokeWidth?: number;
  /** Optional headline value rendered inside the ring (typically the total). */
  centerLabel?: React.ReactNode;
};

const DEFAULT_PALETTE = [
  "var(--accent-primary)",
  "var(--status-success-text)",
  "var(--status-warning-text)",
  "var(--status-error-text)",
  "var(--text-muted)",
];

/**
 * Pure SVG donut split into categorical slices. Use for the Memories
 * facts / preferences / topics breakdown and similar small-N composition.
 *
 * Empty input (no slices or zero total) renders an empty grey ring.
 */
export function SliceDonut({
  slices,
  size = 100,
  strokeWidth = 12,
  centerLabel,
}: SliceDonutProps): React.ReactElement {
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  const isEmpty = total <= 0 || slices.length === 0;

  let cumulative = 0;
  const segments = slices.map((slice, i) => {
    const length = (Math.max(0, slice.value) / total) * circumference;
    const dashArray = `${length} ${circumference - length}`;
    const dashOffset = -cumulative;
    cumulative += length;
    return {
      key: `${slice.label}-${i}`,
      color: slice.color ?? DEFAULT_PALETTE[i % DEFAULT_PALETTE.length],
      dashArray,
      dashOffset,
    };
  });

  return (
    <div className={`hf-slice-donut${isEmpty ? " hf-slice-donut--empty" : ""}`}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
      >
        <circle
          className="hf-slice-donut-track"
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--text-muted)"
          strokeWidth={strokeWidth}
          opacity={isEmpty ? 0.3 : 0.12}
        />
        {!isEmpty &&
          segments.map((seg) => (
            <circle
              key={seg.key}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={strokeWidth}
              strokeDasharray={seg.dashArray}
              strokeDashoffset={seg.dashOffset}
              transform={`rotate(-90 ${center} ${center})`}
            />
          ))}
      </svg>
      {centerLabel && <div className="hf-slice-donut-center">{centerLabel}</div>}
    </div>
  );
}
