"use client";

/**
 * JourneyRail — the lesson plan as a journey.
 *
 * Three automatic states based on data:
 *   A) Blueprint   — 0 callers. Clean course skeleton.
 *   B) Class Overview — 1+ callers. Blueprint + caller position rows.
 *   C) Caller Journey — focused on one caller. Rich active session.
 *
 * Props are intentionally minimal. The data drives the view.
 */

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, Users2, ArrowLeft, ListOrdered, RefreshCw, ExternalLink, Sparkles, Flag, Plus, Trash2, GripVertical, ClipboardList, ChevronDown, BookOpen, Layers, RotateCcw, Target, CheckCircle } from "lucide-react";
import { SESSION_TYPE_ICONS } from "@/lib/lesson-plan/session-ui";
import { DotRail, type DotRailStep, type DotState } from "./DotRail";
import { getSessionTypeColor, getSessionTypeLabel, isFormStop, type SessionTypeConfig, type EducatorType } from "@/lib/lesson-plan/session-ui";
import type { SessionEntry, StudentProgress } from "@/lib/lesson-plan/types";
import "./journey-rail.css";

// ── Props ───────────────────────────────────────────

export interface JourneyRailProps {
  sessions: SessionEntry[];
  callers?: StudentProgress[];
  focusCallerId?: string | null;
  courseId: string;

  /** Loading / error / empty */
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;

  /** Regenerate controls */
  onRegenerate?: () => void;
  regenerating?: boolean;
  regenSessionCount?: number | null;
  onRegenSessionCountChange?: (n: number | null) => void;

  /** Custom render for expanded session detail. Overrides default phase-bar detail. */
  renderSessionDetail?: (entry: SessionEntry) => React.ReactNode;

  /** Switch to a tab on the course page (for onboarding/offboarding links) */
  onSwitchTab?: (tab: string) => void;

  /** Admin mode — inline controls for managing sessions */
  onAddSession?: (afterSession: number, type: string) => void;
  onRemoveSession?: (sessionNumber: number) => void;
  onRetypeSession?: (sessionNumber: number, newType: string) => void;
  onToggleOptional?: (sessionNumber: number, isOptional: boolean) => void;
  onReorderSession?: (fromIndex: number, toIndex: number) => void;
  /** Toggle pre+post assessments on/off (linked master toggle) */
  onToggleAssessments?: (enabled: boolean) => void;
  /** Whether assessments (pre+post) are currently enabled */
  assessmentsEnabled?: boolean;
  /** Toggle mid-survey independently (only available when assessments are on) */
  onToggleMidSurvey?: (enabled: boolean) => void;
  /** Whether mid-survey is currently enabled */
  midSurveyEnabled?: boolean;

  /** Sub-component toggles for survey stops */
  personalityEnabled?: boolean;
  onTogglePersonality?: (enabled: boolean) => void;
  preTestEnabled?: boolean;
  onTogglePreTest?: (enabled: boolean) => void;
  midTestEnabled?: boolean;
  onToggleMidTest?: (enabled: boolean) => void;
  postTestEnabled?: boolean;
  onTogglePostTest?: (enabled: boolean) => void;
  /** Whether the course is comprehension-led (shows mid-test toggle) */
  isComprehension?: boolean;
  /** Question counts for badge display */
  preTestQuestionCount?: number;
  midTestQuestionCount?: number;
  postTestQuestionCount?: number;
  personalityQuestionCount?: number;
  /** Mid/post satisfaction question counts */
  midSurveyQuestionCount?: number;
  postSurveyQuestionCount?: number;

  /** Loaded session type config (for type dropdowns) */
  sessionTypeConfig?: SessionTypeConfig;
  /** Educator type groups (for simplified type picker) */
  educatorTypes?: EducatorType[];
}

// ── Helpers ─────────────────────────────────────────

function callerDotState(
  session: number,
  currentSession: number | null,
): DotState {
  if (currentSession === null) return "upcoming";
  if (session < currentSession) return "completed";
  if (session === currentSession) return "active";
  return "upcoming";
}

function classDotState(
  session: number,
  callers: StudentProgress[],
): DotState {
  if (callers.length === 0) return "upcoming";
  const anyActive = callers.some((c) => c.currentSession === session);
  const allPast = callers.every(
    (c) => c.currentSession !== null && c.currentSession > session,
  );
  if (allPast) return "completed";
  if (anyActive) return "active";
  // Check if at least one caller has passed this session
  const somePast = callers.some(
    (c) => c.currentSession !== null && c.currentSession > session,
  );
  if (somePast) return "active"; // partial progress
  return "upcoming";
}

function blueprintDotState(): DotState {
  return "upcoming";
}

// Total duration helper
function totalDuration(sessions: SessionEntry[]): number {
  return sessions.reduce((sum, e) => sum + (e.estimatedDurationMins || 0), 0);
}

// Format duration
function formatDuration(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// Count materials on a session
function materialCount(entry: SessionEntry): number {
  let count = entry.media?.length ?? 0;
  if (entry.phases) {
    for (const p of entry.phases) {
      count += p.media?.length ?? 0;
    }
  }
  return count;
}

// ── Special session detail (onboarding / offboarding) ──

function OnboardingSessionDetail({
  courseId,
  color,
  onSwitchTab,
}: {
  courseId: string;
  color: string;
  onSwitchTab?: (tab: string) => void;
}) {
  const router = useRouter();

  return (
    <div
      className="jrl-active-detail jrl-special-session"
      style={{ "--station-color": color } as React.CSSProperties}
    >
      <div className="jrl-special-heading">
        <Sparkles size={14} /> First Call
      </div>
      <p className="hf-text-xs hf-text-muted">
        The onboarding session introduces the learner, sets expectations, and begins the learning journey.
      </p>
      <button
        className="jrl-detail-link"
        onClick={(e) => {
          e.stopPropagation();
          if (onSwitchTab) {
            onSwitchTab("journey");
          } else {
            router.push(`/x/courses/${courseId}?tab=journey`);
          }
        }}
        type="button"
      >
        <ExternalLink size={11} /> Edit onboarding on the Onboarding tab
      </button>
    </div>
  );
}

function OffboardingSessionDetail({
  courseId,
  color,
  onSwitchTab,
}: {
  courseId: string;
  color: string;
  onSwitchTab?: (tab: string) => void;
}) {
  const router = useRouter();

  return (
    <div
      className="jrl-active-detail jrl-special-session"
      style={{ "--station-color": color } as React.CSSProperties}
    >
      <div className="jrl-special-heading">
        <Flag size={14} /> Course Wrap-Up
      </div>
      <p className="hf-text-xs hf-text-muted">
        The offboarding session collects learner feedback and celebrates their progress.
      </p>
      <button
        className="jrl-detail-link"
        onClick={(e) => {
          e.stopPropagation();
          if (onSwitchTab) {
            onSwitchTab("journey");
          } else {
            router.push(`/x/courses/${courseId}?tab=journey`);
          }
        }}
        type="button"
      >
        <ExternalLink size={11} /> Edit offboarding on the Onboarding tab
      </button>
    </div>
  );
}

// ── Default expanded detail (extracted for render-prop override) ──

function DefaultSessionDetail({
  entry,
  mats,
  onThisSession,
  courseId,
  color,
}: {
  entry: SessionEntry;
  mats: number;
  onThisSession: StudentProgress[];
  courseId: string;
  color: string;
}) {
  const router = useRouter();

  return (
    <div
      className="jrl-active-detail"
      style={{ "--station-color": color } as React.CSSProperties}
    >
      {entry.notes && (
        <div className="jrl-detail-notes">{entry.notes}</div>
      )}

      {entry.moduleLabel && (
        <div className="jrl-detail-module">
          <span className="hf-text-xs hf-text-muted">Module:</span>{" "}
          <span className="hf-text-xs hf-text-secondary">{entry.moduleLabel}</span>
        </div>
      )}

      {entry.phases && entry.phases.length > 0 && (
        <div className="jrl-phase-bar">
          {entry.phases.map((phase, pi) => {
            const totalPhaseDur = entry.phases!.reduce(
              (s, p) => s + (p.durationMins || 0),
              0,
            );
            const fraction = totalPhaseDur > 0 && phase.durationMins
              ? phase.durationMins / totalPhaseDur
              : 1 / entry.phases!.length;

            return (
              <div
                key={phase.id + pi}
                className="jrl-phase-segment"
                style={{ flex: fraction }}
              >
                <span className="jrl-phase-segment-label">
                  {phase.label.split(" — ")[0]}
                </span>
                {phase.durationMins && (
                  <span className="jrl-phase-segment-dur">
                    {phase.durationMins}m
                  </span>
                )}
                {phase.teachMethods && phase.teachMethods.length > 0 && (
                  <div className="jrl-phase-segment-methods">
                    {phase.teachMethods.slice(0, 2).map((m) => (
                      <span key={m} className="hf-chip hf-chip-sm">{m}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {mats > 0 && (
        <div className="jrl-active-materials">
          {entry.media?.map((m) => (
            <span key={m.mediaId} className="jrl-material-chip">
              {m.mimeType?.startsWith("image/") ? (
                <img
                  src={`/api/media/${m.mediaId}`}
                  alt={m.captionText || m.fileName || ""}
                  className="jrl-material-thumb"
                />
              ) : (
                <Paperclip size={9} />
              )}
              {m.fileName || m.figureRef || "File"}
            </span>
          ))}
          {entry.phases?.flatMap((p) =>
            (p.media || []).map((m) => (
              <span key={m.mediaId} className="jrl-material-chip">
                {m.mimeType?.startsWith("image/") ? (
                  <img
                    src={`/api/media/${m.mediaId}`}
                    alt={m.captionText || m.fileName || ""}
                    className="jrl-material-thumb"
                  />
                ) : (
                  <Paperclip size={9} />
                )}
                {m.fileName || m.figureRef || "File"}
              </span>
            )),
          )}
        </div>
      )}

      {onThisSession.length > 0 && (
        <div className="jrl-active-students">
          <span className="jrl-student-dot" />
          {onThisSession.map((c) => c.name).join(", ")}
        </div>
      )}

      <button
        className="jrl-detail-link"
        onClick={(e) => {
          e.stopPropagation();
          router.push(`/x/courses/${courseId}/sessions/${entry.session}`);
        }}
        type="button"
      >
        <ExternalLink size={11} /> Edit session details
      </button>
    </div>
  );
}

// ── Component ───────────────────────────────────────

export function JourneyRail({
  sessions,
  callers = [],
  focusCallerId: initialFocusCallerId = null,
  courseId,
  loading = false,
  error,
  onRetry,
  onRegenerate,
  regenerating = false,
  regenSessionCount,
  onRegenSessionCountChange,
  renderSessionDetail,
  onSwitchTab,
  onAddSession,
  onRemoveSession,
  onRetypeSession,
  onToggleOptional,
  onReorderSession,
  onToggleAssessments,
  assessmentsEnabled,
  onToggleMidSurvey,
  midSurveyEnabled,
  personalityEnabled,
  onTogglePersonality,
  preTestEnabled,
  onTogglePreTest,
  midTestEnabled,
  onToggleMidTest,
  postTestEnabled,
  onTogglePostTest,
  isComprehension,
  preTestQuestionCount,
  midTestQuestionCount,
  postTestQuestionCount,
  personalityQuestionCount,
  midSurveyQuestionCount,
  postSurveyQuestionCount,
  sessionTypeConfig,
  educatorTypes,
}: JourneyRailProps) {
  const router = useRouter();
  const [focusCallerId, setFocusCallerId] = useState<string | null>(initialFocusCallerId);
  const [expandedSession, setExpandedSession] = useState<number | null>(null);
  const [insertPickerAfter, setInsertPickerAfter] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const stationRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const isAdmin = !!(onAddSession || onRemoveSession || onRetypeSession);
  const isPinned = (type: string) => ["onboarding", "offboarding"].includes(type);


  // Sync external prop
  useEffect(() => {
    setFocusCallerId(initialFocusCallerId);
  }, [initialFocusCallerId]);

  // ── Derived ───────────────────────────────────────

  const focusCaller = useMemo(
    () => (focusCallerId ? callers.find((c) => c.callerId === focusCallerId) ?? null : null),
    [focusCallerId, callers],
  );

  const mode: "blueprint" | "class" | "caller" = focusCaller
    ? "caller"
    : callers.length > 0
      ? "class"
      : "blueprint";

  const dotSteps: DotRailStep[] = useMemo(
    () => sessions.map((e) => ({ session: e.session, type: e.type, label: e.label })),
    [sessions],
  );

  const getDotState = useCallback(
    (session: number): DotState => {
      if (mode === "caller" && focusCaller) {
        return callerDotState(session, focusCaller.currentSession);
      }
      if (mode === "class") {
        return classDotState(session, callers);
      }
      return blueprintDotState();
    },
    [mode, focusCaller, callers],
  );

  // Callers on a specific session
  const callersOnSession = useCallback(
    (session: number) => callers.filter((c) => c.currentSession === session),
    [callers],
  );

  // Scroll to session when dot clicked
  const scrollToSession = useCallback((session: number) => {
    const el = stationRefs.current[session];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

  // Auto-poll when plan is empty — background generation may be in progress.
  // Polls the sessions API directly (not onRetry) to avoid flashing the loading state.
  useEffect(() => {
    if (sessions.length > 0 || loading || !!error || !onRetry) return;
    const id = setInterval(() => {
      fetch(`/api/courses/${courseId}/sessions`)
        .then((r) => r.json())
        .then((data) => {
          if (data.ok && data.plan?.entries?.length > 0) {
            onRetry(); // Triggers full parent reload now that data exists
          }
        })
        .catch(() => {}); // Silently retry on next interval
    }, 3000);
    return () => clearInterval(id);
  }, [sessions.length, loading, error, onRetry, courseId]);

  // ── Loading / Error / Empty ───────────────────────

  if (loading) {
    return (
      <div className="jrl-empty">
        <div className="hf-spinner" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="jrl-empty">
        <div className="hf-banner hf-banner-error">{error}</div>
        {onRetry && (
          <button onClick={onRetry} className="hf-btn hf-btn-secondary hf-btn-sm">
            Retry
          </button>
        )}
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className={`jrl-empty${onRetry ? " hf-glow-active" : ""}`}>
        <ListOrdered size={36} className="hf-text-tertiary" />
        <div className="hf-heading-sm hf-text-secondary">
          {onRetry ? "Generating lesson plan..." : "No lesson plan yet"}
        </div>
        <p className="hf-text-xs hf-text-muted">
          {onRetry
            ? "This usually takes a few seconds."
            : "A lesson plan is created when you set up your course content."}
        </p>
      </div>
    );
  }

  // ── Station render (one session row) ──────────────

  const renderStation = (entry: SessionEntry, idx: number) => {
    const state = getDotState(entry.session);
    const color = getSessionTypeColor(entry.type);
    const typeLabel = getSessionTypeLabel(entry.type);
    const mats = materialCount(entry);
    const tps = entry.assertionCount ?? 0;
    const onThisSession = callersOnSession(entry.session);
    const pinned = isPinned(entry.type);
    const formStop = isFormStop(entry.type);

    // In caller mode: active session auto-expands
    const isActiveForCaller = mode === "caller" && focusCaller?.currentSession === entry.session;
    const isExpanded = isActiveForCaller || expandedSession === entry.session;

    // Drag state
    const isDragOver = dragOver === idx;

    return (
      <div
        key={entry.session}
        className={`jrl-station${isDragOver ? " jrl-station--drag-over" : ""}`}
        ref={(el) => { stationRefs.current[entry.session] = el; }}
        draggable={isAdmin && !pinned && !!onReorderSession}
        onDragStart={() => { if (!pinned) setDragFrom(idx); }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(idx); }}
        onDragEnd={() => { setDragFrom(null); setDragOver(null); }}
        onDrop={() => {
          if (dragFrom !== null && dragFrom !== idx && onReorderSession) {
            onReorderSession(dragFrom, idx);
          }
          setDragFrom(null);
          setDragOver(null);
        }}
      >
        {/* Node on the rail — icon for each session type */}
        {(() => {
          const Icon = SESSION_TYPE_ICONS[entry.type] ?? BookOpen;
          return (
            <div
              className={`jrl-station-node jrl-station-node--${state}${formStop ? " jrl-station-node--form" : ""}`}
              style={{ "--station-color": color } as React.CSSProperties}
            >
              <Icon size={10} className="jrl-station-icon" />
            </div>
          );
        })()}

        {/* Collapsed row */}
        <div
          className="jrl-station-row"
          onClick={() => {
            if (isActiveForCaller) {
              router.push(`/x/courses/${courseId}/sessions/${entry.session}`);
            } else {
              setExpandedSession(isExpanded ? null : entry.session);
            }
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (isActiveForCaller) {
                router.push(`/x/courses/${courseId}/sessions/${entry.session}`);
              } else {
                setExpandedSession(isExpanded ? null : entry.session);
              }
            }
          }}
        >
          {/* Drag handle */}
          {isAdmin && !pinned && onReorderSession && (
            <GripVertical size={12} className="jrl-drag-handle" />
          )}
          <span className="jrl-station-num">{entry.session}</span>
          <span className="jrl-station-label">{entry.label}</span>

          {/* Type badge — dropdown if admin, static otherwise */}
          {isAdmin && !pinned && !formStop && onRetypeSession && educatorTypes ? (
            <select
              className="jrl-type-select"
              value={educatorTypes.find((et) => et.dbTypes.includes(entry.type))?.educatorLabel || entry.type}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                const et = educatorTypes.find((t) => t.educatorLabel === e.target.value);
                if (et) onRetypeSession(entry.session, et.dbTypes[0]);
              }}
              style={{ "--station-color": color } as React.CSSProperties}
            >
              {educatorTypes
                .filter((et) => et.category === "teaching")
                .map((et) => (
                  <option key={et.educatorLabel} value={et.educatorLabel}>
                    {et.educatorLabel}
                  </option>
                ))}
            </select>
          ) : (
            <span
              className="jrl-station-type"
              style={{ "--station-color": color } as React.CSSProperties}
            >
              {typeLabel}
            </span>
          )}

          {entry.estimatedDurationMins ? (
            <span className="jrl-station-duration">
              {entry.estimatedDurationMins}m
            </span>
          ) : null}
          <span className="jrl-station-badges">
            {tps > 0 && (
              <span className="jrl-station-badge">{tps} TPs</span>
            )}
            {mats > 0 && (
              <span className="jrl-station-badge">
                <Paperclip size={9} /> {mats}
              </span>
            )}
            {mode !== "caller" && onThisSession.length > 0 && (
              <span className="jrl-station-badge">
                <span className="jrl-student-dot" /> {onThisSession.length}
              </span>
            )}

            {/* Admin: assessments master toggle (pre+post linked, shown on pre_survey) */}
            {isAdmin && formStop && onToggleAssessments && entry.type === "pre_survey" && (
              <label
                className="jrl-survey-toggle"
                onClick={(e) => e.stopPropagation()}
                title={assessmentsEnabled ? "Assessments enabled — click to disable all" : "Assessments disabled — click to enable all"}
              >
                <input
                  type="checkbox"
                  checked={assessmentsEnabled ?? true}
                  onChange={(e) => onToggleAssessments(e.target.checked)}
                  className="hf-checkbox"
                />
                <span className={`hf-text-xs ${assessmentsEnabled ? "hf-text-muted" : "jrl-survey-off-label"}`}>
                  {assessmentsEnabled ? "Assessments" : "Assessments off"}
                </span>
              </label>
            )}

            {/* Admin: mid-survey independent toggle (only when assessments are on) */}
            {isAdmin && formStop && onToggleMidSurvey && entry.type === "mid_survey" && assessmentsEnabled && (
              <label
                className="jrl-survey-toggle"
                onClick={(e) => e.stopPropagation()}
                title={midSurveyEnabled ? "Mid check-in enabled" : "Mid check-in disabled"}
              >
                <input
                  type="checkbox"
                  checked={midSurveyEnabled ?? false}
                  onChange={(e) => onToggleMidSurvey(e.target.checked)}
                  className="hf-checkbox"
                />
                <span className={`hf-text-xs ${midSurveyEnabled ? "hf-text-muted" : "jrl-survey-off-label"}`}>
                  {midSurveyEnabled ? "Mid Check-in" : "Mid Check-in off"}
                </span>
              </label>
            )}

            {/* Admin: optional toggle (teaching stops only) */}
            {isAdmin && !pinned && !formStop && onToggleOptional && (
              <label
                className="jrl-optional-toggle"
                onClick={(e) => e.stopPropagation()}
                title={entry.isOptional ? "Students can skip" : "Required for all students"}
              >
                <input
                  type="checkbox"
                  checked={entry.isOptional ?? false}
                  onChange={(e) => onToggleOptional(entry.session, e.target.checked)}
                  className="hf-checkbox"
                />
                <span className="hf-text-xs hf-text-muted">Optional</span>
              </label>
            )}

            {/* Admin: remove */}
            {isAdmin && !pinned && onRemoveSession && (
              <button
                className="jrl-remove-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveSession(entry.session);
                }}
                title="Remove session"
                type="button"
              >
                <Trash2 size={12} />
              </button>
            )}
          </span>
        </div>

        {/* Admin: sub-component toggles for survey stops */}
        {isAdmin && formStop && assessmentsEnabled && !isExpanded && (
          <div className="jrl-stop-controls" onClick={(e) => e.stopPropagation()}>
            {entry.type === "pre_survey" && (
              <>
                {onTogglePersonality && (
                  <label className="jrl-stop-control">
                    <input type="checkbox" checked={personalityEnabled ?? true} onChange={(e) => onTogglePersonality(e.target.checked)} className="hf-checkbox" />
                    <span className="hf-text-xs hf-text-muted">Personality Profile</span>
                    {personalityQuestionCount != null && <span className="jrl-stop-control-count">{personalityQuestionCount} Qs</span>}
                  </label>
                )}
                {onTogglePreTest && (
                  <label className="jrl-stop-control">
                    <input type="checkbox" checked={preTestEnabled ?? true} onChange={(e) => onTogglePreTest(e.target.checked)} className="hf-checkbox" />
                    <span className="hf-text-xs hf-text-muted">Knowledge Check</span>
                    {preTestQuestionCount != null && <span className="jrl-stop-control-count">{preTestQuestionCount} Qs</span>}
                  </label>
                )}
              </>
            )}
            {entry.type === "mid_survey" && (
              <>
                <label className="jrl-stop-control">
                  <input type="checkbox" checked={midSurveyEnabled ?? false} onChange={(e) => onToggleMidSurvey?.(e.target.checked)} className="hf-checkbox" disabled={!onToggleMidSurvey} />
                  <span className="hf-text-xs hf-text-muted">Satisfaction Check-in</span>
                  {midSurveyQuestionCount != null && <span className="jrl-stop-control-count">{midSurveyQuestionCount} Qs</span>}
                </label>
                {isComprehension && onToggleMidTest && (
                  <label className="jrl-stop-control">
                    <input type="checkbox" checked={midTestEnabled ?? false} onChange={(e) => onToggleMidTest(e.target.checked)} className="hf-checkbox" />
                    <span className="hf-text-xs hf-text-muted">Knowledge Check</span>
                    {midTestQuestionCount != null && <span className="jrl-stop-control-count">{midTestQuestionCount} Qs</span>}
                  </label>
                )}
              </>
            )}
            {entry.type === "post_survey" && (
              <>
                {onTogglePostTest && (
                  <label className="jrl-stop-control">
                    <input type="checkbox" checked={postTestEnabled ?? true} onChange={(e) => onTogglePostTest(e.target.checked)} className="hf-checkbox" />
                    <span className="hf-text-xs hf-text-muted">Knowledge Check</span>
                    {postTestQuestionCount != null && <span className="jrl-stop-control-count">{postTestQuestionCount} Qs</span>}
                  </label>
                )}
                <label className="jrl-stop-control">
                  <input type="checkbox" checked={true} disabled className="hf-checkbox" />
                  <span className="hf-text-xs hf-text-muted">Course Feedback</span>
                  {postSurveyQuestionCount != null && <span className="jrl-stop-control-count">{postSurveyQuestionCount} Qs</span>}
                </label>
              </>
            )}
          </div>
        )}

        {/* Caller journey: completed session gets a quiet checkmark */}
        {mode === "caller" && state === "completed" && (
          <div className="jrl-completed-line">
            &#10003; Completed
          </div>
        )}

        {/* Phase trail (collapsed) — show when NOT expanded */}
        {!isExpanded && entry.phases && entry.phases.length > 0 && (
          <div className="jrl-phase-trail">
            {entry.phases.map((p, i) => (
              <span key={p.id + i}>
                {i > 0 && <span className="jrl-phase-sep">&rsaquo;</span>}
                {p.label.split(" — ")[0]}
              </span>
            ))}
          </div>
        )}

        {/* Expanded: detail panel */}
        {isExpanded && (
          entry.type === "onboarding" ? (
            renderSessionDetail ? (
              <div className="jrl-active-detail jrl-active-detail--full" style={{ "--station-color": color } as React.CSSProperties}>
                {renderSessionDetail(entry)}
              </div>
            ) : (
              <OnboardingSessionDetail courseId={courseId} color={color} onSwitchTab={onSwitchTab} />
            )
          ) : entry.type === "offboarding" ? (
            renderSessionDetail ? (
              <div className="jrl-active-detail jrl-active-detail--full" style={{ "--station-color": color } as React.CSSProperties}>
                {renderSessionDetail(entry)}
              </div>
            ) : (
              <OffboardingSessionDetail courseId={courseId} color={color} onSwitchTab={onSwitchTab} />
            )
          ) : renderSessionDetail ? (
            <div
              className="jrl-active-detail jrl-active-detail--full"
              style={{ "--station-color": color } as React.CSSProperties}
            >
              {renderSessionDetail(entry)}
            </div>
          ) : (
            <DefaultSessionDetail
              entry={entry}
              mats={mats}
              onThisSession={onThisSession}
              courseId={courseId}
              color={color}
            />
          )
        )}

        {/* Admin: insert session ghost row */}
        {isAdmin && onAddSession && idx < sessions.length - 1 && (
          <div className="jrl-insert-row">
            {insertPickerAfter === entry.session ? (
              <div className="jrl-insert-picker">
                {(educatorTypes || [
                  { educatorLabel: "Learn", dbTypes: ["introduce"], icon: "BookOpen", category: "teaching" },
                  { educatorLabel: "Review", dbTypes: ["review"], icon: "RotateCcw", category: "teaching" },
                  { educatorLabel: "Assess", dbTypes: ["assess"], icon: "Target", category: "teaching" },
                  { educatorLabel: "Survey", dbTypes: ["mid_survey"], icon: "ClipboardList", category: "survey" },
                ]).map((et) => (
                  <button
                    key={et.educatorLabel}
                    className="jrl-insert-option"
                    onClick={() => {
                      onAddSession(entry.session, et.dbTypes[0]);
                      setInsertPickerAfter(null);
                    }}
                    type="button"
                  >
                    {et.category === "survey" ? <ClipboardList size={11} /> : null}
                    {et.educatorLabel}
                  </button>
                ))}
                <button
                  className="jrl-insert-option jrl-insert-cancel"
                  onClick={() => setInsertPickerAfter(null)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="jrl-insert-btn"
                onClick={() => setInsertPickerAfter(entry.session)}
                type="button"
              >
                <Plus size={10} /> Insert
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Class Overview: caller rows ───────────────────

  const renderClassOverview = () => {
    if (mode !== "class") return null;

    return (
      <div className="jrl-class-section">
        <div className="jrl-class-header">
          <div className="hf-flex hf-items-center hf-gap-sm">
            <Users2 size={14} className="hf-text-muted" />
            <span className="hf-text-sm hf-text-bold">
              {callers.length} enrolled
            </span>
          </div>
        </div>

        {callers.map((caller) => {
          const notStarted = caller.currentSession === null;

          return (
            <div
              key={caller.callerId}
              className="jrl-caller-row"
              onClick={() => setFocusCallerId(caller.callerId)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter") setFocusCallerId(caller.callerId);
              }}
            >
              <span className="jrl-caller-name">{caller.name}</span>
              <div className="jrl-caller-mini-rail">
                {sessions.map((s) => {
                  const ds = callerDotState(s.session, caller.currentSession);
                  return (
                    <span
                      key={s.session}
                      className={`jrl-caller-mini-dot jrl-caller-mini-dot--${ds}`}
                    />
                  );
                })}
              </div>
              <span className="jrl-caller-meta">
                {notStarted
                  ? "Not started"
                  : `Session ${caller.currentSession}`}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  // ── Main Render ───────────────────────────────────

  const dur = totalDuration(sessions);

  return (
    <div className="jrl-container">
      {/* Back button (caller → class) */}
      {mode === "caller" && focusCaller && (
        <button
          className="jrl-back-btn"
          onClick={() => setFocusCallerId(null)}
          type="button"
        >
          <ArrowLeft size={12} />
          {focusCaller.name}&apos;s Journey
        </button>
      )}

      {/* Header */}
      <div className="jrl-header">
        <div className="jrl-header-meta">
          <span className="hf-text-sm hf-text-primary">
            {sessions.length} lesson{sessions.length !== 1 ? "s" : ""}
          </span>
          {dur > 0 && (
            <span className="hf-text-xs hf-text-muted">
              ~{formatDuration(dur)}
            </span>
          )}
          {mode === "caller" && focusCaller?.currentSession && (
            <span className="hf-text-xs hf-text-muted">
              Session {focusCaller.currentSession} of {sessions.length}
            </span>
          )}
        </div>
        {onRegenerate && (
          <div className="hf-flex hf-items-center hf-gap-sm">
            <label className="hf-flex hf-items-center hf-gap-xs hf-text-xs hf-text-muted">
              Sessions
              <input
                type="number"
                min={1}
                max={100}
                value={regenSessionCount ?? ""}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  onRegenSessionCountChange?.(v > 0 && v <= 100 ? v : null);
                }}
                className="hf-input hf-input-sm"
                style={{ width: 56 }}
              />
            </label>
            <button onClick={onRegenerate} disabled={regenerating} className="hf-btn hf-btn-secondary hf-btn-sm">
              {regenerating ? (
                <><div className="hf-spinner hf-spinner-xs" /> Regenerating...</>
              ) : (
                <><RefreshCw size={13} /> Regenerate Plan</>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Dot Rail */}
      <DotRail
        steps={dotSteps}
        getState={getDotState}
        onSelect={scrollToSession}
      />

      {/* Vertical rail with stations */}
      <div className="jrl-rail">
        <div className="jrl-rail-line" />
        {sessions.map((entry, idx) => renderStation(entry, idx))}
      </div>

      {/* Class overview rows */}
      {renderClassOverview()}
    </div>
  );
}
