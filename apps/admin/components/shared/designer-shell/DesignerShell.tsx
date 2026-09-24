"use client";

/**
 * DesignerShell — three-slot CSS-grid layout for designer-style consoles
 * (Course Design Console first; future designer-style surfaces share it).
 *
 * Sister of `ConsoleShell` (the two-column nav+panel shell powering Progress
 * v2 and many other operating-console pages). `DesignerShell` adds a third
 * column — the Inspector — for selection-aware right-rail UI.
 *
 * Responsibilities (presentation only):
 *   - Render three named slots: `nav` (LH), `canvas` (centre), `inspector` (RH)
 *   - When `inspector === null` the right column is structurally absent (NOT
 *     rendered as a blank panel) so the canvas reclaims the width
 *   - Below 1200px viewport, the inspector flips to an overlay drawer rather
 *     than collapsing the canvas
 *
 * NOT in scope (callers own these):
 *   - URL state for selected section — use `useDesignerSelection` (sibling)
 *   - Renderer registry — use `section-registry.ts` (sibling)
 *   - The canvas content — pass a fully-mounted node (today: existing
 *     CourseDesignConsole inside `app/x/courses/[id]/_tab/DesignTab.tsx`)
 *
 * S4 of #1555 — pure scaffolding. Zero Preview behaviour change. The
 * follow-on epic (#1559 follow-ups) wires renderers into the registry; this
 * story just makes the slot.
 *
 * Tokens only — no hardcoded hex. `hf-designer-*` namespace per the rule's
 * `hf-` prefix discipline.
 */

import { useEffect, useState, type ReactNode } from "react";

import "./designer-shell.css";

interface DesignerShellProps {
  /** LH nav slot — typically the existing 14-lens nav from CourseDesignConsole.
   *  `null` → column absent + canvas reclaims width (mirrors inspector). */
  nav: ReactNode | null;
  /** Centre canvas slot — typically the existing console / preview content. */
  canvas: ReactNode;
  /** Extra class names appended to `hf-designer-canvas`. Today: tri-pane
   *  consumers pass `hf-designer-canvas-dim` when the LH selection has no
   *  discrete Preview bubble (cross-cutting). Keeps the markup flat — no
   *  inner wrapper div around the canvas content. */
  canvasClassName?: string;
  /** RH inspector slot. `null` → column absent + canvas reclaims width. */
  inspector?: ReactNode | null;
  /** Optional banner rendered above the shell (e.g. "BETA — new designer"). */
  headerBanner?: ReactNode;
  /** Title for the inspector drawer (mobile/narrow-viewport only). */
  inspectorTitle?: string;
  /** Optional id prefix to avoid collisions when two shells mount on one page. */
  idPrefix?: string;
}

const NARROW_VIEWPORT_PX = 1200;

export function DesignerShell({
  nav,
  canvas,
  canvasClassName,
  inspector = null,
  headerBanner,
  inspectorTitle = "Inspector",
  idPrefix = "hf-designer",
}: DesignerShellProps) {
  const hasNav = nav != null;
  const hasInspector = inspector != null;
  const [isNarrow, setIsNarrow] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Track viewport width — flip the inspector to overlay-drawer mode below
  // the breakpoint. Single matchMedia listener; SSR-safe via window guard.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(`(max-width: ${NARROW_VIEWPORT_PX - 1}px)`);
    const update = () => setIsNarrow(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  // When the inspector content disappears (e.g. user clears selection),
  // close the drawer too so the next selection cleanly re-opens it.
  useEffect(() => {
    if (!hasInspector) setDrawerOpen(false);
    else if (isNarrow) setDrawerOpen(true);
  }, [hasInspector, isNarrow]);

  const inspectorVisibleInline = hasInspector && !isNarrow;
  const drawerVisible = hasInspector && isNarrow && drawerOpen;
  const inspectorPanelId = `${idPrefix}-inspector`;

  return (
    <div
      className={`hf-designer-shell ${
        hasNav
          ? "hf-designer-shell-with-nav"
          : "hf-designer-shell-no-nav"
      } ${
        inspectorVisibleInline
          ? "hf-designer-shell-with-inspector"
          : "hf-designer-shell-no-inspector"
      }`}
    >
      {headerBanner ? (
        <div className="hf-designer-banner">{headerBanner}</div>
      ) : null}

      <div className="hf-designer-grid">
        {hasNav ? (
          <aside className="hf-designer-nav" aria-label="Designer navigation">
            {nav}
          </aside>
        ) : null}

        <main
          className={`hf-designer-canvas${
            canvasClassName ? ` ${canvasClassName}` : ""
          }`}
        >
          {canvas}
        </main>

        {inspectorVisibleInline ? (
          <aside
            className="hf-designer-inspector"
            id={inspectorPanelId}
            aria-label={inspectorTitle}
          >
            {inspector}
          </aside>
        ) : null}

        {hasInspector && isNarrow ? (
          <button
            type="button"
            className="hf-designer-drawer-toggle"
            onClick={() => setDrawerOpen((v) => !v)}
            aria-expanded={drawerOpen}
            aria-controls={inspectorPanelId}
          >
            {drawerOpen ? "Hide" : "Show"} {inspectorTitle.toLowerCase()}
          </button>
        ) : null}
      </div>

      {drawerVisible ? (
        <div className="hf-designer-drawer-backdrop" role="presentation">
          <aside
            className="hf-designer-drawer"
            id={inspectorPanelId}
            aria-label={inspectorTitle}
          >
            <header className="hf-designer-drawer-header">
              <h2 className="hf-designer-drawer-title">{inspectorTitle}</h2>
              <button
                type="button"
                className="hf-designer-drawer-close"
                onClick={() => setDrawerOpen(false)}
                aria-label={`Close ${inspectorTitle}`}
              >
                ×
              </button>
            </header>
            <div className="hf-designer-drawer-body">{inspector}</div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
