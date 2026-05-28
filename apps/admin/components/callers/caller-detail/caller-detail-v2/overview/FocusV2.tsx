"use client";

import React from "react";
import { AlertTriangle, ArrowUpCircle } from "lucide-react";
import { CardGrid } from "@/components/shared/display-primitives";
import type { CallerInsights } from "../../hooks/useCallerInsights";

type Props = {
  focusAreas: CallerInsights["focusAreas"];
};

/**
 * Focus areas — splits diagnostic recommendations into Attention vs.
 * Advance. Each group is a CardGrid of badge cards.
 */
export function FocusV2({ focusAreas }: Props): React.ReactElement | null {
  if (!focusAreas || focusAreas.length === 0) return null;

  const attention = focusAreas.filter((f) => f.type === "needs_attention");
  const advance = focusAreas.filter((f) => f.type === "ready_to_advance");

  return (
    <div className="hf-overview-v2-card hf-overview-v2-focus">
      <div className="hf-overview-v2-card-head">
        <h3 className="hf-overview-v2-card-title">What to focus on</h3>
      </div>
      {attention.length > 0 && (
        <FocusGroup
          icon={<AlertTriangle size={12} />}
          label="Needs attention"
          tone="attention"
          items={attention}
        />
      )}
      {advance.length > 0 && (
        <FocusGroup
          icon={<ArrowUpCircle size={12} />}
          label="Ready to advance"
          tone="advance"
          items={advance}
        />
      )}
    </div>
  );
}

function FocusGroup({
  icon,
  label,
  tone,
  items,
}: {
  icon: React.ReactNode;
  label: string;
  tone: "attention" | "advance";
  items: CallerInsights["focusAreas"];
}): React.ReactElement {
  return (
    <div className={`hf-overview-v2-focus-group hf-overview-v2-focus-group--${tone}`}>
      <div className="hf-overview-v2-focus-group-label">
        {icon}
        {label}
      </div>
      <CardGrid minColumnWidth={220} gap={8}>
        {items.map((item, i) => (
          <div
            key={`${tone}-${i}`}
            className={`hf-overview-v2-focus-card hf-overview-v2-focus-card--${tone}`}
          >
            <span className="hf-overview-v2-focus-card-title">{item.moduleName}</span>
            <span className="hf-overview-v2-focus-card-detail">{item.recommendation}</span>
          </div>
        ))}
      </CardGrid>
    </div>
  );
}
