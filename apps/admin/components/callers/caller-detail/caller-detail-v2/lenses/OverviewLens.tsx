"use client";

import React from "react";
import {
  Donut,
  StatTile,
  DeltaPill,
} from "@/components/shared/display-primitives";
import { pct, count, fraction } from "@/lib/caller-insights/formatNum";
import { useUpliftData } from "../useUpliftData";

type Props = {
  callerId: string;
};

/**
 * Overview lens — Progress v2 "30-second read".
 *
 * Mirrors the Uplift v2 Hero composition but framed as an educator
 * read-out: small mastery donut, pre→post confidence + knowledge, and
 * stat tiles for calls / days. Click any of the other LH-menu lenses to
 * drill in.
 */
export function OverviewLens({ callerId }: Props): React.ReactElement {
  const { data, loading } = useUpliftData(callerId);

  if (loading) {
    return (
      <div className="hf-progress-v2-lens hf-progress-v2-lens--loading" role="status">
        Loading overview…
      </div>
    );
  }

  const confidenceCurrent = data?.confidencePost ?? data?.confidencePre ?? null;
  const knowledgeCurrent = data?.testScorePost ?? data?.testScorePre ?? null;

  return (
    <div className="hf-progress-v2-lens">
      <div className="hf-progress-v2-lens-head">
        <h3 className="hf-progress-v2-lens-title">Overview</h3>
        <span className="hf-progress-v2-lens-sub">
          {data?.totalCalls ?? 0} call{data?.totalCalls === 1 ? "" : "s"} · {data?.timeOnPlatformDays ?? 0}d
        </span>
      </div>
      <div className="hf-progress-v2-overview-grid">
        <div className="hf-progress-v2-overview-block">
          <Donut value={data?.overallMastery ?? null} size={96}>
            <span className="hf-progress-v2-overview-val">
              {pct(data?.overallMastery)}
            </span>
          </Donut>
          <span className="hf-progress-v2-overview-label">Mastery</span>
        </div>
        <div className="hf-progress-v2-overview-block">
          <Donut
            value={
              confidenceCurrent != null ? confidenceCurrent / 5 : null
            }
            size={96}
            color="var(--status-success-text)"
          >
            <span className="hf-progress-v2-overview-val">
              {confidenceCurrent != null
                ? fraction(confidenceCurrent, 5)
                : "—"}
            </span>
          </Donut>
          <span className="hf-progress-v2-overview-label">Confidence</span>
          {data?.confidenceDelta != null && (
            <DeltaPill value={data.confidenceDelta} kind="abs" />
          )}
        </div>
        <div className="hf-progress-v2-overview-block">
          <Donut
            value={knowledgeCurrent}
            size={96}
            color="var(--status-success-text)"
          >
            <span className="hf-progress-v2-overview-val">
              {pct(knowledgeCurrent)}
            </span>
          </Donut>
          <span className="hf-progress-v2-overview-label">Knowledge</span>
          {data?.knowledgeDelta != null && (
            <DeltaPill value={data.knowledgeDelta} kind="pp" />
          )}
        </div>
        <div className="hf-progress-v2-overview-tiles">
          <StatTile value={count(data?.totalCalls)} label="Calls" compact />
          <StatTile value={count(data?.timeOnPlatformDays)} label="Days" compact />
          <StatTile
            value={count(data?.callFrequencyPerWeek)}
            label="Per week"
            compact
          />
        </div>
      </div>
    </div>
  );
}
