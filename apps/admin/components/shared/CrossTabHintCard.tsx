"use client";

/**
 * CrossTabHintCard — Phase P3b of epic #1850.
 *
 * When the operator clicks a Preview-lens bubble whose owning bucket
 * lives on a different Course Detail tab, the current tab's Inspector
 * has nothing useful to render — the bucket isn't in `BUCKETS_BY_TAB`
 * for this tab. Instead of leaving the Inspector empty (the P3 status
 * quo — silent dead-end), we show this card: "Intake lives on Journey →
 * Open there".
 *
 * Shape mirrors the `out-of-shape` RelevanceWrapper hint pattern from
 * Slice C — a one-line orientation + a primary jump button. No own CSS
 * — composes `hf-card-compact` + `hf-banner-info` for the accent.
 */

import { ArrowRight } from "lucide-react";

interface CrossTabHintCardProps {
  /** Educator-facing label of the bucket the operator's click targets
   *  (e.g. "Sign-up & pre-call profile" for `A_intake`). */
  bucketLabel: string;
  /** Educator-facing label of the tab that owns the bucket
   *  (e.g. "Journey"). */
  owningTabLabel: string;
  /** Caller fires the tab switch + URL sync. */
  onJump: () => void;
}

export function CrossTabHintCard({
  bucketLabel,
  owningTabLabel,
  onJump,
}: CrossTabHintCardProps) {
  return (
    <div
      className="hf-card hf-card-compact"
      data-testid="hf-cross-tab-hint-card"
    >
      <h3 className="hf-section-title">{bucketLabel}</h3>
      <p className="hf-section-desc">
        This setting lives on the <strong>{owningTabLabel}</strong> tab.
      </p>
      <div className="hf-banner-actions">
        <button
          type="button"
          className="hf-btn hf-btn-primary"
          onClick={onJump}
          data-testid="hf-cross-tab-hint-jump"
        >
          Open in {owningTabLabel}
          <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}
