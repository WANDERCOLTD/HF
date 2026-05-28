"use client";

import React from "react";
import { Tooltip } from "@/components/shared/Tooltip";

export type TopicChip = {
  /** Stable key. */
  key: string;
  /** Topic label. */
  label: string;
  /** Frequency / weight (drives font size). */
  weight: number;
  /** Optional age in days (drives colour intensity — fresher = bolder). */
  ageDays?: number;
  /** Optional tooltip body; falls back to "last mentioned" when ageDays is set. */
  tooltip?: React.ReactNode;
};

type TopicCloudProps = {
  topics: TopicChip[];
  /** Min font size in px. */
  minFontSize?: number;
  /** Max font size in px. */
  maxFontSize?: number;
  emptyText?: string;
};

/**
 * Frequency-weighted topic cloud. Token font size scales by weight; colour
 * intensity scales by recency.
 *
 * Pure CSS — no third-party cloud library. Tokens wrap naturally.
 */
export function TopicCloud({
  topics,
  minFontSize = 11,
  maxFontSize = 22,
  emptyText = "No topics covered yet.",
}: TopicCloudProps): React.ReactElement {
  if (topics.length === 0) {
    return (
      <div className="hf-topic-cloud-empty" role="status">
        {emptyText}
      </div>
    );
  }

  const maxWeight = Math.max(...topics.map((t) => t.weight), 1);
  const range = maxFontSize - minFontSize;

  return (
    <div className="hf-topic-cloud" role="list">
      {topics.map((topic) => {
        const size = minFontSize + (topic.weight / maxWeight) * range;
        const freshness = freshnessClass(topic.ageDays);
        const body =
          topic.tooltip ??
          (topic.ageDays != null
            ? `last mentioned ${topic.ageDays} day${topic.ageDays === 1 ? "" : "s"} ago`
            : topic.label);

        return (
          <Tooltip key={topic.key} content={body}>
            <span
              className={`hf-topic-chip ${freshness}`}
              style={{ fontSize: `${size.toFixed(1)}px` }}
              role="listitem"
            >
              {topic.label}
            </span>
          </Tooltip>
        );
      })}
    </div>
  );
}

function freshnessClass(ageDays: number | undefined): string {
  if (ageDays == null) return "hf-topic-chip--stale";
  if (ageDays <= 3) return "hf-topic-chip--fresh";
  if (ageDays <= 14) return "hf-topic-chip--recent";
  return "hf-topic-chip--stale";
}
