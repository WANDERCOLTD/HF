"use client";

/**
 * CategoryTreemap — squarified treemap visualization for content category distribution.
 * Extracted from CourseIntelligenceTab for reuse on the dashboard.
 *
 * Features:
 * - Squarified layout algorithm for optimal aspect ratios
 * - Consistent category colors from CONTENT_CATEGORIES
 * - Hover card showing sample teaching points (when categoryItems provided)
 */

import { useState, useRef, useCallback } from "react";
import { getCategoryStyle } from "@/lib/content-categories";
import { CONTENT_CATEGORIES } from "@/lib/content-categories";
import "./category-treemap.css";

// ── Squarify layout ──────────────────────────────────

type TreemapRect = { cat: string; count: number; x: number; y: number; w: number; h: number };

function squarify(
  items: Array<{ cat: string; count: number }>,
  width: number,
  height: number,
): TreemapRect[] {
  const total = items.reduce((s, i) => s + i.count, 0);
  if (total === 0 || items.length === 0) return [];

  const areas = items.map((i) => ({ ...i, area: (i.count / total) * width * height }));
  const rects: TreemapRect[] = [];
  let x = 0, y = 0, w = width, h = height;

  function layoutRow(row: typeof areas, rowArea: number, short: number, isHoriz: boolean): void {
    const long = rowArea / short;
    let offset = 0;
    for (const item of row) {
      const size = item.area / long;
      if (isHoriz) {
        rects.push({ cat: item.cat, count: item.count, x, y: y + offset, w: long, h: size });
      } else {
        rects.push({ cat: item.cat, count: item.count, x: x + offset, y, w: size, h: long });
      }
      offset += size;
    }
    if (isHoriz) { x += long; w -= long; }
    else { y += long; h -= long; }
  }

  function worst(row: typeof areas, short: number): number {
    const rowArea = row.reduce((s, i) => s + i.area, 0);
    let max = 0;
    for (const item of row) {
      const long = rowArea / short;
      const size = item.area / long;
      const ratio = Math.max(long / size, size / long);
      if (ratio > max) max = ratio;
    }
    return max;
  }

  let remaining = [...areas];
  while (remaining.length > 0) {
    const short = Math.min(w, h);
    const isHoriz = h <= w;
    const row: typeof areas = [remaining[0]];
    remaining = remaining.slice(1);

    while (remaining.length > 0) {
      const candidate = [...row, remaining[0]];
      if (worst(candidate, short) <= worst(row, short)) {
        row.push(remaining[0]);
        remaining = remaining.slice(1);
      } else {
        break;
      }
    }
    const rowArea = row.reduce((s, i) => s + i.area, 0);
    layoutRow(row, rowArea, short, isHoriz);
  }
  return rects;
}

// ── Hover Card ──────────────────────────────────────

function HoverCard({
  cat,
  count,
  total,
  items,
  anchorRect,
  containerRect,
}: {
  cat: string;
  count: number;
  total: number;
  items?: string[];
  anchorRect: DOMRect;
  containerRect: DOMRect;
}): React.ReactElement {
  const meta = CONTENT_CATEGORIES[cat] ?? getCategoryStyle(cat);
  const pct = Math.round((count / total) * 100);

  // Position: prefer above the cell, fall back to below
  const spaceAbove = anchorRect.top - containerRect.top;
  const showBelow = spaceAbove < 160;

  const left = Math.min(
    Math.max(anchorRect.left - containerRect.left + anchorRect.width / 2, 120),
    containerRect.width - 120,
  );

  const style: React.CSSProperties = {
    left: `${left}px`,
    ...(showBelow
      ? { top: `${anchorRect.bottom - containerRect.top + 8}px` }
      : { bottom: `${containerRect.bottom - anchorRect.top + 8}px` }),
  };

  return (
    <div className="cat-treemap-hover" style={style}>
      <div className="cat-treemap-hover-header">
        {meta.icon && <span className="cat-treemap-hover-icon">{meta.icon}</span>}
        <span className="cat-treemap-hover-label">{meta.label}</span>
        <span className="cat-treemap-hover-count">{count}</span>
        <span className="cat-treemap-hover-pct">{pct}%</span>
      </div>
      {items && items.length > 0 && (
        <ul className="cat-treemap-hover-items">
          {items.map((item, i) => (
            <li key={i}>{item.length > 80 ? item.slice(0, 77) + "…" : item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Component ────────────────────────────────────────

export function CategoryTreemap({
  categoryCounts,
  categoryItems,
  className,
}: {
  categoryCounts: Record<string, number>;
  categoryItems?: Record<string, string[]>;
  className?: string;
}): React.ReactElement | null {
  // Hooks must run unconditionally. The `total === 0` early-return previously
  // sat above these four hooks, which violated rules-of-hooks. The hooks have
  // no inputs that depend on `total`, so it's safe to hoist them above the
  // guard — when total is 0 we still construct the empty hover state, then
  // bail out of rendering. (#865 PR 2)
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<{
    cat: string;
    count: number;
    anchorRect: DOMRect;
  } | null>(null);

  const handleMouseEnter = useCallback((e: React.MouseEvent, cat: string, count: number) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setHovered({ cat, count, anchorRect: rect });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHovered(null);
  }, []);

  const total = Object.values(categoryCounts).reduce((s, c) => s + c, 0);
  if (total === 0) return null;

  const entries = Object.entries(categoryCounts)
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1]);

  const rects = squarify(
    entries.map(([cat, count]) => ({ cat, count })),
    100,
    100,
  );

  return (
    <div
      ref={containerRef}
      className={`cat-treemap-container${className ? ` ${className}` : ""}`}
    >
      <div className="cat-treemap">
        {rects.map((r) => {
          const meta = CONTENT_CATEGORIES[r.cat] ?? getCategoryStyle(r.cat);
          const showLabel = r.w > 15 && r.h > 18;
          const showCount = r.w > 10 && r.h > 12;
          return (
            <div
              key={r.cat}
              className="cat-treemap-cell"
              style={{
                left: `${r.x}%`,
                top: `${r.y}%`,
                width: `${r.w}%`,
                height: `${r.h}%`,
                background: meta.color,
              }}
              onMouseEnter={(e) => handleMouseEnter(e, r.cat, r.count)}
              onMouseLeave={handleMouseLeave}
            >
              {showLabel && <span className="cat-treemap-label">{meta.label}</span>}
              {showCount && <span className="cat-treemap-count">{r.count}</span>}
            </div>
          );
        })}
      </div>

      {/* Hover card */}
      {hovered && containerRef.current && (
        <HoverCard
          cat={hovered.cat}
          count={hovered.count}
          total={total}
          items={categoryItems?.[hovered.cat]}
          anchorRect={hovered.anchorRect}
          containerRect={containerRef.current.getBoundingClientRect()}
        />
      )}
    </div>
  );
}
