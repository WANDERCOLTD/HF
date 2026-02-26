"use client";

import type { Achievement } from "../hooks/useCallerInsights";

type AchievementsCardProps = {
  achievements: Achievement[];
};

export function AchievementsCard({ achievements }: AchievementsCardProps) {
  if (achievements.length === 0) return null;

  return (
    <div className="hf-card hf-achievements-card">
      <h3 className="hf-section-title">Achievements</h3>
      <div className="hf-ach-grid">
        {achievements.map((ach, i) => (
          <div key={i} className="hf-ach-item">
            <span className="hf-ach-icon">{ach.icon}</span>
            <span className="hf-ach-label">{ach.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
