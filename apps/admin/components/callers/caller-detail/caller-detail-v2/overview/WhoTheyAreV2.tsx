"use client";

import React from "react";
import { ArrowRight } from "lucide-react";
import { StatTile } from "@/components/shared/display-primitives";
import type { CallerInsights } from "../../hooks/useCallerInsights";
import type { ParamConfig } from "../../types";

type Props = {
  insights: CallerInsights;
  paramConfig: ParamConfig;
  onViewProfile?: () => void;
};

/**
 * Who They Are — TIGHTEN per the plan. Compact preview: top 3 personality
 * tiles + up to 2 memory quotes + "View full profile" link. Full memory
 * + personality detail lives on the Profile tab.
 */
export function WhoTheyAreV2({
  insights,
  paramConfig: _paramConfig,
  onViewProfile,
}: Props): React.ReactElement | null {
  const traits = (insights.personalityTraits ?? []).slice(0, 3);
  const memories = (insights.topMemories ?? []).slice(0, 2);

  if (traits.length === 0 && memories.length === 0) return null;

  return (
    <div className="hf-overview-v2-card hf-overview-v2-who">
      <div className="hf-overview-v2-card-head">
        <h3 className="hf-overview-v2-card-title">Who they are</h3>
        {onViewProfile && (
          <button
            type="button"
            className="hf-overview-v2-card-link"
            onClick={onViewProfile}
          >
            View full profile
            <ArrowRight size={12} />
          </button>
        )}
      </div>

      {traits.length > 0 && (
        <div className="hf-overview-v2-who-traits">
          {traits.map((t) => (
            <StatTile
              key={t.label}
              value={traitValueLabel(t.value)}
              label={t.label}
              compact
            />
          ))}
        </div>
      )}

      {memories.length > 0 && (
        <ul className="hf-overview-v2-who-memories">
          {memories.map((m) => (
            <li key={m.key} className="hf-overview-v2-who-memory">
              <span className="hf-overview-v2-who-memory-key">{m.key}</span>
              <span className="hf-overview-v2-who-memory-value">"{m.value}"</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function traitValueLabel(value: number): string {
  if (value > 0.66) return "high";
  if (value < 0.33) return "low";
  return "mid";
}
