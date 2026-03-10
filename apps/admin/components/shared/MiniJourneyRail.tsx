"use client";

/**
 * MiniJourneyRail — compact lesson plan snapshot for wizard conversations.
 *
 * Shows a dot rail (color-coded by session type, all "upcoming"),
 * summary stats, and a "View your course" link.
 */

import { useMemo } from "react";
import { DotRail, type DotRailStep, type DotState } from "./DotRail";
import { getSessionTypeLabel } from "@/lib/lesson-plan/session-ui";
import type { LessonEntry } from "@/app/x/get-started-v4/components/LessonPlanAccordion";
import "./journey-rail.css";

export interface MiniJourneyRailProps {
  entries: LessonEntry[];
  courseId?: string;
  courseName?: string;
}

const upcomingState = (): DotState => "upcoming";

export function MiniJourneyRail({ entries, courseId, courseName }: MiniJourneyRailProps) {
  const steps: DotRailStep[] = useMemo(
    () => entries.map((e) => ({ session: e.session, type: e.type, label: e.label })),
    [entries],
  );

  const totalMins = useMemo(
    () => entries.reduce((sum, e) => sum + (e.estimatedDurationMins || 0), 0),
    [entries],
  );

  const typeBreakdown = useMemo(() => {
    const seen = new Set<string>();
    const labels: string[] = [];
    for (const e of entries) {
      if (!seen.has(e.type)) {
        seen.add(e.type);
        labels.push(getSessionTypeLabel(e.type));
      }
    }
    return labels.join(", ");
  }, [entries]);

  if (entries.length === 0) return null;

  return (
    <div className="jrl-mini">
      <div className="jrl-mini-title">
        {courseName ? `${courseName} — Lesson Plan` : "Your lesson plan"}
      </div>

      <DotRail steps={steps} getState={upcomingState} />

      <div className="jrl-mini-summary">
        <span>
          {entries.length} session{entries.length !== 1 ? "s" : ""}
        </span>
        {totalMins > 0 && (
          <>
            <span className="jrl-mini-sep">&middot;</span>
            <span>~{totalMins} min</span>
          </>
        )}
        {typeBreakdown && (
          <>
            <span className="jrl-mini-sep">&middot;</span>
            <span>{typeBreakdown}</span>
          </>
        )}
      </div>

      {courseId && (
        <a
          href={`/x/courses/${courseId}`}
          className="jrl-mini-link"
          target="_blank"
          rel="noopener noreferrer"
        >
          View your course &rarr;
        </a>
      )}
    </div>
  );
}
