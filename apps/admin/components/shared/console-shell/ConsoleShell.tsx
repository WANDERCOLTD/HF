"use client";

/**
 * ConsoleShell — reusable LH-nav + RHS-panel "operating console" layout.
 *
 * Extracted from the Progress v2 console (`caller-detail-v2/ProgressV2Tab`)
 * so the same shell powers any console-style surface — Progress v2 today,
 * the Course Design Console next (#1263).
 *
 * Responsibilities (presentation only):
 *   - Render a list of `lenses` as LH nav buttons
 *   - Render the active lens's Component in the RHS panel with `lensProps`
 *   - Render an optional `headerBanner` above the shell
 *   - Render a "Coming soon" placeholder for lenses without a `Component`
 *
 * NOT in scope (callers own these):
 *   - URL state — use `useConsoleView` (sibling file) or any other state source
 *   - Telemetry — caller fires from its own wrapper component
 *   - Icon resolution — registry entries carry resolved `iconNode` directly
 *
 * Each lens is generic over `TProps` so the consumer threads its own prop
 * shape through every lens component without the shell knowing about it.
 *
 * @see docs/decisions/2026-04-29-session-flow-canonical-model.md (epic #1263)
 */

import React, { type ComponentType, type ReactNode, type ReactElement } from "react";
import "./console-shell.css";

export interface ConsoleLensDef<TProps> {
  /** Stable id — used in URL state, aria attributes, panel keying. */
  id: string;
  /** Educator-facing label rendered in the LH nav. */
  label: string;
  /** Resolved icon node — caller resolves so the shell stays icon-library-agnostic. */
  iconNode: ReactNode;
  /** Render component. Absent → shell renders the "Coming soon" body. */
  Component?: ComponentType<TProps>;
  /** Optional one-liner shown in the "Coming soon" body when Component is absent. */
  blurb?: string;
}

interface ConsoleShellProps<TId extends string, TProps> {
  /** Ordered list of lens ids — drives nav order. */
  lensOrder: readonly TId[];
  /** Lens registry keyed by id. */
  lenses: Readonly<Record<TId, ConsoleLensDef<TProps>>>;
  /** Props threaded into every lens's Component on every render. */
  lensProps: TProps;
  /** Currently-active lens id. Controlled — caller owns the state. */
  activeLensId: TId;
  /** Lens-change handler — called when a user clicks a nav button. */
  onLensChange: (next: TId) => void;
  /** Optional banner rendered above the shell (e.g. "BETA — new console"). */
  headerBanner?: ReactNode;
  /** Optional help text in the "Coming soon" body — e.g. fallback navigation hint. */
  comingSoonHelpText?: ReactNode;
  /** Accessible label for the LH nav. Defaults to "Console lenses". */
  ariaNavLabel?: string;
  /** Optional id prefix for panel elements — avoids id collisions if two shells mount on one page. */
  idPrefix?: string;
}

export function ConsoleShell<TId extends string, TProps>(
  props: ConsoleShellProps<TId, TProps>,
): ReactElement {
  const {
    lensOrder,
    lenses,
    lensProps,
    activeLensId,
    onLensChange,
    headerBanner,
    comingSoonHelpText,
    ariaNavLabel = "Console lenses",
    idPrefix = "hf-console-shell",
  } = props;

  const activeDef = lenses[activeLensId];

  return (
    <div className="hf-console-shell-root">
      {headerBanner !== undefined && headerBanner !== null && (
        <div className="hf-console-shell-banner">{headerBanner}</div>
      )}
      <div className="hf-console-shell-grid">
        <nav className="hf-console-shell-nav" aria-label={ariaNavLabel}>
          <ul role="tablist">
            {lensOrder.map((id) => {
              const def = lenses[id];
              const isActive = id === activeLensId;
              return (
                <li key={id} className="hf-console-shell-nav-item-wrap">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-controls={`${idPrefix}-panel-${id}`}
                    className={`hf-console-shell-nav-item${
                      isActive ? " hf-console-shell-nav-item--active" : ""
                    }`}
                    onClick={() => onLensChange(id)}
                  >
                    <span className="hf-console-shell-nav-icon">{def.iconNode}</span>
                    <span className="hf-console-shell-nav-label">{def.label}</span>
                    {!def.Component && (
                      <span className="hf-console-shell-nav-soon">soon</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <section
          id={`${idPrefix}-panel-${activeLensId}`}
          role="tabpanel"
          className="hf-console-shell-panel"
          aria-live="polite"
        >
          <LensPanel
            id={activeLensId}
            def={activeDef}
            lensProps={lensProps}
            comingSoonHelpText={comingSoonHelpText}
          />
        </section>
      </div>
    </div>
  );
}

function LensPanel<TId extends string, TProps>({
  id,
  def,
  lensProps,
  comingSoonHelpText,
}: {
  id: TId;
  def: ConsoleLensDef<TProps>;
  lensProps: TProps;
  comingSoonHelpText?: ReactNode;
}): ReactElement {
  if (def.Component) {
    // Cast erases the generic to satisfy createElement — both `Component`
    // and `lensProps` are typed against the same concrete `TProps` at the
    // call site (e.g. `ProgressV2Tab` supplies both), so the runtime
    // assignment is sound. The generic-on-generic spread otherwise trips
    // TS's variance check.
    const Component = def.Component as ComponentType<Record<string, unknown>>;
    return <Component {...(lensProps as Record<string, unknown>)} />;
  }
  return (
    <div className="hf-console-shell-panel-empty">
      <span className="hf-console-shell-coming-soon-tag">Coming soon</span>
      <h3 className="hf-console-shell-panel-title">{def.label}</h3>
      {def.blurb && <p className="hf-console-shell-panel-blurb">{def.blurb}</p>}
      <p className="hf-console-shell-panel-meta">
        Lens id: <code>{id}</code>.
        {comingSoonHelpText ? <> {comingSoonHelpText}</> : null}
      </p>
    </div>
  );
}
