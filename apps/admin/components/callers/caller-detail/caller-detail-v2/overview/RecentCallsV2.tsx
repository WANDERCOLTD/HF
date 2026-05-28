"use client";

import React from "react";
import { ArrowRight } from "lucide-react";
import {
  TimelineRibbon,
  type TimelineNode,
} from "@/components/shared/display-primitives";

type CallLite = {
  id: string;
  createdAt: string | Date;
  source: string;
};

type Props = {
  calls: CallLite[];
  onCallClick?: (callId: string) => void;
  onViewAll?: () => void;
};

const RECENT_N = 5;

/**
 * Recent Calls — last N sessions as a mini TimelineRibbon. Clicking a node
 * routes to that call detail; "View all" opens the Calls tab.
 */
export function RecentCallsV2({
  calls,
  onCallClick,
  onViewAll,
}: Props): React.ReactElement | null {
  const sorted = [...(calls ?? [])].sort((a, b) => {
    const at = new Date(a.createdAt).getTime();
    const bt = new Date(b.createdAt).getTime();
    return bt - at;
  });
  const recent = sorted.slice(0, RECENT_N).reverse(); // oldest left → newest right

  if (recent.length === 0) return null;

  const nodes: TimelineNode[] = recent.map((c, i) => ({
    key: c.id,
    label: `S${sorted.length - (recent.length - 1 - i)}`,
    status: i === recent.length - 1 ? "current" : "done",
    tooltip: (
      <div>
        <div>{new Date(c.createdAt).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}</div>
        <div style={{ opacity: 0.7, fontSize: 11 }}>{c.source}</div>
      </div>
    ),
    onClick: onCallClick ? (() => onCallClick(c.id)) : undefined,
  }));

  return (
    <div className="hf-overview-v2-card hf-overview-v2-recent">
      <div className="hf-overview-v2-card-head">
        <h3 className="hf-overview-v2-card-title">Recent calls</h3>
        {onViewAll && (
          <button
            type="button"
            className="hf-overview-v2-card-link"
            onClick={onViewAll}
          >
            View all
            <ArrowRight size={12} />
          </button>
        )}
      </div>
      <TimelineRibbon nodes={nodes} />
    </div>
  );
}
