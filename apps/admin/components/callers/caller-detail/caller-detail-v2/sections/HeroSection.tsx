"use client";

import React from "react";
import { Phone, Calendar } from "lucide-react";
import {
  Donut,
  StatTile,
  DeltaPill,
} from "@/components/shared/display-primitives";
import { pct, fraction, count } from "@/lib/caller-insights/formatNum";
import { useUpliftData } from "../useUpliftData";
import "./hero-section.css";

type Props = {
  callerId: string;
};

/**
 * Hero Section — Mastery / Confidence / Knowledge donuts + Calls / Days
 * stat tiles. Confidence and Knowledge donuts show pre→post markers in the
 * centre (no sparkline) since `/uplift` has no per-call series for them —
 * only single pre/post survey points.
 *
 * Empty hero (no calls yet): donuts render `—` placeholders, no DeltaPills,
 * "Awaiting first call" subtitle below.
 */
export function HeroSection({ callerId }: Props): React.ReactElement {
  const { data, loading } = useUpliftData(callerId);

  if (loading) {
    return (
      <div className="hf-uplift-v2-hero hf-uplift-v2-hero--loading" role="status">
        <span>Loading proof points…</span>
      </div>
    );
  }

  const awaitingFirstCall = !data || data.totalCalls === 0;
  const masterySeries = data ? masterySparkline(data.scoreTrends) : [];
  const confidenceCurrent = data?.confidencePost ?? data?.confidencePre ?? null;
  const knowledgeCurrent = data?.testScorePost ?? data?.testScorePre ?? null;

  return (
    <div className="hf-uplift-v2-hero">
      {/* Mastery */}
      <div className="hf-uplift-v2-hero-cell">
        <Donut
          value={data?.overallMastery ?? null}
          size={120}
          color="var(--accent-primary)"
        >
          <span className="hf-uplift-v2-hero-value">
            {pct(data?.overallMastery)}
          </span>
        </Donut>
        <div className="hf-uplift-v2-hero-foot">
          <span className="hf-uplift-v2-hero-label">Mastery</span>
          {masterySeries.length >= 2 && (
            <MasteryMicroSpark series={masterySeries} />
          )}
        </div>
      </div>

      {/* Confidence */}
      <div className="hf-uplift-v2-hero-cell">
        <Donut
          value={
            confidenceCurrent != null ? confidenceCurrent / 5 : null
          }
          size={120}
          color="var(--status-success-text)"
        >
          {data && data.confidencePre != null && data.confidencePost != null ? (
            <PrePostCentre
              pre={fraction(data.confidencePre, 5)}
              post={fraction(data.confidencePost, 5)}
            />
          ) : (
            <span className="hf-uplift-v2-hero-value">
              {confidenceCurrent != null ? fraction(confidenceCurrent, 5) : "—"}
            </span>
          )}
        </Donut>
        <div className="hf-uplift-v2-hero-foot">
          <span className="hf-uplift-v2-hero-label">Confidence</span>
          {data?.confidenceDelta != null && (
            <DeltaPill value={data.confidenceDelta} kind="abs" />
          )}
        </div>
      </div>

      {/* Knowledge */}
      <div className="hf-uplift-v2-hero-cell">
        <Donut
          value={knowledgeCurrent}
          size={120}
          color="var(--status-success-text)"
        >
          {data && data.testScorePre != null && data.testScorePost != null ? (
            <PrePostCentre
              pre={pct(data.testScorePre)}
              post={pct(data.testScorePost)}
            />
          ) : (
            <span className="hf-uplift-v2-hero-value">{pct(knowledgeCurrent)}</span>
          )}
        </Donut>
        <div className="hf-uplift-v2-hero-foot">
          <span className="hf-uplift-v2-hero-label">Knowledge</span>
          {data?.knowledgeDelta != null && (
            <DeltaPill value={data.knowledgeDelta} kind="pp" />
          )}
        </div>
      </div>

      {/* Calls / Days stat tiles */}
      <div className="hf-uplift-v2-hero-tiles">
        <StatTile
          value={count(data?.totalCalls)}
          label="Calls"
          icon={<Phone size={14} />}
          definition="Total completed calls."
        />
        <StatTile
          value={count(data?.timeOnPlatformDays)}
          label="Days active"
          icon={<Calendar size={14} />}
          definition="Distinct days since the first call."
        />
      </div>

      {awaitingFirstCall && (
        <div className="hf-uplift-v2-hero-awaiting">
          Awaiting first call — proof points will populate once data lands.
        </div>
      )}
    </div>
  );
}

function PrePostCentre({
  pre,
  post,
}: {
  pre: string;
  post: string;
}): React.ReactElement {
  return (
    <div className="hf-uplift-v2-hero-prepost">
      <span className="hf-uplift-v2-hero-prepost-pre">{pre}</span>
      <span className="hf-uplift-v2-hero-prepost-arrow">→</span>
      <span className="hf-uplift-v2-hero-prepost-post">{post}</span>
    </div>
  );
}

/**
 * Aggregate score time series → one mastery point per call date by averaging
 * scores across all parameters that landed that day. Falls back to an empty
 * series when there are <2 distinct call dates.
 */
function masterySparkline(
  trends: { parameterId: string; scores: { callDate: string; score: number }[] }[],
): number[] {
  if (!trends || trends.length === 0) return [];
  const byDate = new Map<string, { sum: number; n: number }>();
  for (const t of trends) {
    for (const s of t.scores) {
      const bucket = byDate.get(s.callDate) ?? { sum: 0, n: 0 };
      bucket.sum += s.score;
      bucket.n += 1;
      byDate.set(s.callDate, bucket);
    }
  }
  const dates = Array.from(byDate.keys()).sort();
  return dates.map((d) => {
    const b = byDate.get(d)!;
    return b.sum / b.n;
  });
}

/**
 * Tiny inline SVG sparkline rendered under the Mastery donut. The shared
 * `Sparkline` primitive is overkill for the 60×16 strip under a donut; this
 * stays inline-presentational without sprouting another primitive.
 */
function MasteryMicroSpark({ series }: { series: number[] }): React.ReactElement {
  const width = 60;
  const height = 16;
  const min = Math.min(...series, 0);
  const max = Math.max(...series, 1);
  const range = max - min || 1;
  const stepX = width / Math.max(1, series.length - 1);
  const points = series
    .map((v, i) => `${(i * stepX).toFixed(2)},${(height - ((v - min) / range) * height).toFixed(2)}`)
    .join(" ");
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="hf-uplift-v2-hero-microspark"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--accent-primary)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
