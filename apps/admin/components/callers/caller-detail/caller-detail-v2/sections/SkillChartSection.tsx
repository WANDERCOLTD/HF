"use client";

import React from "react";
import { SkillTrendChartCard } from "../../cards/SkillTrendChartCard";
import { Radar } from "@/components/shared/display-primitives";
import { useUpliftData } from "../useUpliftData";
import "./skill-chart-section.css";

type Props = {
  callerId: string;
  scores?: unknown[];
  callerTargets?: unknown[];
};

/**
 * Skill chart + skill radar — paired view of the same skill data.
 *
 * The left card reuses the existing `SkillTrendChartCard` (a multi-line
 * EMA chart, time on the x-axis). The right Radar shows the current shape
 * across skills with each dimension as a band — instant "where strong /
 * where weak". Together the two cards answer different questions about
 * the same parameters.
 */
export function SkillChartSection({
  callerId,
  scores,
  callerTargets,
}: Props): React.ReactElement {
  const { data, loading } = useUpliftData(callerId);

  // One radar dim per skill_* parameter with at least one score; value =
  // average across recorded scores ("current shape" stand-in). React
  // Compiler auto-memos; no manual useMemo needed.
  const radarDims = (data?.scoreTrends ?? [])
    .filter((t) => /^skill_/i.test(t.parameterId))
    .map((t) => {
      const avg = t.scores.length > 0
        ? t.scores.reduce((s, x) => s + x.score, 0) / t.scores.length
        : 0;
      return { id: t.parameterId, label: t.parameterName, value: avg };
    });

  return (
    <div className="hf-uplift-v2-skill-chart">
      <div className="hf-uplift-v2-skill-chart-head">
        <h3 className="hf-uplift-v2-skill-chart-title">Skill chart</h3>
      </div>
      <div className="hf-uplift-v2-skill-chart-body">
        <div className="hf-uplift-v2-skill-chart-timeseries">
          <SkillTrendChartCard
            scores={(scores ?? []) as never}
            callerTargets={(callerTargets ?? []) as never}
          />
        </div>
        <div className="hf-uplift-v2-skill-chart-radar">
          {radarDims.length >= 3 ? (
            <Radar dimensions={radarDims} size={220} />
          ) : (
            <div className="hf-uplift-v2-skill-chart-radar-empty">
              {loading
                ? "Loading…"
                : "Radar appears once 3+ skills have scores."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
