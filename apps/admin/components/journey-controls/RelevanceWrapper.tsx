"use client";

/**
 * RelevanceWrapper — Phase 0 of the Journey-Design tab refactor.
 *
 * Wraps a journey-control field and renders the appropriate
 * relevance-state overlay. Five mutually-exclusive states:
 *
 *   active       — nothing to indicate; children render bare
 *   inherited    — value comes from a parent layer (Domain/System);
 *                  child is wrapped in a LayerBadge chip
 *   auto-derived — value is computed/coupled (e.g. cascade-derived
 *                  banding); operator can decouple via `unlockAction`
 *   gated-off    — a parent setting holds this control to its off-state;
 *                  clicking the chip jumps to the parent
 *   out-of-shape — the contract's `appliesTo` excludes the current
 *                  course shape (e.g. module-scoped settings on a
 *                  continuous course)
 *
 * Priority order (`computeRelevanceState` enforces):
 *   out-of-shape > gated-off > auto-derived > inherited > active
 *
 * Sibling primitives: `<LayerBadge>` (cascade chip — used here for the
 * inherited state to honour `.claude/rules/cascade-reuse.md`).
 */

import "./relevance-wrapper.css";

import { Lock } from "lucide-react";

export type RelevanceState =
  | "active"
  | "inherited"
  | "auto-derived"
  | "gated-off"
  | "out-of-shape";

export interface RelevanceWrapperProps {
  /** Which relevance state the field is in. */
  state: RelevanceState;
  /** Human-readable rationale — surfaced in the chip on `auto-derived`
   *  and `out-of-shape`. e.g. "Continuous courses don't use modules". */
  reason?: string;
  /** Contract id of the gating parent — used by `gated-off` to wire
   *  the chip's click handler. */
  parentSettingId?: string;
  /** Educator-facing label of the gating parent (e.g. "NPS enabled"). */
  parentSettingLabel?: string;
  /** Layer of origin for `inherited` — e.g. "Domain" or "System". */
  layerOrigin?: string;
  /** Click handler for the `auto-derived` decouple action. */
  unlockAction?: () => void;
  /** Click handler for the `gated-off` chip. */
  onJumpToParent?: (settingId: string) => void;
  /** The wrapped control. */
  children: React.ReactNode;
}

/**
 * Render the appropriate overlay + child for the given relevance state.
 *
 * `active` short-circuits to a fragment — no wrapper at all. The other
 * four states render an overlay container with a status chip and the
 * (possibly visually-muted) children below.
 */
export function RelevanceWrapper({
  state,
  reason,
  parentSettingId,
  parentSettingLabel,
  layerOrigin,
  unlockAction,
  onJumpToParent,
  children,
}: RelevanceWrapperProps): React.ReactElement {
  if (state === "active") {
    return <>{children}</>;
  }

  if (state === "inherited") {
    // Cascade-aware inherited rendering. We don't have an Effective
    // envelope here (this wrapper is shape-aware, not cascade-aware —
    // cascade lives in LayerBadge). Render a minimal "inherited from X"
    // chip so the operator sees provenance without a full cascade tray.
    return (
      <div
        className="hf-relevance-wrap hf-relevance-wrap--inherited"
        data-state="inherited"
      >
        <div className="hf-relevance-chip hf-relevance-chip--inherited">
          <span aria-hidden="true" className="hf-relevance-chip-icon">↑</span>
          <span className="hf-relevance-chip-text">
            Inherited
            {layerOrigin ? ` from ${layerOrigin}` : ""}
          </span>
        </div>
        <div className="hf-relevance-children">{children}</div>
      </div>
    );
  }

  if (state === "auto-derived") {
    return (
      <div
        className="hf-relevance-wrap hf-relevance-wrap--auto-derived"
        data-state="auto-derived"
      >
        <div className="hf-relevance-chip hf-relevance-chip--auto-derived">
          <Lock
            size={12}
            aria-hidden={true}
            focusable="false"
            className="hf-relevance-chip-icon"
          />
          <span className="hf-relevance-chip-text">
            {reason ?? "Auto-derived"}
          </span>
          {unlockAction ? (
            <button
              type="button"
              onClick={unlockAction}
              className="hf-relevance-chip-action"
              aria-label="Decouple this setting from its derived source"
            >
              Decouple
            </button>
          ) : null}
        </div>
        <div className="hf-relevance-children hf-relevance-children--muted">
          {children}
        </div>
      </div>
    );
  }

  if (state === "gated-off") {
    const chipText = parentSettingLabel
      ? `Enable ${parentSettingLabel} first`
      : "Disabled by parent setting";
    const handleJump = () => {
      if (parentSettingId && onJumpToParent) {
        onJumpToParent(parentSettingId);
      }
    };
    const clickable = Boolean(parentSettingId && onJumpToParent);
    return (
      <div
        className="hf-relevance-wrap hf-relevance-wrap--gated-off"
        data-state="gated-off"
      >
        {clickable ? (
          <button
            type="button"
            onClick={handleJump}
            className="hf-relevance-chip hf-relevance-chip--gated-off hf-relevance-chip-button"
            aria-label={`Jump to parent setting: ${parentSettingLabel ?? parentSettingId}`}
          >
            <span aria-hidden="true" className="hf-relevance-chip-icon">⊘</span>
            <span className="hf-relevance-chip-text">{chipText}</span>
          </button>
        ) : (
          <div className="hf-relevance-chip hf-relevance-chip--gated-off">
            <span aria-hidden="true" className="hf-relevance-chip-icon">⊘</span>
            <span className="hf-relevance-chip-text">{chipText}</span>
          </div>
        )}
        <div className="hf-relevance-children hf-relevance-children--muted">
          {children}
        </div>
      </div>
    );
  }

  // out-of-shape
  return (
    <div
      className="hf-relevance-wrap hf-relevance-wrap--out-of-shape"
      data-state="out-of-shape"
    >
      <div className="hf-relevance-chip hf-relevance-chip--out-of-shape">
        <span aria-hidden="true" className="hf-relevance-chip-icon">∅</span>
        <span className="hf-relevance-chip-text">
          {reason ?? "Doesn't apply to this course shape"}
        </span>
      </div>
      <div className="hf-relevance-children hf-relevance-children--muted">
        {children}
      </div>
    </div>
  );
}
