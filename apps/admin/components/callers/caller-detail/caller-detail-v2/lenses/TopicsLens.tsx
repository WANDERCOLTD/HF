"use client";

import React from "react";
import { TopicsSection } from "../sections/TopicsSection";

type Props = {
  memorySummary?: {
    topTopics?: { topic: string; lastMentioned?: string }[];
    topicCount?: number;
  } | null;
};

/**
 * Topics lens — Progress v2 view of the topic cloud.
 *
 * Reuses Uplift v2's `TopicsSection` (which reads `MemorySummary.topTopics`
 * from a parent prop, not the `/uplift` route).
 */
export function TopicsLens({ memorySummary }: Props): React.ReactElement {
  return (
    <div className="hf-progress-v2-lens">
      <TopicsSection memorySummary={memorySummary ?? null} />
    </div>
  );
}
