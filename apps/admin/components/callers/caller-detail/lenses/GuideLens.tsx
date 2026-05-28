"use client";

import type { CallerInsights } from "../hooks/useCallerInsights";
import type { CallerData, ParamConfig, SectionId } from "../types";
import type { EnrollmentJourney } from "@/hooks/useEnrollmentJourney";
import { AtAGlanceCard } from "../cards/AtAGlanceCard";
import { MockResultCard } from "../cards/MockResultCard";
import { TrustFooterCard } from "../cards/TrustFooterCard";
import { FocusCard } from "../cards/FocusCard";
import { WhoTheyAreCard } from "../cards/WhoTheyAreCard";
import { RecentCallsCard } from "../cards/RecentCallsCard";
import { AchievementsCard } from "../cards/AchievementsCard";
import { OverviewLinkCard } from "../cards/OverviewLinkCard";
import { StatTile } from "@/components/shared/display-primitives";
import { count, pct } from "@/lib/caller-insights/formatNum";

type GuideLensProps = {
  data: CallerData;
  insights: CallerInsights;
  paramConfig: ParamConfig;
  enrollmentJourneys?: EnrollmentJourney[];
  onNavigateToCall?: (callId: string) => void;
  onNavigateToTab?: (tab: SectionId) => void;
  onStartSim?: () => void;
};

export function GuideLens({
  data,
  insights,
  paramConfig,
  enrollmentJourneys,
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

      {/* Skill growth — full trend lives on Uplift v2 now; Overview teases. */}
      <OverviewLinkCard
        title="Skill growth"
        subtitle="Trend chart, target lines, and per-skill radar live on Uplift."
        linkLabel="Open Uplift"
        onClick={() => onNavigateToTab?.("uplift-v2")}
      />

      {/* Mock results — sub-module breakdown via #491 fan-out */}
      <MockResultCard
        calls={(data.calls ?? []) as never}
        scores={(data.scores ?? []) as never}
        tierMapping={undefined}
      />

      {/* Progress summary — full detail (goals + modules + plan) lives on
          Progress v2. Overview shows just a 2-tile teaser and a link. */}
      <OverviewLinkCard
        title="Progress"
        subtitle="Modules, goals, plan, exam readiness — full detail on Progress."
        linkLabel="Open Progress"
        onClick={() => onNavigateToTab?.("progress-v2")}
        summary={
          <>
            <StatTile
              value={count(insights.goals.count)}
              label="Goals"
              compact
            />
            <StatTile
              value={pct(insights.courses.overallMastery)}
              label="Mastery"
              compact
            />
          </>
        }
      />

      {/* Focus Areas — diagnostic chains */}
      <FocusCard focusAreas={insights.focusAreas} />

      {/* Who They Are — personality + memories */}
      <WhoTheyAreCard insights={insights} paramConfig={paramConfig} />

      {/* Recent Calls */}
      <RecentCallsCard
        calls={data.calls}
        onCallClick={onNavigateToCall}
        onViewAll={() => onNavigateToTab?.("calls-prompts")}
      />

      {/* Achievements */}
      <AchievementsCard achievements={insights.achievements} />

      {/* Trust footer — surfaces evidence-aware scoring transparency (#566) */}
      <TrustFooterCard
        calls={(data.calls ?? []) as never}
        scores={(data.scores ?? []) as never}
      />

      {/* Quick Actions */}
      <div className="hf-card hf-quick-actions">
        <div className="hf-qa-row">
          <button className="hf-btn hf-btn-primary" onClick={onStartSim}>
            📞 Start Lesson
          </button>
          <button className="hf-btn hf-btn-secondary" onClick={() => onNavigateToTab?.("what")}>
            📋 View Details
          </button>
        </div>
      </div>
    </div>
  );
}
