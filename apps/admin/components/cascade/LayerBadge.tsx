"use client";

import { useState } from "react";
import {
  BookOpen,
  Building2,
  Settings,
  User,
  School,
  Phone,
} from "lucide-react";

import "./cascade.css";

import type { Effective, Layer } from "@/lib/cascade/layer-types";

type BadgeState = "PB" | "DOM" | "SYS" | "CAL" | "SEG" | "CALLLAYER" | "NONE";

function stateFromEffective(envelope: Effective<unknown>): BadgeState {
  if (envelope.layers.length === 0) return "NONE";
  switch (envelope.source) {
    case "PLAYBOOK":
      return "PB";
    case "DOMAIN":
      return "DOM";
    case "SYSTEM":
      return "SYS";
    case "CALLER":
      return "CAL";
    case "SEGMENT":
      return "SEG";
    case "CALL":
      return "CALLLAYER";
  }
}

/**
 * Sidebar-aligned icon per cascade layer (#1467 follow-up).
 *
 * The operator already learns these glyphs from the global nav
 * (`sidebar-manifest.json`): BookOpen on "Courses", User on "Callers",
 * School on "Cohorts", Settings on "Settings", Phone on telephony surfaces.
 * Reusing the same icons for cascade-honesty chips means "the value lives
 * where this glyph lives" — no extra vocabulary tax on the educator.
 */
function iconForState(state: BadgeState): React.ReactNode {
  const props = { size: 12, "aria-hidden": true, focusable: "false" as const };
  switch (state) {
    case "PB":
      return <BookOpen {...props} />; // sidebar `Courses`
    case "DOM":
      return <Building2 {...props} />; // TopBar institution
    case "SYS":
      return <Settings {...props} />; // sidebar `Settings`
    case "CAL":
      return <User {...props} />; // sidebar `Callers`
    case "SEG":
      return <School {...props} />; // sidebar `Cohorts`
    case "CALLLAYER":
      return <Phone {...props} />;
    case "NONE":
      return null; // muted dash glyph rendered by caller
  }
}

function srLabel(state: BadgeState): string {
  switch (state) {
    case "PB":
      return "Course";
    case "DOM":
      return "Domain";
    case "SYS":
      return "System default";
    case "CAL":
      return "Caller";
    case "SEG":
      return "Segment";
    case "CALLLAYER":
      return "Call";
    case "NONE":
      return "No override";
  }
}

function badgeClassName(state: BadgeState): string {
  return `hf-cascade-badge hf-cascade-badge--${state.toLowerCase()}`;
}

function defaultSubtitle(envelope: Effective<unknown>): string {
  if (envelope.layers.length === 0) {
    return "(no override — using System default)";
  }
  switch (envelope.source) {
    case "PLAYBOOK":
      return "set on this Course";
    case "DOMAIN": {
      const dom = envelope.layers.find((h) => h.layer === "DOMAIN");
      return dom ? `inherited from ${dom.scopeLabel}` : "inherited from Domain";
    }
    case "SYSTEM":
      return "using System default";
    case "CALLER":
      return "caller-scope override";
    case "SEGMENT":
    case "CALL":
      return "";
  }
}

function tooltipText(envelope: Effective<unknown>): string {
  if (envelope.layers.length === 0) {
    return "No override at any layer — using System default. Click for the full chain.";
  }
  const winner = envelope.layers.find((h) => h.layer === envelope.source);
  if (!winner) return defaultSubtitle(envelope);
  const setBy = winner.setBy ?? "(unknown)";
  const setAt = winner.setAt
    ? new Date(winner.setAt).toLocaleDateString()
    : null;
  const provenance = setAt
    ? `Set by ${setBy} on ${setAt}`
    : `Set by ${setBy}`;
  return `${defaultSubtitle(envelope)}. ${provenance}. Click for the full chain.`;
}

export interface LayerBadgeProps {
  envelope: Effective<unknown>;
  onInspect?: () => void;
  /** Override the default subtitle (e.g., when the consumer wants its own copy). */
  subtitle?: string;
  /** Hide the inline subtitle if the consumer renders one elsewhere. */
  hideSubtitle?: boolean;
  /** Optional aria-label override; defaults to "Cascade layer: <state>". */
  ariaLabel?: string;
}

/**
 * Cascade-honesty layer badge. Renders a small icon chip (sidebar-aligned)
 * + (optional) inline subtitle. Clicking the chip fires `onInspect` —
 * typically opens `<CascadeInspectorTray>` with the same envelope.
 *
 * When `onInspect` is provided, a discoverable "⋯" kebab affordance renders
 * next to the chip — visually hidden at rest, revealed on hover or
 * focus-within. This is the canonical entry point for opening the full
 * cascade inspector; the chip itself remains clickable as a quick path so
 * existing consumer wiring continues to work (#1469).
 *
 * Renders on every cascade-eligible field, even when there is no override
 * anywhere (`NONE` state — muted dash glyph, not a sidebar icon). This
 * matches the ADR §5 research finding that under-disclosure causes the
 * #1417 bug class — more incidents than badge fatigue.
 */
export function LayerBadge({
  envelope,
  onInspect,
  subtitle,
  hideSubtitle,
  ariaLabel,
}: LayerBadgeProps) {
  const [hovered, setHovered] = useState(false);
  const state = stateFromEffective(envelope);
  const iconNode = iconForState(state);
  const label = srLabel(state);
  const computedSubtitle = subtitle ?? defaultSubtitle(envelope);
  const tooltip = tooltipText(envelope);
  const chipAriaLabel = ariaLabel ?? `Cascade layer: ${label}`;

  return (
    <span
      className="hf-cascade-badge-wrap"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className="hf-cascade-badge-row">
        <button
          type="button"
          className={badgeClassName(state)}
          onClick={onInspect}
          aria-label={chipAriaLabel}
          aria-haspopup={onInspect ? "dialog" : undefined}
          title={hovered ? tooltip : undefined}
          data-layer={layerForData(envelope.source)}
          data-state={state}
        >
          {iconNode ?? <span aria-hidden>—</span>}
        </button>
        {onInspect ? (
          <button
            type="button"
            className="hf-cascade-badge-kebab"
            onClick={(e) => {
              e.stopPropagation();
              onInspect();
            }}
            aria-label={`Inspect cascade chain — ${chipAriaLabel}`}
            aria-haspopup="dialog"
            data-testid="hf-cascade-badge-kebab"
          >
            <span aria-hidden="true">⋯</span>
          </button>
        ) : null}
      </span>
      {!hideSubtitle && computedSubtitle ? (
        <div className="hf-cascade-subtitle">{computedSubtitle}</div>
      ) : null}
    </span>
  );
}

function layerForData(layer: Layer): string {
  return layer.toLowerCase();
}
