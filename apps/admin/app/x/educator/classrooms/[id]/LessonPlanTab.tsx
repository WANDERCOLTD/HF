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
  name: string;
  currentSession: number | null;
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

  return (
    <div className="cls-lp-root">
      {courses.map((course) => {
        const modelLabel = getLessonPlanModel(course.model).label;
        const sessionCount = course.entries.length;

        // Count sessions by progress state
        const completedSessions = course.entries.filter((e) =>
          studentProgress.filter((s) => s.currentSession !== null && s.currentSession > e.session).length === totalStudents
        ).length;
        const activeSessions = course.entries.filter((e) =>
          studentProgress.some((s) => s.currentSession === e.session)
        ).length;

        return (
          <div key={course.playbookId} className="cls-lp-course">
            {/* Course header */}
            <div className="cls-lp-course-header">
              <span className="hf-section-title">{course.playbookName}</span>
              <div className="cls-lp-course-meta">
                <span className="hf-chip hf-chip-sm" style={{ cursor: "default" }}>{modelLabel}</span>
                <span className="hf-text-xs hf-text-muted">{sessionCount} session{sessionCount !== 1 ? "s" : ""}</span>
                <span className="hf-text-xs hf-text-muted">{totalStudents} student{totalStudents !== 1 ? "s" : ""}</span>
                {completedSessions > 0 && (
                  <span className="hf-text-xs" style={{ color: "var(--status-success-text)" }}>
                    {completedSessions} completed
                  </span>
                )}
                {activeSessions > 0 && (
                  <span className="hf-text-xs" style={{ color: "var(--status-info-text)" }}>
                    {activeSessions} active
                  </span>
                )}
              </div>
            </div>

            {/* Session rows */}
            <div className="cls-lp-sessions">
              {course.entries.map((entry) => {
                const sessionKey = `${course.playbookId}-${entry.session}`;
                const isExpanded = expandedSessions.has(sessionKey);

                // Students: completed = past this session, active = on this session, not_started = before
                const completed = studentProgress.filter(
                  (s) => s.currentSession !== null && s.currentSession > entry.session
                );
                const active = studentProgress.filter((s) => s.currentSession === entry.session);
                const notStarted = studentProgress.filter(
                  (s) => s.currentSession === null || s.currentSession < entry.session
                );

                const reachedCount = completed.length + active.length;
                const progressPct = totalStudents > 0
                  ? Math.round((reachedCount / totalStudents) * 100)
                  : 0;

                const isAllDone = totalStudents > 0 && completed.length === totalStudents;
                const hasActive = active.length > 0;
                const hasPhases = Array.isArray(entry.phases) && entry.phases.length > 0;
                const canExpand = hasPhases || active.length > 0;

                return (
                  <div key={sessionKey} className="cls-lp-session-item">
                    <div
                      className={`cls-lp-session-row${canExpand ? " cls-lp-session-row--expandable" : ""}`}
                      onClick={canExpand ? () => toggleSession(sessionKey) : undefined}
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

                      {/* Progress */}
                      <div className="cls-lp-progress">
                        <div className="cls-lp-progress-bar">
                          <div
                            className="cls-lp-progress-fill"
                            style={{
                              width: `${progressPct}%`,
                              background: isAllDone
                                ? "var(--status-success-text)"
                                : hasActive
                                  ? "var(--status-info-text)"
                                  : "var(--border-default)",
                            }}
                          />
                        </div>
                        <span className="cls-lp-progress-count">
                          {isAllDone
                            ? <span style={{ color: "var(--status-success-text)" }}>✓ {totalStudents}</span>
                            : hasActive
                              ? <span style={{ color: "var(--status-info-text)" }}>▶ {active.length}/{totalStudents}</span>
                              : <span className="hf-text-muted">· {reachedCount}/{totalStudents}</span>
                          }
                        </span>
                      </div>

                      {/* Expand chevron */}
                      {canExpand && (
                        <span className={`cls-lp-chevron${isExpanded ? " cls-lp-chevron--open" : ""}`} />
                      )}
                    </div>

                    {/* Expanded: phases + student names */}
                    {isExpanded && (
                      <div className="cls-lp-expand">
                        {hasPhases && entry.phases!.map((phase, pi) => (
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

                        {active.length > 0 && (
                          <div className="cls-lp-student-group">
                            <span className="cls-lp-student-group-label">On this session:</span>
                            <span className="cls-lp-student-names">
                              {active.map((s) => s.name).join(", ")}
                            </span>
                          </div>
                        )}
                        {completed.length > 0 && (
                          <div className="cls-lp-student-group">
                            <span className="cls-lp-student-group-label">Completed:</span>
                            <span className="cls-lp-student-names">
                              {completed.map((s) => s.name).join(", ")}
                            </span>
                          </div>
                        )}
                        {notStarted.length > 0 && active.length === 0 && completed.length === 0 && (
                          <div className="cls-lp-student-group">
                            <span className="cls-lp-student-group-label hf-text-muted">Not reached yet</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
