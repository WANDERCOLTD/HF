"use client";

import React from "react";
import { Activity, Clock, Phone } from "lucide-react";
import {
  Donut,
  StatTile,
} from "@/components/shared/display-primitives";
import { count, pct } from "@/lib/caller-insights/formatNum";
import type { CallerInsights } from "../../hooks/useCallerInsights";

type Props = {
  insights: CallerInsights;
};

const MOMENTUM_LABEL: Record<CallerInsights["momentum"], string> = {
  accelerating: "Accelerating 🔥",
  steady: "Steady",
  slowing: "Slowing",
  new: "New learner",
};

/**
 * At a Glance — replaces the v1 inline metric strip with a Donut +
 * 4 StatTiles. Same 5 data points, design-system primitives.
 */
export function AtAGlanceV2({ insights }: Props): React.ReactElement {
  return (
    <div className="hf-overview-v2-glance">
      <div className="hf-overview-v2-glance-donut">
        <Donut
          value={insights.courses.overallMastery}
          size={88}
          strokeWidth={8}
        >
          <span className="hf-overview-v2-glance-donut-val">
            {pct(insights.courses.overallMastery)}
          </span>
        </Donut>
        <span className="hf-overview-v2-glance-donut-label">Mastery</span>
      </div>
      <div className="hf-overview-v2-glance-tiles">
        <StatTile
          value={MOMENTUM_LABEL[insights.momentum]}
          label="Momentum"
          icon={<Activity size={14} />}
          definition="Whether the learner's pace is accelerating, steady, or slowing — last 7 days vs the prior 7."
          compact
        />
        <StatTile
          value={
            insights.lastCallDaysAgo == null
              ? "—"
              : insights.lastCallDaysAgo === 0
                ? "today"
                : `${insights.lastCallDaysAgo}d ago`
          }
          label="Last call"
          icon={<Clock size={14} />}
          compact
        />
        <StatTile
          value={count(insights.totalCalls, "calls")}
          label="Total"
          icon={<Phone size={14} />}
          compact
        />
        {insights.callStreak > 0 && (
          <StatTile
            value={`🔥 ${insights.callStreak}`}
            label="Day streak"
            definition="Consecutive days with at least one call."
            compact
          />
        )}
      </div>
    </div>
  );
}
