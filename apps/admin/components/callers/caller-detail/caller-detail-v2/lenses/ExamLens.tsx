"use client";

import React from "react";
import {
  Donut,
  HeatmapStrip,
  Radar,
} from "@/components/shared/display-primitives";
import { pct } from "@/lib/caller-insights/formatNum";
import { useUpliftData } from "../useUpliftData";

type Props = {
  callerId: string;
};

const READINESS_THRESHOLD = 0.7;

/**
 * Exam readiness lens — a thin v2 read.
 *
 * Composes three existing primitives: a Donut for overall mastery against
 * a threshold, a Radar of the weakest modules to surface where to spend
 * time, and a Heatmap of every module so educators see the whole picture
 * in one panel.
 *
 * The full v1 Exam Readiness (per-test gating, formative attempts, etc.)
 * remains canonical until cutover; this lens is the at-a-glance view.
 */
export function ExamLens({ callerId }: Props): React.ReactElement {
  const { data, loading } = useUpliftData(callerId);

  if (loading) {
    return (
      <div className="hf-progress-v2-lens hf-progress-v2-lens--loading" role="status">
        Loading exam readiness…
      </div>
    );
  }

  const mastery = data?.overallMastery ?? 0;
  const modules = data?.moduleProgress ?? [];
  const weakModules = modules
    .filter((m) => m.mastery < READINESS_THRESHOLD)
    .sort((a, b) => a.mastery - b.mastery)
    .slice(0, 6); // Radar is most legible with ≤6-8 axes.

  const radarDims = weakModules.map((m) => ({
    id: m.moduleId,
    label: m.title,
    value: m.mastery,
    target: READINESS_THRESHOLD,
  }));

  const heatCells = [...modules]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((m) => ({
      key: m.moduleId,
      label: m.title,
      value: m.mastery,
    }));

  const readyForExam = mastery >= READINESS_THRESHOLD;

  return (
    <div className="hf-progress-v2-lens">
      <div className="hf-progress-v2-lens-head">
        <h3 className="hf-progress-v2-lens-title">Exam readiness</h3>
        <span className="hf-progress-v2-lens-sub">
          target {pct(READINESS_THRESHOLD)}
        </span>
      </div>
      <div className="hf-progress-v2-exam-grid">
        <div className="hf-progress-v2-exam-donut">
          <Donut
            value={mastery}
            size={140}
            color={
              readyForExam
                ? "var(--status-success-text)"
                : "var(--accent-primary)"
            }
          >
            <div className="hf-progress-v2-exam-donut-centre">
              <span className="hf-progress-v2-exam-donut-value">
                {pct(mastery)}
              </span>
              <span className="hf-progress-v2-exam-donut-label">
                {readyForExam ? "READY" : "BUILDING"}
              </span>
            </div>
          </Donut>
        </div>
        <div className="hf-progress-v2-exam-radar">
          {radarDims.length >= 3 ? (
            <Radar dimensions={radarDims} size={220} />
          ) : (
            <div className="hf-progress-v2-exam-radar-empty">
              {modules.length === 0
                ? "No module data yet."
                : "All modules above readiness threshold — no weak focus areas."}
            </div>
          )}
        </div>
      </div>
      <HeatmapStrip
        cells={heatCells}
        emptyText="No module progress yet."
      />
    </div>
  );
}
