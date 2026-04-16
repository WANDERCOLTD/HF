"use client";

import { useEffect, useState } from "react";
import { getLessonPlanModel } from "@/lib/lesson-plan/models";

// ── Types ─────────────────────────────────────────────

type PhaseEntry = {
  id: string;
  label: string;
  durationMins?: number;
  teachMethods?: string[];
  guidance?: string;
};

type LessonEntry = {
  session: number;
  type: string;
  label: string;
  moduleLabel?: string | null;
  estimatedDurationMins?: number | null;
  phases?: PhaseEntry[] | null;
};

type Course = {
  playbookId: string;
  playbookName: string;
  model: string | null;
  entries: LessonEntry[];
};

type StudentProgress = {
  callerId: string;
  name: string | null;
  mastered: number;
  inProgress: number;
  notStarted: number;
  totalTps: number;
};

// ── Helpers ────────────────────────────────────────────

const SESSION_TYPE_COLORS: Record<string, string> = {
  onboarding: "var(--accent-primary)",
  introduce: "var(--status-info-text)",
  deepen: "var(--session-deepen, var(--status-info-text))",
  review: "var(--status-warning-text)",
  assess: "var(--status-error-text)",
  consolidate: "var(--status-success-text)",
};

function typeColor(type: string) {
  return SESSION_TYPE_COLORS[type] || "var(--text-muted)";
}

function typeLabel(type: string) {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

// ── Component ──────────────────────────────────────────

export function LessonPlanTab({ classroomId }: { classroomId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [studentProgress, setStudentProgress] = useState<StudentProgress[]>([]);
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/educator/classrooms/${classroomId}/lesson-plan`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.ok) {
          setCourses(data.courses ?? []);
          setStudentProgress(data.studentProgress ?? []);
        } else {
          setError(data.error ?? "Failed to load lesson plan");
        }
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load lesson plan");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [classroomId]);

  function toggleSession(key: string) {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="cls-lp-loading">
        <div className="hf-spinner" />
        <span className="hf-text-sm hf-text-muted">Loading lesson plan...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="hf-banner hf-banner-error cls-lp-banner">
        {error}
      </div>
    );
  }

  if (courses.length === 0) {
    return (
      <div className="cls-empty">
        No lesson plan for this classroom yet.
        Use the Teach wizard to set up a structured course and sessions will appear here.
      </div>
    );
  }

  const totalStudents = studentProgress.length;
  const avgMastery = totalStudents > 0
    ? Math.round(
        studentProgress.reduce((sum, s) => {
          return sum + (s.totalTps > 0 ? (s.mastered / s.totalTps) * 100 : 0);
        }, 0) / totalStudents,
      )
    : 0;

  return (
    <div className="cls-lp-root">
      {courses.map((course) => {
        const modelLabel = getLessonPlanModel(course.model).label;
        const sessionCount = course.entries.length;

        return (
          <div key={course.playbookId} className="cls-lp-course">
            {/* Course header */}
            <div className="cls-lp-course-header">
              <span className="hf-section-title">{course.playbookName}</span>
              <div className="cls-lp-course-meta">
                <span className="hf-chip hf-chip-sm" style={{ cursor: "default" }}>{modelLabel}</span>
                <span className="hf-text-xs hf-text-muted">{sessionCount} session{sessionCount !== 1 ? "s" : ""}</span>
                <span className="hf-text-xs hf-text-muted">{totalStudents} student{totalStudents !== 1 ? "s" : ""}</span>
                <span className="hf-text-xs hf-text-muted">{avgMastery}% avg mastery</span>
              </div>
            </div>

            {/* Session rows */}
            <div className="cls-lp-sessions">
              {course.entries.map((entry) => {
                const sessionKey = `${course.playbookId}-${entry.session}`;
                const isExpanded = expandedSessions.has(sessionKey);
                const hasPhases = Array.isArray(entry.phases) && entry.phases.length > 0;

                return (
                  <div key={sessionKey} className="cls-lp-session-item">
                    <div
                      className={`cls-lp-session-row${hasPhases ? " cls-lp-session-row--expandable" : ""}`}
                      onClick={hasPhases ? () => toggleSession(sessionKey) : undefined}
                    >
                      {/* Number */}
                      <span className="cls-lp-session-num">{entry.session}</span>

                      {/* Type badge */}
                      <span
                        className="cls-lp-type-badge"
                        style={{
                          color: typeColor(entry.type),
                          background: `color-mix(in srgb, ${typeColor(entry.type)} 12%, transparent)`,
                        }}
                      >
                        {typeLabel(entry.type)}
                      </span>

                      {/* Title */}
                      <span className="cls-lp-session-title">
                        {entry.label}
                        {entry.moduleLabel && (
                          <span className="cls-lp-module-label"> · {entry.moduleLabel}</span>
                        )}
                      </span>

                      {/* Duration */}
                      {entry.estimatedDurationMins && (
                        <span className="cls-lp-session-dur">{entry.estimatedDurationMins}m</span>
                      )}

                      {/* Expand chevron */}
                      {hasPhases && (
                        <span className={`cls-lp-chevron${isExpanded ? " cls-lp-chevron--open" : ""}`} />
                      )}
                    </div>

                    {/* Expanded: phases */}
                    {isExpanded && hasPhases && (
                      <div className="cls-lp-expand">
                        {entry.phases!.map((phase, pi) => (
                          <div key={phase.id + pi} className="cls-lp-phase">
                            <span className="cls-lp-phase-label">{phase.label}</span>
                            {phase.durationMins && (
                              <span className="cls-lp-phase-dur">{phase.durationMins}m</span>
                            )}
                            {phase.teachMethods?.length ? (
                              <span className="cls-lp-phase-methods">
                                {phase.teachMethods.map((m) => `[${m}]`).join(" ")}
                              </span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Student mastery summary */}
      {totalStudents > 0 && (
        <div className="cls-lp-student-summary hf-mt-lg">
          <span className="hf-section-title">Student Progress</span>
          <div className="hf-card-compact">
            {studentProgress.map((s) => {
              const pct = s.totalTps > 0 ? Math.round((s.mastered / s.totalTps) * 100) : 0;
              const isComplete = s.totalTps > 0 && s.mastered === s.totalTps;
              return (
                <div key={s.callerId} className="cd-progress-row">
                  <span className="hf-text-xs" style={{ minWidth: 100 }}>{s.name || "Unknown"}</span>
                  <div className="cd-progress-bar">
                    <div
                      className="cd-progress-fill"
                      style={{
                        width: `${pct}%`,
                        background: isComplete ? "var(--status-success-text)" : "var(--accent-primary)",
                      }}
                    />
                  </div>
                  <span className="cd-progress-count hf-text-xs" style={{ minWidth: 48, textAlign: "right" }}>
                    {isComplete ? (
                      <span style={{ color: "var(--status-success-text)" }}>&#10003; 100%</span>
                    ) : pct > 0 ? (
                      <span>{pct}%</span>
                    ) : (
                      <span className="hf-text-muted">—</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
