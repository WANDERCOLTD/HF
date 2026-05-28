"use client";

import React from "react";
import { ArrowRight } from "lucide-react";
import "./overview-link-card.css";

type OverviewLinkCardProps = {
  /** Headline shown top-left. */
  title: string;
  /** Optional short subtitle below the title. */
  subtitle?: string;
  /** Optional inline summary (stat tiles / mini-donuts) rendered above the link. */
  summary?: React.ReactNode;
  /** Visible link label. */
  linkLabel: string;
  /** Click handler — typically navigates to ?tab=…-v2. */
  onClick: () => void;
};

/**
 * Slim summary card with a "View detail in <tab>" call-to-action. PR 4.5
 * uses it on the Overview tab to replace SkillBandStripCard +
 * ProgressStackCard — both of those duplicate data that now lives on
 * Uplift v2 / Progress v2, so the Overview tab gives a teaser and a link
 * rather than re-rendering the whole thing.
 *
 * `summary` is freeform so each caller controls the teaser shape (mini
 * donuts, stat tiles, etc.) without spawning a per-card variant.
 */
export function OverviewLinkCard({
  title,
  subtitle,
  summary,
  linkLabel,
  onClick,
}: OverviewLinkCardProps): React.ReactElement {
  return (
    <div className="hf-overview-link-card hf-card">
      <div className="hf-overview-link-head">
        <div className="hf-overview-link-title-wrap">
          <h3 className="hf-overview-link-title">{title}</h3>
          {subtitle && (
            <p className="hf-overview-link-subtitle">{subtitle}</p>
          )}
        </div>
        <button
          type="button"
          className="hf-overview-link-cta"
          onClick={onClick}
        >
          {linkLabel}
          <ArrowRight size={13} />
        </button>
      </div>
      {summary && <div className="hf-overview-link-summary">{summary}</div>}
    </div>
  );
}
