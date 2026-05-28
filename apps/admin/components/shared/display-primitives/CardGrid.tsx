"use client";

import React from "react";

type CardGridProps = {
  /** Minimum card width before wrapping. */
  minColumnWidth?: number;
  /** Gap between cards. */
  gap?: number;
  children: React.ReactNode;
};

/**
 * Auto-fill grid wrapper. Cards collapse to a single column on narrow
 * viewports without a media query.
 *
 * Use as the host for badge cards, sparkline cards, goal cards, etc.
 */
export function CardGrid({
  minColumnWidth = 240,
  gap = 12,
  children,
}: CardGridProps): React.ReactElement {
  return (
    <div
      className="hf-card-grid"
      style={{
        gridTemplateColumns: `repeat(auto-fill, minmax(${minColumnWidth}px, 1fr))`,
        gap: `${gap}px`,
      }}
    >
      {children}
    </div>
  );
}
