"use client";

import { useState } from "react";

import "./cascade.css";

import type { Effective, Layer } from "@/lib/cascade/layer-types";

type BadgeState = "PB" | "DOM" | "SYS" | "CAL" | "NONE";

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
    case "CALL":
      // No badge token for these layers in Sprint 1 — coarse-fall to SYS.
      return "SYS";
  }
}

function badgeLabel(state: BadgeState): string {
  switch (state) {
    case "PB":
      return "PB";
    case "DOM":
      return "DOM";
    case "SYS":
      return "SYS";
    case "CAL":
      return "CAL";
    case "NONE":
      return "—";
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
      return "set on this Playbook";
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
 * Cascade-honesty layer badge. Renders a 16-18px chip + (optional) inline
 * subtitle. Clicking the chip fires `onInspect` — typically opens
 * `<CascadeInspectorTray>` with the same envelope.
 *
 * Renders on every cascade-eligible field, even when there is no override
 * anywhere (`[—]` state, rendered at muted weight). This matches the
 * cross-tool research convergence in the ADR §5 (under-disclosure causes
 * the #1417 bug class — more incidents than badge fatigue).
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
  const computedSubtitle = subtitle ?? defaultSubtitle(envelope);
  const tooltip = tooltipText(envelope);

  return (
    <span
      className="hf-cascade-badge-wrap"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className={badgeClassName(state)}
        onClick={onInspect}
        aria-label={ariaLabel ?? `Cascade layer: ${badgeLabel(state)}`}
        title={hovered ? tooltip : undefined}
        data-layer={layerForData(envelope.source)}
        data-state={state}
      >
        {badgeLabel(state)}
      </button>
      {!hideSubtitle && computedSubtitle ? (
        <div className="hf-cascade-subtitle">{computedSubtitle}</div>
      ) : null}
    </span>
  );
}

function layerForData(layer: Layer): string {
  return layer.toLowerCase();
}
