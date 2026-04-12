"use client";

/**
 * GenomeBrowser — a multi-track visualization of course content hierarchy.
 *
 * Inspired by UCSC Genome Browser: horizontal tracks showing modules, learning
 * outcomes, teaching points, and assessment waymarkers across a session timeline.
 *
 * View controls:
 *  - Density: comfortable / compact
 *  - Session range pager when sessionCount > PAGE_SIZE
 *  - Empty category/LO/module rows collapse against the visible session window
 *
 * Layout: grid templates are set via CSS custom properties on `.genome-container`
 * (`--genome-cols`, `--genome-journey-cols`) so tracks align without inline grid styles.
 */

import { useState, useRef, useCallback, useMemo, type CSSProperties } from "react";
import type { GenomeData, GenomeJourneyStop, GenomeAssertion } from "@/app/api/courses/[courseId]/genome/route";
import { getSessionTypeColor, getSessionTypeShortLabel, isFormStop } from "@/lib/lesson-plan/session-ui";
import { getCategoryStyle } from "@/lib/content-categories";
import { HFDrawer } from "./HFDrawer";
import "./genome-browser.css";

// ---------------------------------------------------------------------------
// Category color map (assertion categories → pastel tones via CSS vars)
// ---------------------------------------------------------------------------

const CATEGORY_COLORS: Record<string, string> = {
  // Standard content categories
  fact: "color-mix(in srgb, var(--accent-primary) 25%, var(--surface-primary))",
  process: "color-mix(in srgb, var(--status-success-text) 25%, var(--surface-primary))",
  example: "color-mix(in srgb, var(--login-gold) 30%, var(--surface-primary))",
  rule: "color-mix(in srgb, var(--status-error-text) 20%, var(--surface-primary))",
  concept: "color-mix(in srgb, var(--login-blue) 30%, var(--surface-primary))",
  principle: "color-mix(in srgb, var(--accent-primary) 18%, var(--surface-primary))",
  definition: "color-mix(in srgb, var(--login-navy) 15%, var(--surface-primary))",
  // Literary / domain-specific content categories
  character: "color-mix(in srgb, var(--accent-primary) 22%, var(--surface-primary))",
  theme: "color-mix(in srgb, var(--login-navy) 20%, var(--surface-primary))",
  setting: "color-mix(in srgb, var(--status-success-text) 20%, var(--surface-primary))",
  key_event: "color-mix(in srgb, var(--login-gold) 25%, var(--surface-primary))",
  key_point: "color-mix(in srgb, var(--login-gold) 22%, var(--surface-primary))",
  key_quote: "color-mix(in srgb, var(--login-blue) 20%, var(--surface-primary))",
  language_feature: "color-mix(in srgb, var(--login-blue) 25%, var(--surface-primary))",
  vocabulary_highlight: "color-mix(in srgb, var(--login-navy) 18%, var(--surface-primary))",
  overview: "color-mix(in srgb, var(--accent-primary) 15%, var(--surface-primary))",
  summary: "color-mix(in srgb, var(--accent-primary) 20%, var(--surface-primary))",
  threshold: "color-mix(in srgb, var(--status-error-text) 18%, var(--surface-primary))",
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

const PAGE_SIZE = 6;

function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] || "color-mix(in srgb, var(--text-muted) 15%, var(--surface-primary))";
}

// ---------------------------------------------------------------------------
// Tooltip / popover state
// ---------------------------------------------------------------------------

interface TooltipState {
  x: number;
  y: number;
  title: string;
  lines: string[];
}

interface PopoverState {
  assertions: GenomeAssertion[];
  category: string;
  sessionLabel: string;
}

type Density = "comfortable" | "compact";

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
  const [density, setDensity] = useState<Density>("comfortable");
  const [visibleStart, setVisibleStart] = useState(1);
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

  const openPopover = useCallback((_e: React.MouseEvent, assertions: GenomeAssertion[], category: string, sessionLabel: string) => {
    setTooltip(null);
    setPopover({ assertions, category, sessionLabel });
  }, []);

  const closePopover = useCallback(() => setPopover(null), []);

  const sessionCount = data.teachingSessionCount;
  const paged = sessionCount > PAGE_SIZE;
  const clampedStart = Math.min(Math.max(1, visibleStart), Math.max(1, sessionCount - PAGE_SIZE + 1));
  const effectiveStart = paged ? clampedStart : 1;
  const effectiveEnd = paged ? Math.min(sessionCount, effectiveStart + PAGE_SIZE - 1) : sessionCount;

  const visibleSessions = useMemo(
    () => data.sessions.filter((s) => s.teachingIndex >= effectiveStart && s.teachingIndex <= effectiveEnd),
    [data.sessions, effectiveStart, effectiveEnd],
  );
  const visibleCount = visibleSessions.length;

  // Categories present anywhere in the visible window (empty-row collapse is implicit)
  const sortedCategories = useMemo(() => {
    const set = new Set<string>();
    for (const s of visibleSessions) {
      for (const cat of Object.keys(s.categories)) {
        if ((s.categories[cat] || 0) > 0) set.add(cat);
      }
    }
    return [...set].sort();
  }, [visibleSessions]);

  // Partition journey stops into pre/teaching/post, restricted to visible teaching range
  const journeyGroups = useMemo(() => {
    if (!data.journeyStops?.length) return null;
    const pre: GenomeJourneyStop[] = [];
    const teaching: GenomeJourneyStop[] = [];
    const post: GenomeJourneyStop[] = [];
    let seenTeaching = false;
    let lastTeachingIdx = -1;

    for (let i = data.journeyStops.length - 1; i >= 0; i--) {
      if (data.journeyStops[i].teachingIndex !== null) { lastTeachingIdx = i; break; }
    }

    for (let i = 0; i < data.journeyStops.length; i++) {
      const stop = data.journeyStops[i];
      if (stop.teachingIndex !== null) {
        seenTeaching = true;
        if (stop.teachingIndex >= effectiveStart && stop.teachingIndex <= effectiveEnd) {
          teaching.push(stop);
        }
      } else if (!seenTeaching) {
        pre.push(stop);
      } else if (i > lastTeachingIdx) {
        post.push(stop);
      }
    }
    return { pre, teaching, post };
  }, [data.journeyStops, effectiveStart, effectiveEnd]);

  if (data.teachingSessionCount === 0) {
    return (
      <div className="genome-empty">
        No lesson plan generated yet. Generate a lesson plan to see the course genome.
      </div>
    );
  }

  // Grid template: label column + one column per *visible* teaching session.
  // minmax(0, 1fr) lets columns shrink below content width so the matrix fits the viewport.
  const containerStyle = {
    "--genome-cols": `120px repeat(${visibleCount}, minmax(0, 1fr))`,
    "--genome-journey-cols": `120px auto repeat(${visibleCount}, minmax(0, 1fr)) auto`,
  } as CSSProperties;

  // Column index helpers — grid column 1 = label, visible session `s` → column `s - effectiveStart + 2`.
  const colForSession = (s: number) => s - effectiveStart + 2;

  // Visible learning outcomes (clipped to window)
  const visibleLOs = useMemo(
    () =>
      data.learningOutcomes
        .map((lo, i) => {
          const cs = Math.max(lo.sessionStart, effectiveStart);
          const ce = Math.min(lo.sessionEnd, effectiveEnd);
          if (ce < cs) return null;
          return { lo, originalIndex: i, clippedStart: cs, clippedEnd: ce };
        })
        .filter((x): x is { lo: (typeof data.learningOutcomes)[number]; originalIndex: number; clippedStart: number; clippedEnd: number } => x !== null),
    [data.learningOutcomes, effectiveStart, effectiveEnd],
  );

  // Visible modules (clipped to window)
  const visibleModules = useMemo(
    () =>
      data.modules
        .map((mod, i) => {
          const cs = Math.max(mod.sessionStart, effectiveStart);
          const ce = Math.min(mod.sessionEnd, effectiveEnd);
          if (ce < cs) return null;
          return { mod, originalIndex: i, clippedStart: cs, clippedEnd: ce };
        })
        .filter((x): x is { mod: (typeof data.modules)[number]; originalIndex: number; clippedStart: number; clippedEnd: number } => x !== null),
    [data.modules, effectiveStart, effectiveEnd],
  );

  const canPrev = paged && effectiveStart > 1;
  const canNext = paged && effectiveEnd < sessionCount;

  return (
    <div className="genome" ref={containerRef} data-density={density}>
      {/* Header */}
      <div className="genome-header">
        <span className="genome-header-title">Course Genome</span>
        <span className="genome-header-stats">
          {sessionCount} sessions · {data.modules.length} modules · {data.totalAssertions} teaching points
        </span>
      </div>

      {/* View controls */}
      <div className="genome-controls">
        <div className="genome-density-toggle" role="group" aria-label="Density">
          <button
            type="button"
            className={`genome-density-btn${density === "comfortable" ? " genome-density-btn--active" : ""}`}
            onClick={() => setDensity("comfortable")}
          >
            Comfortable
          </button>
          <button
            type="button"
            className={`genome-density-btn${density === "compact" ? " genome-density-btn--active" : ""}`}
            onClick={() => setDensity("compact")}
          >
            Compact
          </button>
        </div>
        {paged && (
          <div className="genome-pager">
            <button
              type="button"
              className="genome-pager-btn"
              disabled={!canPrev}
              onClick={() => setVisibleStart(Math.max(1, effectiveStart - PAGE_SIZE))}
            >
              ← Prev
            </button>
            <span className="genome-pager-label">
              Sessions {effectiveStart}–{effectiveEnd} of {sessionCount}
            </span>
            <button
              type="button"
              className="genome-pager-btn"
              disabled={!canNext}
              onClick={() => setVisibleStart(Math.min(sessionCount - PAGE_SIZE + 1, effectiveStart + PAGE_SIZE))}
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Category legend — shows one chip per category present in the visible window */}
      {sortedCategories.length > 0 && (
        <div className="genome-legend">
          {sortedCategories.map((cat) => {
            const style = getCategoryStyle(cat);
            const total = visibleSessions.reduce((sum, s) => sum + (s.categories[cat] || 0), 0);
            return (
              <span key={cat} className="genome-legend-chip" title={cat}>
                <span
                  className="genome-legend-swatch"
                  style={{ background: getCategoryColor(cat) }}
                />
                <span className="genome-legend-label">{style.label}</span>
                <span className="genome-legend-count">{total}</span>
              </span>
            );
          })}
        </div>
      )}

      <div className="genome-container" style={containerStyle}>
        {/* ═══ AXIS: Session headers ═══ */}
        <div className="genome-axis">
          <div className="genome-track-label">Session</div>
          {visibleSessions.map((s) => (
            <div key={s.teachingIndex} className="genome-axis-cell">
              <div className="genome-axis-num">{s.teachingIndex}</div>
              <div className="genome-axis-type">{s.type}</div>
            </div>
          ))}
        </div>

        {/* ═══ TRACK 1: Module spans ═══ */}
        {visibleModules.length > 0 && (
          <div className="genome-track">
            <div className="genome-track-label">Modules</div>
            {visibleModules.map(({ mod, originalIndex, clippedStart, clippedEnd }) => (
              <div
                key={`mod-${mod.slug}`}
                className="genome-module-span"
                style={{
                  gridColumn: `${colForSession(clippedStart)} / ${colForSession(clippedEnd) + 1}`,
                  "--module-color": MODULE_COLORS[originalIndex % MODULE_COLORS.length],
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
              </div>
            ))}
          </div>
        )}

        {/* ═══ TRACK 2: Learning Outcomes ═══ */}
        {visibleLOs.length > 0 && (
          <div className="genome-lo-track">
            <div className="genome-lo-track-header">
              <span className="genome-track-label">Outcomes</span>
            </div>
            {visibleLOs.map(({ lo, originalIndex, clippedStart, clippedEnd }) => (
              <div key={lo.ref} className="genome-lo-row">
                <div />
                <div
                  className="genome-lo-bar"
                  style={{
                    gridColumn: `${colForSession(clippedStart)} / ${colForSession(clippedEnd) + 1}`,
                    "--lo-color": LO_COLORS[originalIndex % LO_COLORS.length],
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
        <div className="genome-track">
          <div className="genome-track-label">Teaching Points</div>
          {visibleSessions.map((s) => {
            const maxCount = Math.max(...visibleSessions.map((ss) => ss.totalAssertions), 1);
            return (
              <div
                key={s.teachingIndex}
                className="genome-tp-cell"
                onClick={() => onSessionClick?.(s.session)}
                onMouseEnter={(e) =>
                  showTooltip(e, `${s.label}`, [
                    `${s.totalAssertions} teaching points`,
                    ...Object.entries(s.categories)
                      .sort(([, a], [, b]) => b - a)
                      .map(([cat, count]) => `${getCategoryStyle(cat).label}: ${count}`),
                    ...(s.loRefs.length > 0 ? [`LOs: ${s.loRefs.join(", ")}`] : []),
                  ])
                }
                onMouseLeave={hideTooltip}
              >
                {sortedCategories.map((cat) => {
                  const count = s.categories[cat] || 0;
                  if (count === 0) return null;
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
                      <span>{getCategoryStyle(cat).label}</span>
                      <span>{count}</span>
                    </div>
                  );
                })}
                <div className="genome-tp-total">{s.totalAssertions}</div>
              </div>
            );
          })}
        </div>

        {/* ═══ TRACK 4: Journey Rail (full lesson plan aligned to genome) ═══ */}
        {journeyGroups && (
          <div className="genome-journey-track">
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

            {/* Teaching stops — aligned to visible session columns */}
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

      {/* Assertion list drawer */}
      <HFDrawer
        open={popover !== null}
        onClose={closePopover}
        title={popover ? `${popover.sessionLabel} — ${popover.category}` : ''}
      >
        <div className="genome-popover-list">
          {popover?.assertions.map((a) => (
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
      </HFDrawer>
    </div>
  );
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
