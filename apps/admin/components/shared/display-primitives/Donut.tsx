"use client";

import React from "react";

type DonutProps = {
  /** Ratio 0–1. Null / undefined / NaN render an empty (—) ring. */
  value: number | null | undefined;
  /** Outer diameter in px. */
  size?: number;
  /** Ring thickness in px. */
  strokeWidth?: number;
  /** CSS-var or color for the progress arc. Default uses accent. */
  color?: string;
  /** Optional content rendered inside the ring (formatted number, label, pre→post markers). */
  children?: React.ReactNode;
  /** Optional class suffix (e.g. for size variants). */
  variant?: "hero" | "mini";
};

/**
 * Pure SVG donut. Single fraction 0–1, headline metric.
 *
 * Replaces the inline `RingChart` / `MiniRing` in `uplifttab.tsx`. Centre
 * content is freeform so callers can render numbers, pre→post markers, or
 * "—" placeholders for empty states.
 */
export function Donut({
  value,
  size = 100,
  strokeWidth = 8,
  color = "var(--accent-primary)",
  children,
  variant,
}: DonutProps): React.ReactElement {
  const isEmpty = value == null || Number.isNaN(value);
  const clamped = isEmpty ? 0 : Math.max(0, Math.min(1, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped);
  const center = size / 2;

  const className = `hf-donut${variant ? ` hf-donut--${variant}` : ""}${isEmpty ? " hf-donut--empty" : ""}`;

  return (
    <div className={className}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
      >
        <circle
          className="hf-donut-track"
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={isEmpty ? "var(--text-muted)" : color}
          strokeWidth={strokeWidth}
        />
        {!isEmpty && (
          <circle
            className="hf-donut-progress"
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${center} ${center})`}
          />
        )}
      </svg>
      {children && <div className="hf-donut-center">{children}</div>}
    </div>
  );
}
