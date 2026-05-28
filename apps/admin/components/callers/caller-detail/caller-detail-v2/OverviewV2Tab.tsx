"use client";

/**
 * Overview v2 (BETA) — fully-buffed Overview tab.
 *
 * Same 10-card structure as v1 GuideLens, but every card now composes the
 * shared display primitives instead of inline ad-hoc rendering. The two
 * "REPLACE" cards from the plan (Skill Bands, Progress Stack) are still
 * link cards pointing into Uplift v2 / Progress v2.
 */

import React, { useEffect } from "react";
import type { CallerInsights } from "../hooks/useCallerInsights";
import type { CallerData, ParamConfig, SectionId } from "../types";
import type { EnrollmentJourney } from "@/hooks/useEnrollmentJourney";

import { MockResultV2 } from "./overview/MockResultV2";
import { AtAGlanceV2 } from "./overview/AtAGlanceV2";
import { FocusV2 } from "./overview/FocusV2";
import { WhoTheyAreV2 } from "./overview/WhoTheyAreV2";
import { RecentCallsV2 } from "./overview/RecentCallsV2";
import { AchievementsV2 } from "./overview/AchievementsV2";
import { TrustFooterV2 } from "./overview/TrustFooterV2";

import { OverviewLinkCard } from "../cards/OverviewLinkCard";
import { StatTile } from "@/components/shared/display-primitives";
import { count, pct } from "@/lib/caller-insights/formatNum";
import { trackTabLoad } from "@/lib/caller-insights/telemetry";
import "./overview-v2.css";

type Props = {
  callerId: string;
  data: CallerData;
  insights: CallerInsights;
  paramConfig: ParamConfig;
  enrollmentJourneys?: EnrollmentJourney[];
  onNavigateToCall?: (callId: string) => void;
  onNavigateToTab?: (tab: SectionId) => void;
};

export function OverviewV2Tab({
  callerId,
  data,
  insights,
  paramConfig,
  enrollmentJourneys,
  onNavigateToCall,
  onNavigateToTab,
}: Props): React.ReactElement {
  useEffect(() => {
    trackTabLoad("overview-v2");
  }, []);

  return (
    <div className="hf-overview-v2-root">
      <div className="hf-overview-v2-beta-strip">
        BETA — re-built Overview with the shared display-primitives. Same
        cards as today, primitivised.
      </div>

      <AtAGlanceV2 insights={insights} />

      <OverviewLinkCard
        title="Skill growth"
        subtitle="Trend chart, target lines, and per-skill radar live on Uplift."
        linkLabel="Open Uplift"
        onClick={() => onNavigateToTab?.("uplift-v2")}
      />

      <MockResultV2
        calls={data.calls ?? []}
        scores={data.scores ?? []}
      />

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

      <FocusV2 focusAreas={insights.focusAreas} />

      <WhoTheyAreV2
        insights={insights}
        paramConfig={paramConfig}
        onViewProfile={() => onNavigateToTab?.("how")}
      />

      <RecentCallsV2
        calls={data.calls}
        onCallClick={onNavigateToCall}
        onViewAll={() => onNavigateToTab?.("calls-prompts")}
      />

      <AchievementsV2 achievements={insights.achievements} />

      <TrustFooterV2
        calls={data.calls ?? []}
        scores={data.scores ?? []}
      />

      {/* enrollmentJourneys are forwarded for parity with v1 GuideLens —
          consumed once the corresponding lens lands on Progress v2. */}
      {enrollmentJourneys && enrollmentJourneys.length > 0 && (
        <div className="hf-overview-v2-enrollment-meta">
          {enrollmentJourneys.length} active enrolment
          {enrollmentJourneys.length === 1 ? "" : "s"} · use Progress for
          full plan detail.
        </div>
      )}

      <div className="hf-overview-v2-caller-id" aria-hidden>
        caller {callerId.slice(0, 8)}
      </div>
    </div>
  );
}
