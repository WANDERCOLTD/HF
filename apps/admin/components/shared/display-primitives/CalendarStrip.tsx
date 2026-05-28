"use client";

import React from "react";
import { Tooltip } from "@/components/shared/Tooltip";

type CalendarDay = {
  /** ISO date string (yyyy-mm-dd) or any human-readable label. */
  date: string;
  /** True when activity occurred on that day. */
  active: boolean;
};

type CalendarStripProps = {
  /** Ordered oldest → newest. */
  days: CalendarDay[];
  /** Optional aria label for the strip. */
  label?: string;
};

/**
 * Horizontal dot strip for daily-presence booleans. Filled dot = activity,
 * hollow dot = no activity. Use for call streaks, login streaks, etc.
 *
 * Hover surfaces the date in a tooltip.
 */
export function CalendarStrip({
  days,
  label = "Activity streak",
}: CalendarStripProps): React.ReactElement {
  if (days.length === 0) {
    return (
      <div className="hf-calendar-strip hf-calendar-strip--empty" role="status">
        —
      </div>
    );
  }

  return (
    <div
      className="hf-calendar-strip"
      role="img"
      aria-label={`${label}: ${days.filter((d) => d.active).length} active of ${days.length} days`}
    >
      {days.map((day) => (
        <Tooltip
          key={day.date}
          content={`${day.date} — ${day.active ? "active" : "no activity"}`}
        >
          <span
            className={`hf-calendar-dot${day.active ? " hf-calendar-dot--active" : ""}`}
            aria-hidden="true"
          />
        </Tooltip>
      ))}
    </div>
  );
}
