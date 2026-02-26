"use client";

import type { CallerInsights } from "../hooks/useCallerInsights";
import type { CallerData, ParamConfig } from "../types";
import { AtAGlanceCard } from "../cards/AtAGlanceCard";
import { ProgressStackCard } from "../cards/ProgressStackCard";
import { FocusCard } from "../cards/FocusCard";
import { WhoTheyAreCard } from "../cards/WhoTheyAreCard";
import { RecentCallsCard } from "../cards/RecentCallsCard";
import { AchievementsCard } from "../cards/AchievementsCard";

type GuideLensProps = {
  data: CallerData;
  insights: CallerInsights;
  paramConfig: ParamConfig;
  onNavigateToCall?: (callId: string) => void;
  onNavigateToTab?: (tab: string) => void;
  onStartSim?: () => void;
};

export function GuideLens({
  data,
  insights,
  paramConfig,
  onNavigateToCall,
  onNavigateToTab,
  onStartSim,
}: GuideLensProps) {
  // Empty state
  if (data.counts.calls === 0) {
    return (
      <div className="hf-lens-empty">
        <div className="hf-lens-empty-icon">📞</div>
        <div className="hf-lens-empty-title">No lessons yet</div>
        <div className="hf-lens-empty-desc">
          {data.caller.name || "This student"} hasn&apos;t had their first lesson.
          When they do, you&apos;ll see their progress, personality insights,
          and learning journey here.
        </div>
        <div className="hf-lens-empty-actions">
          <button className="hf-btn hf-btn-primary" onClick={onStartSim}>
            📞 Start First Lesson
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="hf-guide-lens">
      {/* At a Glance strip */}
      <AtAGlanceCard insights={insights} />

      {/* Progress Stack — the core innovation */}
      <ProgressStackCard insights={insights} />

      {/* Focus Areas — diagnostic chains */}
      <FocusCard focusAreas={insights.focusAreas} />

      {/* Who They Are — personality + memories */}
      <WhoTheyAreCard insights={insights} paramConfig={paramConfig} />

      {/* Recent Calls */}
      <RecentCallsCard
        calls={data.calls}
        onCallClick={onNavigateToCall}
        onViewAll={() => onNavigateToTab?.("calls")}
      />

      {/* Achievements */}
      <AchievementsCard achievements={insights.achievements} />

      {/* Quick Actions */}
      <div className="hf-card hf-quick-actions">
        <div className="hf-qa-row">
          <button className="hf-btn hf-btn-primary" onClick={onStartSim}>
            📞 Start Lesson
          </button>
          <button className="hf-btn hf-btn-secondary" onClick={() => onNavigateToTab?.("progress")}>
            📋 View Details
          </button>
        </div>
      </div>
    </div>
  );
}
