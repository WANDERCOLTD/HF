"use client";

import React from "react";
import {
  EQMixer,
  type EQBand,
  type EQTrack,
} from "@/components/shared/display-primitives";
import { useUpliftData } from "../useUpliftData";
import type { ScoreTrend } from "../../types";

type Props = {
  callerId: string;
};

/**
 * Parameters lens — every measured parameter on the EQ mixer.
 *
 * Different from the Uplift v2 Adaptation EQ: that one shows only the
 * personalised `CallerTarget` rows (deviations from system default).
 * This lens shows the running average score for every parameter that has
 * a `ScoreTrend` row — Scores + Behaviour merged into one read.
 *
 * Educators use this to see "where is this learner *now* on every dim"
 * rather than "what have we adapted". Bands group by `parameterType`.
 */
export function ParametersLens({ callerId }: Props): React.ReactElement {
  const { data, loading } = useUpliftData(callerId);

  if (loading) {
    return (
      <div className="hf-progress-v2-lens hf-progress-v2-lens--loading" role="status">
        Loading parameters…
      </div>
    );
  }

  const bands = bandize(data?.scoreTrends ?? []);
  const total = bands.reduce((s, b) => s + b.tracks.length, 0);

  return (
    <div className="hf-progress-v2-lens">
      <div className="hf-progress-v2-lens-head">
        <h3 className="hf-progress-v2-lens-title">Parameters</h3>
        {total > 0 && (
          <span className="hf-progress-v2-lens-sub">
            {total} parameter{total === 1 ? "" : "s"} measured
          </span>
        )}
      </div>
      <EQMixer bands={bands} />
    </div>
  );
}

const BAND_LABELS: Record<string, string> = {
  BEHAVIOR: "Behaviour",
  TRAIT: "Trait",
  STATE: "State",
  OTHER: "Other",
};

function bandize(trends: ScoreTrend[]): EQBand[] {
  const buckets = new Map<string, EQTrack[]>();

  for (const trend of trends) {
    const avg = trend.scores.length > 0
      ? trend.scores.reduce((s, x) => s + x.score, 0) / trend.scores.length
      : 0;
    const bandId = (trend.parameterType ?? "OTHER").toUpperCase();
    const track: EQTrack = {
      id: `${bandId}::${trend.parameterId}`,
      label: trend.parameterName,
      current: avg,
      default: 0.5,
      definition: trend.definition ?? undefined,
    };
    if (!buckets.has(bandId)) buckets.set(bandId, []);
    buckets.get(bandId)!.push(track);
  }

  const knownOrder = ["BEHAVIOR", "TRAIT", "STATE"];
  const bands: EQBand[] = [];
  for (const id of knownOrder) {
    const tracks = buckets.get(id);
    if (tracks && tracks.length > 0) {
      bands.push({ id, label: BAND_LABELS[id] ?? id, tracks });
      buckets.delete(id);
    }
  }
  for (const [id, tracks] of buckets) {
    if (tracks.length === 0) continue;
    bands.push({ id, label: BAND_LABELS[id] ?? id, tracks });
  }

  return bands;
}
