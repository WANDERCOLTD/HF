"use client";

import type { CallerInsights } from "../hooks/useCallerInsights";
import type { ParamConfig } from "../types";

type WhoTheyAreCardProps = {
  insights: CallerInsights;
  paramConfig: ParamConfig;
};

export function WhoTheyAreCard({ insights, paramConfig }: WhoTheyAreCardProps) {
  const { topMemories, personalityTraits } = insights;

  if (topMemories.length === 0 && personalityTraits.length === 0) return null;

  return (
    <div className="hf-card hf-who-card">
      <h3 className="hf-section-title">Who They Are</h3>

      <div className="hf-who-columns">
        {/* Personality */}
        {personalityTraits.length > 0 && (
          <div className="hf-who-col">
            <div className="hf-who-col-title">Personality</div>
            <div className="hf-who-trait-list">
              {personalityTraits.map((trait) => {
                const info = paramConfig?.params[trait.label];
                const displayLabel = info?.label || trait.label;
                const level = trait.value >= 0.7 ? "high" : trait.value <= 0.3 ? "low" : "mid";
                return (
                  <span key={trait.label} className={`hf-who-trait hf-who-trait-${level}`}>
                    {displayLabel}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Memories */}
        {topMemories.length > 0 && (
          <div className="hf-who-col">
            <div className="hf-who-col-title">Memories</div>
            <div className="hf-who-memory-list">
              {topMemories.slice(0, 5).map((m, i) => (
                <div key={i} className="hf-who-memory">
                  &ldquo;{m.value}&rdquo;
                </div>
              ))}
              {insights.topMemories.length > 5 && (
                <div className="hf-who-memory-more">
                  +{insights.topMemories.length - 5} more
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
