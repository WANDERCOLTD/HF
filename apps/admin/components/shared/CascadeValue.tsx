"use client";

import type { ReactNode } from "react";

import type { Effective } from "@/lib/cascade/layer-types";
import { LayerBadge } from "@/components/cascade/LayerBadge";

import "./cascade-value.css";

export interface CascadeValueProps<T = unknown> {
  /** The cascade envelope from `/api/cascade/resolve` or `resolveEffective()`. */
  envelope: Effective<T>;
  /**
   * The rendered display of the effective value. Consumers control the
   * formatting — this wrapper just adds the cascade chip + inspector wiring.
   * Examples: `"0.70"` for a numeric, `"Practitioner"` for a tier, JSX for
   * a complex composite.
   */
  children: ReactNode;
  /**
   * Knob key for telemetry — passed to `<LayerBadge knobKey=...>` so the
   * cascade-inspector-open event groups correctly in the admin telemetry
   * view (#1484). Consumers SHOULD pass this; falling back to "unknown"
   * loses the analytics signal.
   */
  knobKey?: string;
  /**
   * Optional aria-label for the value + chip pair.
   */
  ariaLabel?: string;
  /**
   * Hide the subtitle ("set on this Course" / "inherited from Domain")
   * below the chip. Useful in dense rows (Cohort Heatmap legend, etc.)
   * where the consumer renders its own caption.
   */
  hideSubtitle?: boolean;
  /**
   * Called when the operator clicks the cascade chip — typically opens
   * `<CascadeInspectorTray>` which the consumer mounts with its own scope-chain
   * context (the tray takes `(knobKey, knobLabel, scopeChain, onClose, …)`,
   * which only the host page knows). When omitted, the chip is non-interactive
   * but still renders the source-layer + subtitle.
   */
  onInspect?: () => void;
  /**
   * Render only the chip without the inline value display. Rarely useful — most
   * consumers want the `{value} <chip>` pair. Pass `bare` only when composing
   * the value display yourself.
   */
  bare?: boolean;
}

/**
 * Inline composite that pairs an effective value with its cascade-honesty
 * chip — the canonical render for any educator-facing knob that the
 * cascade resolves across layers (Domain → Course → Segment → Caller → Call).
 *
 * Composition is intentionally thin: `{value} <LayerBadge envelope=...>`.
 * Click semantics delegate to the host via `onInspect` — the consumer mounts
 * `<CascadeInspectorTray>` because tray construction needs scope-chain context
 * the host knows about (currentEditScope, scopeChain, onOverride callbacks).
 *
 * Standalone surfaces (`CascadeLensPanel`, `CascadeInspectorTray`) are KEPT
 * — this primitive is for the INLINE case (e.g. a heatmap cell, a settings
 * row, a Skills Framework tier descriptor) where rendering the full tray
 * inline would be too heavy.
 *
 * Stream A SP1-C from the consolidated Skills Framework + CourseReDesign epic.
 */
export function CascadeValue<T>({
  envelope,
  children,
  knobKey,
  ariaLabel,
  hideSubtitle,
  onInspect,
  bare,
}: CascadeValueProps<T>) {
  if (bare) {
    return (
      <LayerBadge
        envelope={envelope}
        knobKey={knobKey}
        ariaLabel={ariaLabel}
        hideSubtitle={hideSubtitle ?? true}
        onInspect={onInspect}
      />
    );
  }

  return (
    <span className="hf-cascade-value" aria-label={ariaLabel}>
      <span className="hf-cascade-value-display">{children}</span>
      <LayerBadge
        envelope={envelope}
        knobKey={knobKey}
        ariaLabel={ariaLabel ?? "Inspect cascade chain"}
        hideSubtitle={hideSubtitle ?? true}
        onInspect={onInspect}
      />
    </span>
  );
}
