"use client";

import type { CSSProperties, ReactNode } from "react";

import {
  ABOVE_TARGET,
  AWAITING_EVIDENCE,
  tierBackground,
  tierColor,
  tierGlyph,
  tierLabel,
  type TierName,
} from "@/lib/banding/tier-colors";

import "./tier-cell.css";

export interface TierCellProps {
  /**
   * Lowercase tier name from `ParsedSkill.tierScheme`. May also be one of
   * the two special states `AWAITING_EVIDENCE` / `ABOVE_TARGET` exported
   * from `lib/banding/tier-colors.ts`.
   */
  tier: TierName;
  /**
   * Optional cell content — defaults to the glyph alone. Cohort heatmap cells
   * usually pass a count (e.g. `12`); per-learner cells pass `★` when the
   * learner is at-or-above the target tier.
   */
  children?: ReactNode;
  /**
   * Optional secondary label rendered below the glyph. Cohort heatmap uses
   * this for `n of N` lines; per-learner cells use it for the band number.
   */
  caption?: string;
  /**
   * When `target: true`, draws the educator's target tier marker. Pure
   * decoration — does not change the colour/glyph mapping.
   */
  target?: boolean;
  /** Optional explicit tooltip text. Defaults to the `tierLabel`. */
  title?: string;
  /** `compact` shrinks padding for dense heatmap rows. */
  size?: "default" | "compact";
  /** Optional click handler — opens a drill. Click-eligible cells get a hover state via CSS. */
  onClick?: () => void;
  /** Inline-style escape hatch. Avoid; use `size` / `caption` where possible. */
  style?: CSSProperties;
}

/**
 * Single heatmap cell rendering tier visual + optional content.
 *
 * One primitive shared across:
 *
 *   - Course Detail → Skills Framework → Cohort Heatmap lens (cell = `n learners`)
 *   - Course Detail → Skills Framework → Framework Map lens (cell = `★` on target tier)
 *   - Caller Detail → Attainment → Skill Bands section (cell = `band #` per skill)
 *   - Cohort views that want a consistent tier visual (replaces inline `BAND_COLORS`
 *     map at `CohortLearningAggregate.tsx:22-28`)
 *
 * Tier name → colour mapping comes from `lib/banding/tier-colors.ts` — single
 * source so educators see the SAME treatment across surfaces. See that file
 * for the design conventions.
 *
 * Always renders a glyph + label combo (not colour alone) — colourblind-safe.
 */
export function TierCell({
  tier,
  children,
  caption,
  target,
  title,
  size = "default",
  onClick,
  style,
}: TierCellProps) {
  const ariaTitle = title ?? tierLabel(tier);
  const isInteractive = Boolean(onClick);

  const cellStyle: CSSProperties = {
    background: tierBackground(tier),
    color: tierColor(tier),
    ...style,
  };

  const content = children ?? tierGlyph(tier);

  if (isInteractive) {
    return (
      <button
        type="button"
        className={`hf-tier-cell hf-tier-cell--${size} hf-tier-cell--interactive`}
        style={cellStyle}
        onClick={onClick}
        title={ariaTitle}
        aria-label={ariaTitle}
        data-tier={tier}
        data-target={target ? "true" : undefined}
      >
        <span className="hf-tier-cell-content" aria-hidden={typeof content !== "string"}>
          {content}
        </span>
        {target ? <span className="hf-tier-cell-target" aria-label="Target tier">★</span> : null}
        {caption ? <span className="hf-tier-cell-caption">{caption}</span> : null}
      </button>
    );
  }

  return (
    <span
      className={`hf-tier-cell hf-tier-cell--${size}`}
      style={cellStyle}
      title={ariaTitle}
      data-tier={tier}
      data-target={target ? "true" : undefined}
    >
      <span className="hf-tier-cell-content" aria-hidden={typeof content !== "string"}>
        {content}
      </span>
      {target ? <span className="hf-tier-cell-target" aria-label="Target tier">★</span> : null}
      {caption ? <span className="hf-tier-cell-caption">{caption}</span> : null}
    </span>
  );
}

/** Re-export the special states for convenient one-stop import at consumer sites. */
export { AWAITING_EVIDENCE, ABOVE_TARGET };
