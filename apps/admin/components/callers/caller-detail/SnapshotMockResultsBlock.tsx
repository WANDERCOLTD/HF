"use client";

/**
 * SnapshotMockResultsBlock — Wave C1 of the legacy-tab retirement plan.
 *
 * Lifts overview-v2's MockResultV2 (latest Mock score donut + DeltaPill
 * vs prior Mock + date) into Snapshot v3. Self-hides when the caller has
 * no Mock calls — matches the legacy behaviour.
 *
 * Fetches `/api/calls?callerId=<id>&limit=50` (which already returns
 * call.scores in the same response shape MockResultV2 expects). The
 * legacy MockResultV2 component does the source-string filter + score
 * aggregation client-side, so we just pass the calls + scores arrays
 * through.
 *
 * STUDENT scope: `/api/calls` already routes through
 * `resolveCallerScopeForReading` so a STUDENT supplying a foreign
 * callerId is rejected.
 */

import { useEffect, useState } from "react";

import { MockResultV2 } from "./caller-detail-v2/overview/MockResultV2";

interface SnapshotMockResultsBlockProps {
  callerId: string;
}

interface CallLite {
  id: string;
  source: string;
  createdAt: string;
}

interface ScoreLite {
  callId: string;
  parameterId: string;
  score: number;
}

interface CallsListResponse {
  ok: boolean;
  calls: Array<{
    id: string;
    source: string;
    createdAt: string;
    scores?: Array<{ parameterId: string; score: number }>;
  }>;
}

export function SnapshotMockResultsBlock({ callerId }: SnapshotMockResultsBlockProps) {
  const [data, setData] = useState<{ calls: CallLite[]; scores: ScoreLite[] } | null | "error">(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/calls?callerId=${encodeURIComponent(callerId)}&limit=50`)
      .then(async (res) => {
        if (!res.ok) {
          if (!cancelled) setData("error");
          return;
        }
        const json = (await res.json()) as CallsListResponse;
        if (cancelled) return;
        const calls: CallLite[] = (json.calls ?? []).map((c) => ({
          id: c.id,
          source: c.source,
          createdAt: c.createdAt,
        }));
        const scores: ScoreLite[] = (json.calls ?? []).flatMap((c) =>
          (c.scores ?? []).map((s) => ({
            callId: c.id,
            parameterId: s.parameterId,
            score: s.score,
          })),
        );
        setData({ calls, scores });
      })
      .catch(() => {
        if (!cancelled) setData("error");
      });
    return () => {
      cancelled = true;
    };
  }, [callerId]);

  if (data === null || data === "error") return null;

  return (
    <section
      className="hf-snapshot-section"
      data-testid="hf-snapshot-mock-results"
    >
      <MockResultV2 calls={data.calls} scores={data.scores} />
    </section>
  );
}
