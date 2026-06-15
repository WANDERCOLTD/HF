"use client";

/**
 * SnapshotTrustFooterBlock — Wave C3 of the legacy-tab retirement plan.
 *
 * Lifts overview-v2's TrustFooterV2 (#566 evidence-aware scoring) into
 * Snapshot v3 so overview-v2 can retire without losing the
 * "measurement transparency" surface.
 *
 * Source: `trustScores` + `trustCalls` were added to the
 * `/api/callers/[id]/uplift` response in Wave C3. The legacy
 * TrustFooterV2 takes `(calls, scores)` props and self-hides when no
 * row has `hasLearnerEvidence` set (older callers predating #566) — we
 * pass the values straight through.
 */

import { useEffect, useState } from "react";

import { TrustFooterV2 } from "./caller-detail-v2/overview/TrustFooterV2";

interface SnapshotTrustFooterBlockProps {
  callerId: string;
}

interface TrustCall {
  id: string;
  createdAt: string;
}

interface TrustScore {
  callId: string;
  score: number;
  hasLearnerEvidence: boolean | null;
}

interface UpliftResponse {
  ok: boolean;
  uplift?: {
    trustCalls?: TrustCall[];
    trustScores?: TrustScore[];
  };
}

export function SnapshotTrustFooterBlock({ callerId }: SnapshotTrustFooterBlockProps) {
  const [data, setData] = useState<
    { calls: TrustCall[]; scores: TrustScore[] } | null | "error"
  >(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/callers/${callerId}/uplift`)
      .then(async (res) => {
        if (!res.ok) {
          if (!cancelled) setData("error");
          return;
        }
        const json = (await res.json()) as UpliftResponse;
        if (cancelled) return;
        setData({
          calls: json.uplift?.trustCalls ?? [],
          scores: json.uplift?.trustScores ?? [],
        });
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
      data-testid="hf-snapshot-trust-footer"
    >
      <TrustFooterV2
        calls={data.calls}
        scores={data.scores.map((s) => ({
          callId: s.callId,
          score: s.score,
          hasLearnerEvidence: s.hasLearnerEvidence ?? undefined,
        }))}
      />
    </section>
  );
}
