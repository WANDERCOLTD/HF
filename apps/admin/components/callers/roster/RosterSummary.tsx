"use client";

import { Users, TrendingUp, AlertTriangle, Phone } from "lucide-react";
import type { RosterSummary as RosterSummaryData } from "./useRosterData";

type RosterSummaryProps = {
  summary: RosterSummaryData;
  callerLabel: string;
};

export function RosterSummary({ summary, callerLabel }: RosterSummaryProps) {
  return (
    <div className="ros-summary-grid">
      <div className="hf-summary-card">
        <div className="hf-summary-card-label">
          <Users size={16} />
          {callerLabel}
        </div>
        <div className="hf-summary-card-value">
          {summary.total}
          {summary.avgMastery !== null && (
            <span className="hf-summary-card-sub">
              {Math.round(summary.avgMastery * 100)}% avg
            </span>
          )}
        </div>
      </div>

      <div className="hf-summary-card">
        <div className="hf-summary-card-label">
          <TrendingUp size={16} />
          Active
        </div>
        <div className="hf-summary-card-value">
          {summary.active + summary.advancing}
          <span className="hf-summary-card-sub">this week</span>
        </div>
      </div>

      <div className="hf-summary-card">
        <div className="hf-summary-card-label ros-summary-attention">
          <AlertTriangle size={16} />
          Attention
        </div>
        <div className="hf-summary-card-value">
          {summary.attention}
          {summary.attention > 0 && (
            <span className="hf-summary-card-sub ros-summary-attention">need focus</span>
          )}
        </div>
      </div>

      <div className="hf-summary-card">
        <div className="hf-summary-card-label">
          <Phone size={16} />
          In Call
        </div>
        <div className="hf-summary-card-value">
          {summary.inCall}
          {summary.inCall > 0 && (
            <span className="hf-summary-card-sub ros-summary-live">right now</span>
          )}
        </div>
      </div>
    </div>
  );
}
