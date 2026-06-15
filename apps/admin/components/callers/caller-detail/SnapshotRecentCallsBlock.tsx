"use client";

/**
 * SnapshotRecentCallsBlock — Wave C1 of the legacy-tab retirement plan.
 *
 * Lifts overview-v2's RecentCallsV2 (TimelineRibbon of last 5 calls with
 * click-through) into Snapshot v3 so overview-v2 can retire without
 * losing the at-a-glance call history.
 *
 * Fetches `/api/calls?callerId=<id>&limit=10`. Self-hides when the
 * caller has no calls.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { RecentCallsV2 } from "./caller-detail-v2/overview/RecentCallsV2";

interface SnapshotRecentCallsBlockProps {
  callerId: string;
}

interface CallLite {
  id: string;
  source: string;
  createdAt: string;
}

interface CallsListResponse {
  ok: boolean;
  calls: Array<{ id: string; source: string; createdAt: string }>;
}

export function SnapshotRecentCallsBlock({ callerId }: SnapshotRecentCallsBlockProps) {
  const router = useRouter();
  const [calls, setCalls] = useState<CallLite[] | null | "error">(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/calls?callerId=${encodeURIComponent(callerId)}&limit=10`)
      .then(async (res) => {
        if (!res.ok) {
          if (!cancelled) setCalls("error");
          return;
        }
        const json = (await res.json()) as CallsListResponse;
        if (cancelled) return;
        setCalls(
          (json.calls ?? []).map((c) => ({
            id: c.id,
            source: c.source,
            createdAt: c.createdAt,
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setCalls("error");
      });
    return () => {
      cancelled = true;
    };
  }, [callerId]);

  if (calls === null || calls === "error" || calls.length === 0) return null;

  return (
    <section
      className="hf-snapshot-section"
      data-testid="hf-snapshot-recent-calls"
    >
      <RecentCallsV2
        calls={calls}
        onCallClick={(callId) => router.push(`/x/calls/${callId}`)}
        onViewAll={() =>
          router.push(`/x/callers/${callerId}?tab=calls-prompts`)
        }
      />
    </section>
  );
}
