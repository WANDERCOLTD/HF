"use client";

import React from "react";
import { Tooltip } from "@/components/shared/Tooltip";

export type TimelineStatus = "done" | "current" | "upcoming" | "missed";

export type TimelineNode = {
  /** Stable key. */
  key: string;
  /** Short label below the node (e.g. "S1", "Day 3"). */
  label: string;
  /** Status drives colour + icon. */
  status: TimelineStatus;
  /** Optional tooltip body — full description, date, module. */
  tooltip?: React.ReactNode;
  /** Optional click handler (navigate to detail). */
  onClick?: () => void;
};

type TimelineRibbonProps = {
  nodes: TimelineNode[];
  /** Optional inline footnote shown below the ribbon. */
  footnote?: React.ReactNode;
  emptyText?: string;
};

const STATUS_GLYPH: Record<TimelineStatus, string> = {
  done: "●",
  current: "◉",
  upcoming: "○",
  missed: "✕",
};

/**
 * Horizontal sequenced-status ribbon. Use for plan progress (session 1 → N)
 * and similar ordered status walks. Reads as a journey, not a checklist.
 *
 * Status colours come from direction CSS vars + neutral surfaces.
 */
export function TimelineRibbon({
  nodes,
  footnote,
  emptyText = "No sessions yet.",
}: TimelineRibbonProps): React.ReactElement {
  if (nodes.length === 0) {
    return (
      <div className="hf-timeline-ribbon-empty" role="status">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="hf-timeline-ribbon-wrap">
      <ol className="hf-timeline-ribbon">
        {nodes.map((node, i) => (
          <li
            key={node.key}
            className={`hf-timeline-node hf-timeline-node--${node.status}`}
          >
            {i > 0 && (
              <span className="hf-timeline-rail" aria-hidden="true" />
            )}
            <Tooltip content={node.tooltip ?? node.label}>
              <button
                type="button"
                className="hf-timeline-node-btn"
                onClick={node.onClick}
                disabled={!node.onClick}
                aria-label={`${node.label} (${node.status})`}
              >
                <span className="hf-timeline-node-dot" aria-hidden="true">
                  {STATUS_GLYPH[node.status]}
                </span>
                <span className="hf-timeline-node-label">{node.label}</span>
              </button>
            </Tooltip>
          </li>
        ))}
      </ol>
      {footnote && <div className="hf-timeline-foot">{footnote}</div>}
    </div>
  );
}
