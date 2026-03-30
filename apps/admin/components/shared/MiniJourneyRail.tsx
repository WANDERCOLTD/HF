"use client";

/**
 * MiniJourneyRail — compact journey snapshot for wizard conversations.
 *
 * Shows a dot rail (color-coded by session type, all "upcoming"),
 * with optional onboarding "First Call" as session 0,
 * summary stats, and a "View your course" link.
 */

import { useMemo } from "react";
import { DotRail, type DotRailStep, type DotState } from "./DotRail";
import { getSessionTypeLabel } from "@/lib/lesson-plan/session-ui";
import type { LessonEntry } from "@/app/x/wizard/components/LessonPlanAccordion";
import "./journey-rail.css";

export interface OnboardingPhaseCompact {
  phase: string;
  duration?: string;
}

export interface MiniJourneyRailProps {
  entries: LessonEntry[];
  courseId?: string;
  courseName?: string;
  /** Onboarding phases — renders as a "First Call" session 0 before the lesson plan */
  onboardingPhases?: OnboardingPhaseCompact[];
  /** Offboarding phases — renders as a "Course Wrap-Up" session at the end */
  offboardingPhases?: OnboardingPhaseCompact[];
}

const upcomingState = (): DotState => "upcoming";

export function MiniJourneyRail({ entries, courseId, courseName, onboardingPhases, offboardingPhases }: MiniJourneyRailProps) {
  const hasOnboarding = onboardingPhases && onboardingPhases.length > 0;
  const hasOffboarding = offboardingPhases && offboardingPhases.length > 0;

  const steps: DotRailStep[] = useMemo(() => {
    const result: DotRailStep[] = [];
    if (hasOnboarding) {
      result.push({ session: 0, type: "onboarding", label: "First Call" });
    }
    for (const e of entries) {
      result.push({ session: e.session, type: e.type, label: e.label });
    }
    if (hasOffboarding) {
      const lastSession = entries.length > 0 ? entries[entries.length - 1].session + 1 : 1;
      result.push({ session: lastSession, type: "offboarding", label: "Course Wrap-Up" });
    }
    return result;
  }, [entries, hasOnboarding, hasOffboarding]);

  const totalMins = useMemo(
    () => entries.reduce((sum, e) => sum + (e.estimatedDurationMins || 0), 0),
    [entries],
  );

  const typeBreakdown = useMemo(() => {
    const seen = new Set<string>();
    const labels: string[] = [];
    if (hasOnboarding) {
      seen.add("onboarding");
      labels.push(getSessionTypeLabel("onboarding"));
    }
    for (const e of entries) {
      if (!seen.has(e.type)) {
        seen.add(e.type);
        labels.push(getSessionTypeLabel(e.type));
      }
    }
    if (hasOffboarding && !seen.has("offboarding")) {
      labels.push(getSessionTypeLabel("offboarding"));
    }
    return labels.join(", ");
  }, [entries, hasOnboarding, hasOffboarding]);

  // Onboarding phase trail: "Welcome → Orient → Discover"
  const phaseTrail = useMemo(() => {
    if (!hasOnboarding) return null;
    return onboardingPhases
      .map((p) => p.phase.charAt(0).toUpperCase() + p.phase.slice(1))
      .join(" → ");
  }, [onboardingPhases, hasOnboarding]);

  // Offboarding phase trail: "Reflect → Celebrate → Farewell"
  const offboardingTrail = useMemo(() => {
    if (!hasOffboarding) return null;
    return offboardingPhases
      .map((p) => p.phase.charAt(0).toUpperCase() + p.phase.slice(1))
      .join(" → ");
  }, [offboardingPhases, hasOffboarding]);

  if (entries.length === 0 && !hasOnboarding && !hasOffboarding) return null;

  const sessionCount = entries.length + (hasOnboarding ? 1 : 0) + (hasOffboarding ? 1 : 0);

  return (
    <div className="jrl-mini">
      <div className="jrl-mini-title">
        {courseName ? `${courseName} — Your Journey` : "Your learning journey"}
      </div>

      <DotRail steps={steps} getState={upcomingState} />

      {phaseTrail && (
        <div className="jrl-mini-phases">
          First Call: {phaseTrail}
        </div>
      )}

      {offboardingTrail && (
        <div className="jrl-mini-phases">
          Course Wrap-Up: {offboardingTrail}
        </div>
      )}

      <div className="jrl-mini-summary">
        <span>
          {sessionCount} session{sessionCount !== 1 ? "s" : ""}
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
