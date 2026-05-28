"use client";

/**
 * Uplift v2 — Learner Proof Report (BETA).
 *
 * Scrolling celebratory report. 12-column CSS grid; sections declare their
 * own span (full / half / third). PR 1a ships the shell with "Coming soon"
 * placeholders so the layout is visible end-to-end. Sections fill in via the
 * UPLIFT_SECTIONS registry over PRs 1b–4.
 */

import React, { useEffect } from "react";
import {
  UPLIFT_SECTIONS,
  UPLIFT_PLACEHOLDERS,
  type UpliftSectionId,
} from "./sections/registry";
import { trackTabLoad } from "@/lib/caller-insights/telemetry";
import "./uplift-v2.css";

type Props = {
  callerId: string;
};

export function UpliftV2Tab({ callerId }: Props): React.ReactElement {
  useEffect(() => {
    trackTabLoad("uplift-v2");
  }, []);

  const ids = Object.keys(UPLIFT_PLACEHOLDERS) as UpliftSectionId[];
  const ordered = ids.sort(
    (a, b) => UPLIFT_PLACEHOLDERS[a].order - UPLIFT_PLACEHOLDERS[b].order,
  );

  return (
    <div className="hf-uplift-v2-root">
      <div className="hf-uplift-v2-beta-strip">
        BETA — new Learner Proof Report. Sections fill in across the next few PRs.
      </div>
      <div className="hf-uplift-v2-grid">
        {ordered.map((id) => {
          const def = UPLIFT_SECTIONS[id];
          const placeholder = UPLIFT_PLACEHOLDERS[id];
          const span = def?.span ?? placeholder.span ?? 12;
          const className = `hf-uplift-v2-section hf-uplift-v2-section--span-${span}`;

          if (def?.Component) {
            const Section = def.Component;
            return (
              <div key={id} className={className}>
                <Section callerId={callerId} />
              </div>
            );
          }
          return (
            <div key={id} className={`${className} hf-uplift-v2-section--placeholder`}>
              <div className="hf-uplift-v2-coming-soon">
                <span className="hf-uplift-v2-coming-soon-tag">Coming soon</span>
                <span className="hf-uplift-v2-coming-soon-label">
                  {def?.comingSoonLabel ?? placeholder.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
