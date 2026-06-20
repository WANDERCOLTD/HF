"use client";

/**
 * ConflictWarningChip — Story #2105 (S3 of epic #2102).
 *
 * Renders an amber, non-blocking warning chip above a setting row when
 * `computeRelevanceState` returns `state === "conflicted"`. The chip
 * surfaces an active `SettingConflictDecl` — the operator MAY save the
 * combination; they just need to understand the trade-off.
 *
 * Pattern siblings: `<WriteGateLockChip>` (operator-only signal),
 * `<ProducerOnlyBadge>` (registry-without-consumer signal). All three
 * mount in the same slot in `JourneyInspectorPanel.tsx::SettingRow`
 * above the `<RelevanceWrapper>`. None of them BLOCK the operator —
 * they're informational status signals.
 *
 * Distinct from `<RelevanceWrapper state="gated-off">` (which DISABLES
 * the field) and `<RelevanceWrapper state="auto-derived">` (which
 * MUTES the field). The TL's discipline rule:
 *   - If the system CAN auto-resolve   → use gatedBy / autoEnableLinks.
 *   - If the OPERATOR must understand  → use conflicts[] (this chip).
 *
 * The "Resolve" action navigates the operator to the peer setting via
 * the same `onJumpToParent` handler the gated-off chip uses, so jumping
 * to the conflicting peer is one click.
 */

import { AlertTriangle } from "lucide-react";

interface ConflictWarningChipProps {
  /** The contract id of the peer this row conflicts with. */
  conflictsWithId: string;
  /** Educator-readable resolution text from the declaration. */
  resolution: string;
  /** Educator-facing label of the peer setting (for the Resolve link). */
  peerLabel?: string;
  /** When set, clicking "Resolve" navigates to the peer setting via
   *  the same cross-pane signal used by `<RelevanceWrapper state="gated-off">`. */
  onJumpToPeer?: (settingId: string) => void;
  /** Stable testid suffix — typically the owning contract id. */
  ownerSettingId: string;
}

export function ConflictWarningChip({
  conflictsWithId,
  resolution,
  peerLabel,
  onJumpToPeer,
  ownerSettingId,
}: ConflictWarningChipProps) {
  const handleResolve = () => {
    if (onJumpToPeer) onJumpToPeer(conflictsWithId);
  };

  return (
    <div
      className="hf-conflict-warning-chip"
      data-testid={`hf-conflict-warning-${ownerSettingId}`}
      role="status"
    >
      <AlertTriangle
        size={14}
        aria-hidden
        focusable="false"
        className="hf-conflict-warning-chip-icon"
      />
      <div className="hf-conflict-warning-chip-body">
        <span className="hf-conflict-warning-chip-text">{resolution}</span>
        {onJumpToPeer ? (
          <button
            type="button"
            onClick={handleResolve}
            className="hf-conflict-warning-chip-resolve"
            aria-label={`Jump to conflicting setting${peerLabel ? `: ${peerLabel}` : ""}`}
          >
            Resolve{peerLabel ? ` — ${peerLabel}` : ""}
          </button>
        ) : null}
      </div>
    </div>
  );
}
