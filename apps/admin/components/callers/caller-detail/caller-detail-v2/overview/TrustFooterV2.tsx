"use client";

import React from "react";
import { ShieldCheck } from "lucide-react";
import {
  SparklineCard,
  StatTile,
} from "@/components/shared/display-primitives";
import { count } from "@/lib/caller-insights/formatNum";

type CallLite = {
  id: string;
  createdAt: string | Date;
};

type ScoreLite = {
  callId: string;
  score: number;
  hasLearnerEvidence?: boolean;
};

type Props = {
  calls: CallLite[];
  scores: ScoreLite[];
};

/**
 * Trust footer — evidence-aware scoring transparency (#566).
 *
 * Surfaces how many CallScore rows carry first-class learner evidence
 * vs heuristic-only signal, and a per-call sparkline of the evidence
 * ratio so educators see whether the trust trend is rising / falling.
 *
 * Self-hides when scores have no `hasLearnerEvidence` field at all
 * (matches v1 behaviour for older callers).
 */
export function TrustFooterV2({ calls, scores }: Props): React.ReactElement | null {
  const evidenceAware = scores.filter((s) => typeof s.hasLearnerEvidence === "boolean");
  if (evidenceAware.length === 0) return null;

  const total = evidenceAware.length;
  const withEvidence = evidenceAware.filter((s) => s.hasLearnerEvidence).length;
  const dropped = total - withEvidence;

  // Per-call evidence ratio sparkline (only for calls that have scored rows).
  const byCall = new Map<string, { withEv: number; total: number; ts: number }>();
  for (const c of calls) {
    const t = new Date(c.createdAt).getTime();
    byCall.set(c.id, { withEv: 0, total: 0, ts: t });
  }
  for (const s of evidenceAware) {
    const row = byCall.get(s.callId);
    if (!row) continue;
    row.total += 1;
    if (s.hasLearnerEvidence) row.withEv += 1;
  }
  const series = Array.from(byCall.values())
    .filter((r) => r.total > 0)
    .sort((a, b) => a.ts - b.ts)
    .map((r) => r.withEv / r.total);

  return (
    <div className="hf-overview-v2-card hf-overview-v2-trust">
      <div className="hf-overview-v2-card-head">
        <h3 className="hf-overview-v2-card-title">
          <ShieldCheck size={14} />
          Trust footer
        </h3>
        <span className="hf-overview-v2-card-sub">Measurement transparency</span>
      </div>
      <div className="hf-overview-v2-trust-body">
        <div className="hf-overview-v2-trust-tiles">
          <StatTile
            value={count(withEvidence)}
            label="Evidence-backed"
            compact
            definition="Scores where the learner produced first-class evidence in transcript."
          />
          <StatTile
            value={count(dropped)}
            label="Goodhart drops"
            compact
            definition="Scores held back because the signal was heuristic-only."
          />
        </div>
        {series.length >= 2 && (
          <SparklineCard
            title="Evidence ratio per call"
            history={series}
            width={180}
            height={32}
          />
        )}
      </div>
    </div>
  );
}
