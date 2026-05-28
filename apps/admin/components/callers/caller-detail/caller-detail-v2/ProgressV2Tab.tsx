"use client";

/**
 * Progress v2 — Educator Operating Console (BETA).
 *
 * LH menu + RHS context panel. PR 5 lands the full shell with URL `view=`
 * state, lens routing, and the per-lens panels. PR 1a ships a minimal
 * placeholder so the BETA tab is reachable end-to-end.
 */

import React, { useEffect } from "react";
import { trackTabLoad } from "@/lib/caller-insights/telemetry";
import "./progress-v2.css";

type Props = {
  callerId: string;
};

export function ProgressV2Tab({ callerId: _callerId }: Props): React.ReactElement {
  useEffect(() => {
    trackTabLoad("progress-v2");
  }, []);

  return (
    <div className="hf-progress-v2-root">
      <div className="hf-progress-v2-beta-strip">
        BETA — new Educator Operating Console. Full lens shell lands in a later PR.
      </div>
      <div className="hf-progress-v2-shell">
        <nav className="hf-progress-v2-nav" aria-label="Insight lenses">
          <ul>
            {LENS_PLACEHOLDERS.map((lens) => (
              <li key={lens.id} className="hf-progress-v2-nav-item">
                <span className="hf-progress-v2-nav-label">{lens.label}</span>
                <span className="hf-progress-v2-nav-soon">soon</span>
              </li>
            ))}
          </ul>
        </nav>
        <section className="hf-progress-v2-panel" aria-live="polite">
          <div className="hf-progress-v2-panel-empty">
            <h3 className="hf-progress-v2-panel-title">Coming soon</h3>
            <p>
              The LH menu and RHS lens panels are wired in a later PR. In the
              meantime you can use the existing Progress tab.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

const LENS_PLACEHOLDERS: Array<{ id: string; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "parameters", label: "Parameters" },
  { id: "adaptation", label: "Adaptation" },
  { id: "modules", label: "Modules" },
  { id: "goals", label: "Goals" },
  { id: "topics", label: "Topics" },
  { id: "exam", label: "Exam readiness" },
  { id: "plan", label: "Plan" },
  { id: "trajectory", label: "Trajectory" },
];
