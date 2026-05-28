"use client";

import React from "react";
import {
  Donut,
  DeltaPill,
} from "@/components/shared/display-primitives";
import { pct } from "@/lib/caller-insights/formatNum";

type CallLite = {
  id: string;
  source: string;
  createdAt: string | Date;
};

type ScoreLite = {
  callId: string;
  parameterId: string;
  score: number;
  scoredAt?: string | Date;
  createdAt?: string | Date;
};

type Props = {
  calls: CallLite[];
  scores: ScoreLite[];
};

const MOCK_SOURCES = new Set(["mock", "MOCK", "mock_exam", "MOCK_EXAM"]);

/**
 * Mock Results — compact recap of the latest Mock attempt.
 *
 * Self-hides when there are no Mock calls. Renders the latest aggregate
 * Mock score as a Donut, with a DeltaPill against the prior Mock.
 */
export function MockResultV2({ calls, scores }: Props): React.ReactElement | null {
  const mocks = (calls ?? [])
    .filter((c) => MOCK_SOURCES.has(c.source))
    .sort((a, b) => {
      const at = new Date(a.createdAt).getTime();
      const bt = new Date(b.createdAt).getTime();
      return bt - at;
    });

  if (mocks.length === 0) return null;

  const latest = mocks[0];
  const previous = mocks[1] ?? null;

  const aggregateFor = (callId: string): number | null => {
    const rows = (scores ?? []).filter((s) => s.callId === callId);
    if (rows.length === 0) return null;
    return rows.reduce((s, x) => s + x.score, 0) / rows.length;
  };

  const latestScore = aggregateFor(latest.id);
  const previousScore = previous ? aggregateFor(previous.id) : null;
  const delta =
    latestScore != null && previousScore != null
      ? latestScore - previousScore
      : null;

  return (
    <div className="hf-overview-v2-card hf-overview-v2-mock">
      <div className="hf-overview-v2-card-head">
        <h3 className="hf-overview-v2-card-title">Mock results</h3>
        <span className="hf-overview-v2-card-sub">
          {new Date(latest.createdAt).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </span>
      </div>
      <div className="hf-overview-v2-mock-body">
        <Donut value={latestScore} size={96} color="var(--status-success-text)">
          <span className="hf-overview-v2-mock-val">{pct(latestScore)}</span>
        </Donut>
        <div className="hf-overview-v2-mock-meta">
          <span className="hf-overview-v2-mock-meta-label">
            vs previous Mock
          </span>
          {delta != null ? (
            <DeltaPill value={delta} kind="pp" />
          ) : (
            <span className="hf-overview-v2-mock-meta-empty">
              first attempt
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
