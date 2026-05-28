"use client";

import React from "react";
import { Activity, Brain } from "lucide-react";
import {
  CalendarStrip,
  SliceDonut,
  StatTile,
} from "@/components/shared/display-primitives";
import { count } from "@/lib/caller-insights/formatNum";
import { useUpliftData } from "../useUpliftData";
import "./engagement-section.css";

type Props = {
  callerId: string;
};

/**
 * Engagement — Memories slice donut + Calls / week stat tile. Streak +
 * Momentum land in PR 4 once `/uplift` returns `callDates[]`.
 */
export function EngagementSection({ callerId }: Props): React.ReactElement {
  const { data, loading } = useUpliftData(callerId);

  if (loading) {
    return (
      <div className="hf-uplift-v2-engagement-loading" role="status">
        Loading engagement…
      </div>
    );
  }

  const mc = data?.memoryCounts ?? {
    facts: 0,
    preferences: 0,
    events: 0,
    topics: 0,
    total: 0,
  };

  const slices = [
    { label: "Facts", value: mc.facts },
    { label: "Preferences", value: mc.preferences },
    { label: "Topics", value: mc.topics },
    { label: "Events", value: mc.events },
  ].filter((s) => s.value > 0);

  return (
    <div className="hf-uplift-v2-engagement">
      <div className="hf-uplift-v2-engagement-head">
        <h3 className="hf-uplift-v2-engagement-title">Engagement</h3>
      </div>
      <div className="hf-uplift-v2-engagement-body">
        <div className="hf-uplift-v2-engagement-memories">
          <div className="hf-uplift-v2-engagement-donut-wrap">
            <SliceDonut
              slices={slices}
              size={120}
              strokeWidth={14}
              centerLabel={
                <div className="hf-uplift-v2-engagement-center">
                  <span className="hf-uplift-v2-engagement-center-value">
                    {mc.total}
                  </span>
                  <span className="hf-uplift-v2-engagement-center-label">
                    memories
                  </span>
                </div>
              }
            />
          </div>
          <ul className="hf-uplift-v2-engagement-legend">
            <LegendItem swatch="var(--accent-primary)" label="Facts" count={mc.facts} />
            <LegendItem swatch="var(--status-success-text)" label="Preferences" count={mc.preferences} />
            <LegendItem swatch="var(--status-warning-text)" label="Topics" count={mc.topics} />
            <LegendItem swatch="var(--status-error-text)" label="Events" count={mc.events} />
          </ul>
        </div>
        <div className="hf-uplift-v2-engagement-tiles">
          <StatTile
            value={count(data?.callFrequencyPerWeek)}
            label="Calls / week"
            icon={<Activity size={14} />}
            definition="Rolling 7-day call cadence."
          />
          <StatTile
            value={count(data?.totalCalls)}
            label="Total calls"
            icon={<Brain size={14} />}
            definition="Completed calls across the course so far."
          />
        </div>
      </div>
      <div className="hf-uplift-v2-engagement-streak">
        <span className="hf-uplift-v2-engagement-streak-label">Last 14 days</span>
        <CalendarStrip
          days={last14Days(data?.callDates)}
          label="Call streak"
        />
      </div>
    </div>
  );
}

/**
 * Build a 14-day boolean strip from the ordered ISO callDates array.
 * Missing data → 14 hollow dots; the primitive handles the empty case.
 */
function last14Days(
  callDates: string[] | undefined,
): { date: string; active: boolean }[] {
  const out: { date: string; active: boolean }[] = [];
  if (!callDates) return out;
  const callDays = new Set(callDates.map((iso) => iso.slice(0, 10)));
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, active: callDays.has(key) });
  }
  return out;
}

function LegendItem({
  swatch,
  label,
  count: n,
}: {
  swatch: string;
  label: string;
  count: number;
}): React.ReactElement {
  return (
    <li className="hf-uplift-v2-legend-item">
      <span
        className="hf-uplift-v2-legend-swatch"
        style={{ background: swatch }}
        aria-hidden="true"
      />
      <span className="hf-uplift-v2-legend-label">{label}</span>
      <span className="hf-uplift-v2-legend-count">{n}</span>
    </li>
  );
}
