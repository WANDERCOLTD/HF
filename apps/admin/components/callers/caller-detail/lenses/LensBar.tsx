"use client";

import type { LensType, LensConfig } from "../hooks/useCallerLens";

type LensBarProps = {
  lenses: LensConfig[];
  activeLens: LensType;
  onLensChange: (lens: LensType) => void;
};

export function LensBar({ lenses, activeLens, onLensChange }: LensBarProps) {
  if (lenses.length <= 1) return null; // No bar if only one lens available

  return (
    <div className="hf-lens-bar">
      {lenses.map((lens) => (
        <button
          key={lens.id}
          className={`hf-lens-btn ${activeLens === lens.id ? "hf-lens-btn-active" : ""}`}
          onClick={() => onLensChange(lens.id)}
          title={lens.description}
        >
          <span className="hf-lens-btn-icon">{lens.icon}</span>
          <span className="hf-lens-btn-label">{lens.label}</span>
        </button>
      ))}
    </div>
  );
}
