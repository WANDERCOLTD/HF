"use client";

import React from "react";
import {
  TimelineRibbon,
  type TimelineNode,
} from "@/components/shared/display-primitives";
import { useUpliftData } from "../useUpliftData";

type Props = {
  callerId: string;
};

const MAX_NODES = 20;

/**
 * Plan lens — lightweight session ribbon.
 *
 * v1 has a richer `PlanProgressSection` (curriculum-aware ordering, gates,
 * etc.) that needs `calls` + `domainId` props plumbed through. This v2
 * lens reads `callDates` from the existing `/uplift` payload and renders
 * a horizontal TimelineRibbon of the most recent N sessions — enough to
 * see cadence and recency without the v1 plumbing burden.
 */
export function PlanLens({ callerId }: Props): React.ReactElement {
  const { data, loading } = useUpliftData(callerId);

  if (loading) {
    return (
      <div className="hf-progress-v2-lens hf-progress-v2-lens--loading" role="status">
        Loading plan…
      </div>
    );
  }

  const dates = (data?.callDates ?? []).slice(-MAX_NODES);
  const nodes: TimelineNode[] = dates.map((iso, i) => ({
    key: `${iso}-${i}`,
    label: `S${i + 1}`,
    status: i === dates.length - 1 ? "current" : "done",
    tooltip: new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
  }));

  return (
    <div className="hf-progress-v2-lens">
      <div className="hf-progress-v2-lens-head">
        <h3 className="hf-progress-v2-lens-title">Plan</h3>
        {nodes.length > 0 && (
          <span className="hf-progress-v2-lens-sub">
            last {nodes.length} session{nodes.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <TimelineRibbon nodes={nodes} emptyText="No sessions yet." />
    </div>
  );
}
