"use client";

/**
 * SnapshotTopicsBlock — Wave C2 of the legacy-tab retirement plan.
 *
 * Lifts Uplift v2's TopicsSection (TopicCloud — recency-weighted chips)
 * into Snapshot v3 so uplift-v2 can retire without losing the
 * "topics covered" surface.
 *
 * Source: `topTopics` was added to the `/api/callers/[id]/uplift`
 * response in Wave C2 so the cloud doesn't need a sibling fetch. The
 * legacy TopicsSection takes a `memorySummary` prop with the shape
 * `{ topTopics, topicCount }` — we pass it through directly.
 */

import { useEffect, useState } from "react";

import { TopicsSection } from "./caller-detail-v2/sections/TopicsSection";

interface SnapshotTopicsBlockProps {
  callerId: string;
}

interface UpliftMemorySummary {
  topTopics: { topic: string; lastMentioned?: string }[];
  topicCount: number;
}

interface UpliftResponse {
  ok: boolean;
  uplift?: {
    topTopics?: { topic: string; lastMentioned?: string }[];
    memoryCounts?: { topics?: number };
  };
}

export function SnapshotTopicsBlock({ callerId }: SnapshotTopicsBlockProps) {
  const [summary, setSummary] = useState<UpliftMemorySummary | null | "error">(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/callers/${callerId}/uplift`)
      .then(async (res) => {
        if (!res.ok) {
          if (!cancelled) setSummary("error");
          return;
        }
        const json = (await res.json()) as UpliftResponse;
        if (cancelled) return;
        setSummary({
          topTopics: json.uplift?.topTopics ?? [],
          topicCount: json.uplift?.memoryCounts?.topics ?? 0,
        });
      })
      .catch(() => {
        if (!cancelled) setSummary("error");
      });
    return () => {
      cancelled = true;
    };
  }, [callerId]);

  if (summary === "error") return null;

  return (
    <section
      className="hf-snapshot-section"
      data-testid="hf-snapshot-topics"
    >
      <div className="hf-card-compact">
        <TopicsSection memorySummary={summary === null ? null : summary} />
      </div>
    </section>
  );
}
