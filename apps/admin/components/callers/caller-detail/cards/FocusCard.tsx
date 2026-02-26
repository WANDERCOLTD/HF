"use client";

import type { FocusArea } from "../hooks/useCallerInsights";

type FocusCardProps = {
  focusAreas: FocusArea[];
};

export function FocusCard({ focusAreas }: FocusCardProps) {
  if (focusAreas.length === 0) return null;

  const needsAttention = focusAreas.filter((f) => f.type === "needs_attention");
  const readyToAdvance = focusAreas.filter((f) => f.type === "ready_to_advance");

  return (
    <div className="hf-card hf-focus-card">
      <h3 className="hf-section-title">What to Focus On</h3>

      {needsAttention.length > 0 && (
        <div className="hf-focus-group">
          <div className="hf-focus-group-label hf-focus-attention">⚠ Needs Attention</div>
          {needsAttention.map((area, i) => (
            <div key={i} className="hf-focus-item">
              <div className="hf-focus-item-header">
                <span className="hf-focus-item-name">{area.moduleName}</span>
                <span className="hf-focus-item-pct">{Math.round(area.mastery * 100)}%</span>
              </div>
              <div className="hf-focus-item-reason">{area.reason}</div>
              <div className="hf-focus-item-rec">↳ {area.recommendation}</div>
            </div>
          ))}
        </div>
      )}

      {readyToAdvance.length > 0 && (
        <div className="hf-focus-group">
          <div className="hf-focus-group-label hf-focus-advance">✅ Ready to Advance</div>
          {readyToAdvance.map((area, i) => (
            <div key={i} className="hf-focus-item">
              <div className="hf-focus-item-header">
                <span className="hf-focus-item-name">{area.moduleName}</span>
                <span className="hf-focus-item-pct">{Math.round(area.mastery * 100)}%</span>
              </div>
              <div className="hf-focus-item-rec">↳ {area.recommendation}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
