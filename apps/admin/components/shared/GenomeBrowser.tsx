"use client";

/**
 * GenomeBrowser — a multi-track visualization of course content hierarchy.
 *
 * Inspired by UCSC Genome Browser: horizontal tracks showing modules, learning
 * outcomes, teaching points, and assessment waymarkers across a session timeline.
 *
 * Reusable — takes data props, not tied to any specific page.
 */

import { useState, useRef, useCallback, useMemo, type CSSProperties } from "react";
import type { GenomeData, GenomeJourneyStop, GenomeAssertion } from "@/app/api/courses/[courseId]/genome/route";
import { getSessionTypeColor, getSessionTypeShortLabel, isFormStop } from "@/lib/lesson-plan/session-ui";
import "./genome-browser.css";

// ---------------------------------------------------------------------------
// Category color map (assertion categories → pastel tones via CSS vars)
// ---------------------------------------------------------------------------

const CATEGORY_COLORS: Record<string, string> = {
  fact: "color-mix(in srgb, var(--accent-primary) 25%, var(--surface-primary))",
  process: "color-mix(in srgb, var(--status-success-text) 25%, var(--surface-primary))",
  example: "color-mix(in srgb, var(--login-gold) 30%, var(--surface-primary))",
  rule: "color-mix(in srgb, var(--status-error-text) 20%, var(--surface-primary))",
  concept: "color-mix(in srgb, var(--login-blue) 30%, var(--surface-primary))",
  principle: "color-mix(in srgb, var(--accent-primary) 18%, var(--surface-primary))",
  definition: "color-mix(in srgb, var(--login-navy) 15%, var(--surface-primary))",
};

const MODULE_COLORS = [
  "color-mix(in srgb, var(--accent-primary) 12%, var(--surface-primary))",
  "color-mix(in srgb, var(--status-success-text) 12%, var(--surface-primary))",
  "color-mix(in srgb, var(--login-gold) 15%, var(--surface-primary))",
  "color-mix(in srgb, var(--login-blue) 15%, var(--surface-primary))",
  "color-mix(in srgb, var(--status-error-text) 10%, var(--surface-primary))",
  "color-mix(in srgb, var(--login-navy) 10%, var(--surface-primary))",
];

const LO_COLORS = [
  "color-mix(in srgb, var(--accent-primary) 18%, var(--surface-primary))",
  "color-mix(in srgb, var(--status-success-text) 18%, var(--surface-primary))",
  "color-mix(in srgb, var(--login-gold) 22%, var(--surface-primary))",
  "color-mix(in srgb, var(--login-blue) 22%, var(--surface-primary))",
  "color-mix(in srgb, var(--status-error-text) 15%, var(--surface-primary))",
];

function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] || "color-mix(in srgb, var(--text-muted) 15%, var(--surface-primary))";
}

// ---------------------------------------------------------------------------
// Tooltip state
// ---------------------------------------------------------------------------

interface TooltipState {
  x: number;
  y: number;
  title: string;
  lines: string[];
}

// ---------------------------------------------------------------------------
// Assertion list popover state
// ---------------------------------------------------------------------------

interface PopoverState {
  x: number;
  y: number;
  assertions: GenomeAssertion[];
  category: string;
  sessionLabel: string;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface GenomeBrowserProps {
  data: GenomeData;
  /** Callback when a session's TP cell is clicked (for drilldown) */
  onSessionClick?: (session: number) => void;
  /** Callback when a specific assertion category in a session is clicked */
  onCategoryClick?: (session: number, category: string) => void;
  /** Callback when an individual assertion is selected (for detail drawer) */
  onAssertionClick?: (assertionId: string) => void;
  /** Currently selected assertion ID (for active highlight) */
  activeAssertionId?: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GenomeBrowser({ data, onSessionClick, onCategoryClick, onAssertionClick, activeAssertionId }: GenomeBrowserProps) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const showTooltip = useCallback((e: React.MouseEvent, title: string, lines: string[]) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({
      x: e.clientX - rect.left + 12,
      y: e.clientY - rect.top - 8,
      title,
      lines,
    });
  }, []);

  const hideTooltip = useCallback(() => setTooltip(null), []);

  const openPopover = useCallback((e: React.MouseEvent, assertions: GenomeAssertion[], category: string, sessionLabel: string) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip(null);
    setPopover({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top + 8,
      assertions,
      category,
      sessionLabel,
    });
  }, []);

  const closePopover = useCallback(() => setPopover(null), []);

  // Partition journey stops into pre-teaching, teaching, post-teaching
  const journeyGroups = useMemo(() => {
    if (!data.journeyStops?.length) return null;
    const pre: GenomeJourneyStop[] = [];
    const teaching: GenomeJourneyStop[] = [];
    const post: GenomeJourneyStop[] = [];
    let seenTeaching = false;
    let lastTeachingIdx = -1;

    // Find last teaching stop index
    for (let i = data.journeyStops.length - 1; i >= 0; i--) {
      if (data.journeyStops[i].teachingIndex !== null) { lastTeachingIdx = i; break; }
    }

    for (let i = 0; i < data.journeyStops.length; i++) {
      const stop = data.journeyStops[i];
      if (stop.teachingIndex !== null) {
        seenTeaching = true;
        teaching.push(stop);
      } else if (!seenTeaching) {
        pre.push(stop);
      } else if (i > lastTeachingIdx) {
        post.push(stop);
      }
      // Mid-survey between teaching sessions — treat as teaching-aligned
      // (skip for now — it would need its own column handling)
    }
    return { pre, teaching, post };
  }, [data.journeyStops]);

  if (data.teachingSessionCount === 0) {
    return (
      <div className="genome-empty">
        No lesson plan generated yet. Generate a lesson plan to see the course genome.
      </div>
    );
  }

  const sessionCount = data.teachingSessionCount;
  // Grid template: label column + one column per teaching session
  const gridCols = `120px repeat(${sessionCount}, minmax(80px, 1fr))`;

  // Sort categories for consistent band ordering
  const allCategories = new Set<string>();
  for (const s of data.sessions) {
    for (const cat of Object.keys(s.categories)) {
      allCategories.add(cat);
    }
  }
  const sortedCategories = [...allCategories].sort();

  return (
    <div className="genome" ref={containerRef}>
      {/* Header */}
      <div className="genome-header">
        <span className="genome-header-title">Course Genome</span>
        <span className="genome-header-stats">
          {sessionCount} sessions · {data.modules.length} modules · {data.totalAssertions} teaching points
        </span>
      </div>

      <div className="genome-container">
        {/* ═══ AXIS: Session headers ═══ */}
        <div className="genome-axis" style={{ display: "grid", gridTemplateColumns: gridCols }}>
          <div className="genome-track-label">Session</div>
          {data.sessions.map((s) => (
            <div key={s.teachingIndex} className="genome-axis-cell">
              <div className="genome-axis-num">{s.teachingIndex}</div>
              <div className="genome-axis-type">{s.type}</div>
            </div>
          ))}
        </div>

        {/* ═══ TRACK 1: Module spans ═══ */}
        {data.modules.length > 0 && (
          <div className="genome-track" style={{ display: "grid", gridTemplateColumns: gridCols }}>
            <div className="genome-track-label">Modules</div>
            {renderModuleSpans(data, sessionCount, showTooltip, hideTooltip)}
          </div>
        )}

        {/* ═══ TRACK 2: Learning Outcomes ═══ */}
        {data.learningOutcomes.length > 0 && (
          <div style={{ borderBottom: "1px solid var(--border-default)", padding: "6px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span className="genome-track-label">Outcomes</span>
            </div>
            {data.learningOutcomes.map((lo, i) => (
              <div
                key={lo.ref}
                className="genome-lo-row"
                style={{ gridTemplateColumns: gridCols }}
              >
                <div style={{ gridColumn: 1 }} />
                <div
                  className="genome-lo-bar"
                  style={{
                    gridColumn: `${lo.sessionStart + 1} / ${lo.sessionEnd + 2}`,
                    "--lo-color": LO_COLORS[i % LO_COLORS.length],
                  } as CSSProperties}
                  onMouseEnter={(e) =>
                    showTooltip(e, lo.description, [
                      `Ref: ${lo.ref}`,
                      `Module: ${lo.moduleSlug}`,
                      `Sessions: ${lo.sessionStart}–${lo.sessionEnd}`,
                      `${lo.assertionCount} teaching points`,
                    ])
                  }
                  onMouseLeave={hideTooltip}
                >
                  {lo.description}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ═══ TRACK 3: Teaching Points (stacked category bars) ═══ */}
        <div className="genome-track" style={{ display: "grid", gridTemplateColumns: gridCols }}>
          <div className="genome-track-label">Teaching Points</div>
          {data.sessions.map((s) => (
            <div
              key={s.teachingIndex}
              className="genome-tp-cell"
              onClick={() => onSessionClick?.(s.session)}
              onMouseEnter={(e) =>
                showTooltip(e, `${s.label}`, [
                  `${s.totalAssertions} teaching points`,
                  ...Object.entries(s.categories)
                    .sort(([, a], [, b]) => b - a)
                    .map(([cat, count]) => `${cat}: ${count}`),
                  ...(s.loRefs.length > 0 ? [`LOs: ${s.loRefs.join(", ")}`] : []),
                ])
              }
              onMouseLeave={hideTooltip}
            >
              {sortedCategories.map((cat) => {
                const count = s.categories[cat] || 0;
                if (count === 0) return null;
                const maxCount = Math.max(...data.sessions.map((ss) => ss.totalAssertions), 1);
                const heightPct = Math.max(16, (count / maxCount) * 60);
                const catAssertions = s.assertions.filter((a) => a.category === cat);
                const hasActive = catAssertions.some((a) => a.id === activeAssertionId);
                return (
                  <div
                    key={cat}
                    className={`genome-tp-band${hasActive ? " genome-tp-band--active" : ""}`}
                    style={{
                      background: getCategoryColor(cat),
                      height: `${heightPct}px`,
                      cursor: "pointer",
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onCategoryClick?.(s.session, cat);
                      if (catAssertions.length === 1 && onAssertionClick) {
                        onAssertionClick(catAssertions[0].id);
                      } else if (catAssertions.length > 1) {
                        openPopover(e, catAssertions, cat, s.label);
                      }
                    }}
                  >
                    <span>{cat}</span>
                    <span>{count}</span>
                  </div>
                );
              })}
              <div className="genome-tp-total">{s.totalAssertions}</div>
            </div>
          ))}
        </div>

        {/* ═══ TRACK 4: Journey Rail (full lesson plan aligned to genome) ═══ */}
        {journeyGroups && (
          <div
            className="genome-journey-track"
            style={{
              display: "grid",
              gridTemplateColumns: `120px auto repeat(${sessionCount}, minmax(80px, 1fr)) auto`,
            }}
          >
            <div className="genome-track-label">Journey</div>

            {/* Pre-teaching stops (PR, OB) */}
            <div className="genome-journey-cluster">
              {journeyGroups.pre.map((stop) => (
                <JourneyStop
                  key={stop.session}
                  stop={stop}
                  size="small"
                  showTooltip={showTooltip}
                  hideTooltip={hideTooltip}
                />
              ))}
            </div>

            {/* Teaching stops — aligned to genome columns */}
            {journeyGroups.teaching.map((stop) => (
              <div key={stop.session} className="genome-journey-cell">
                <JourneyStop
                  stop={stop}
                  size="large"
                  showTooltip={showTooltip}
                  hideTooltip={hideTooltip}
                />
              </div>
            ))}

            {/* Post-teaching stops (OF, PO) */}
            <div className="genome-journey-cluster">
              {journeyGroups.post.map((stop) => (
                <JourneyStop
                  key={stop.session}
                  stop={stop}
                  size="small"
                  showTooltip={showTooltip}
                  hideTooltip={hideTooltip}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="genome-legend">
        {sortedCategories.map((cat) => (
          <div key={cat} className="genome-legend-item">
            <div className="genome-legend-swatch" style={{ background: getCategoryColor(cat) }} />
            <span>{cat}</span>
          </div>
        ))}
      </div>

      {/* Tooltip */}
      {tooltip && !popover && (
        <div className="genome-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          <div className="genome-tooltip-title">{tooltip.title}</div>
          <div className="genome-tooltip-meta">
            {tooltip.lines.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </div>
      )}

      {/* Assertion list popover */}
      {popover && (
        <>
          <div className="genome-popover-backdrop" onClick={closePopover} />
          <div className="genome-popover" style={{ left: popover.x, top: popover.y }}>
            <div className="genome-popover-header">
              <span>{popover.sessionLabel} — {popover.category}</span>
              <button className="genome-popover-close" onClick={closePopover} aria-label="Close">×</button>
            </div>
            <div className="genome-popover-list">
              {popover.assertions.map((a) => (
                <button
                  key={a.id}
                  className={`genome-popover-item${a.id === activeAssertionId ? " genome-popover-item--active" : ""}`}
                  onClick={() => {
                    onAssertionClick?.(a.id);
                    closePopover();
                  }}
                >
                  <span className="genome-popover-item-text">{a.assertion}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Module span renderer
// ---------------------------------------------------------------------------

function renderModuleSpans(
  data: GenomeData,
  sessionCount: number,
  showTooltip: (e: React.MouseEvent, title: string, lines: string[]) => void,
  hideTooltip: () => void,
): React.ReactNode[] {
  // Build a flat grid of cells, then place module spans
  // Empty cells need to be rendered for grid alignment
  const cells: React.ReactNode[] = [];
  const occupied = new Set<number>();

  for (let i = 0; i < data.modules.length; i++) {
    const mod = data.modules[i];
    for (let s = mod.sessionStart; s <= mod.sessionEnd; s++) {
      occupied.add(s);
    }
  }

  // Render module spans with gridColumn positioning
  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < data.modules.length; i++) {
    const mod = data.modules[i];
    // Fill gaps before this module
    nodes.push(
      <div
        key={`mod-${mod.slug}`}
        className="genome-module-span"
        style={{
          gridColumn: `${mod.sessionStart + 1} / ${mod.sessionEnd + 2}`,
          "--module-color": MODULE_COLORS[i % MODULE_COLORS.length],
        } as CSSProperties}
        onMouseEnter={(e) =>
          showTooltip(e, mod.title, [
            `Sessions: ${mod.sessionStart}–${mod.sessionEnd}`,
            `${mod.loCount} learning outcomes`,
          ])
        }
        onMouseLeave={hideTooltip}
      >
        <span className="genome-module-title">{mod.title}</span>
        <span className="genome-module-meta">{mod.loCount} LOs</span>
      </div>,
    );
  }

  // Fill any unoccupied columns
  for (let s = 1; s <= sessionCount; s++) {
    if (!occupied.has(s)) {
      nodes.push(
        <div key={`empty-${s}`} style={{ gridColumn: s + 1 }} />,
      );
    }
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// Journey stop renderer
// ---------------------------------------------------------------------------

function JourneyStop({
  stop,
  size,
  showTooltip,
  hideTooltip,
}: {
  stop: GenomeJourneyStop;
  size: "small" | "large";
  showTooltip: (e: React.MouseEvent, title: string, lines: string[]) => void;
  hideTooltip: () => void;
}) {
  const color = getSessionTypeColor(stop.type);
  const shortLabel = getSessionTypeShortLabel(stop.type);
  const isAssess = stop.type === "assess";
  const isForm = isFormStop(stop.type);

  return (
    <div
      className={`genome-journey-stop genome-journey-stop--${size}`}
      onMouseEnter={(e) =>
        showTooltip(e, stop.label, [
          `Session ${stop.session}`,
          `Type: ${stop.type}`,
          ...(stop.teachingIndex ? [`Teaching session ${stop.teachingIndex}`] : ["Structural stop"]),
        ])
      }
      onMouseLeave={hideTooltip}
    >
      <div
        className={`genome-journey-dot${isAssess || isForm ? " genome-journey-dot--diamond" : ""}`}
        style={{ "--stop-color": color } as CSSProperties}
      />
      <span className="genome-journey-label" style={{ color }}>{shortLabel}</span>
    </div>
  );
}
