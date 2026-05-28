"use client";

import React from "react";
import { TopicCloud, type TopicChip } from "@/components/shared/display-primitives";
import "./topics-section.css";

type Props = {
  memorySummary?: {
    topTopics?: { topic: string; lastMentioned?: string }[];
    topicCount?: number;
  } | null;
};

/**
 * Topics covered — frequency-weighted cloud sourced from
 * `MemorySummary.topTopics` (passed in via `CallerDetailPage`, not via
 * the `/uplift` route — the cloud sits one fetch upstream).
 *
 * Each chip's font weight scales by recency (chip closer to today = bolder).
 * Weight is uniform inside `topTopics` (the upstream summary already picks
 * the top-N), so size variation comes from a gentle index-based stagger.
 */
export function TopicsSection({ memorySummary }: Props): React.ReactElement {
  const topics = memorySummary?.topTopics ?? [];

  const chips: TopicChip[] = topics.map((t, i) => ({
    key: `${t.topic}-${i}`,
    label: t.topic,
    weight: Math.max(1, topics.length - i),
    ageDays: t.lastMentioned ? daysSince(t.lastMentioned) : undefined,
    tooltip: t.lastMentioned
      ? `${t.topic} — last mentioned ${formatRelative(t.lastMentioned)}`
      : t.topic,
  }));

  return (
    <div className="hf-uplift-v2-topics">
      <div className="hf-uplift-v2-topics-head">
        <h3 className="hf-uplift-v2-topics-title">Topics covered</h3>
        {topics.length > 0 && (
          <span className="hf-uplift-v2-topics-sub">
            {topics.length} topic{topics.length === 1 ? "" : "s"} surfaced
          </span>
        )}
      </div>
      <TopicCloud
        topics={chips}
        emptyText="No topics covered yet — they accumulate as the learner talks."
      />
    </div>
  );
}

function daysSince(iso: string): number | undefined {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  return Math.max(0, Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000)));
}

function formatRelative(iso: string): string {
  const days = daysSince(iso);
  if (days == null) return iso;
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 28) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}
