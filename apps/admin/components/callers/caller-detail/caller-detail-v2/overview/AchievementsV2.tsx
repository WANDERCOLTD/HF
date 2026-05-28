"use client";

import React from "react";
import { CardGrid } from "@/components/shared/display-primitives";
import type { CallerInsights } from "../../hooks/useCallerInsights";

type Props = {
  achievements: CallerInsights["achievements"];
};

/**
 * Achievements — CardGrid of badge cards. Self-hides when none.
 */
export function AchievementsV2({ achievements }: Props): React.ReactElement | null {
  if (!achievements || achievements.length === 0) return null;

  return (
    <div className="hf-overview-v2-card hf-overview-v2-ach">
      <div className="hf-overview-v2-card-head">
        <h3 className="hf-overview-v2-card-title">Achievements</h3>
      </div>
      <CardGrid minColumnWidth={180} gap={10}>
        {achievements.map((a, i) => (
          <div key={`${a.label}-${i}`} className="hf-overview-v2-ach-card">
            <span className="hf-overview-v2-ach-icon" aria-hidden>
              {a.icon}
            </span>
            <span className="hf-overview-v2-ach-label">{a.label}</span>
            {a.value && (
              <span className="hf-overview-v2-ach-value">{a.value}</span>
            )}
          </div>
        ))}
      </CardGrid>
    </div>
  );
}
