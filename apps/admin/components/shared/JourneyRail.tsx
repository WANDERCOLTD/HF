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
import { Paperclip, Users2, ArrowLeft, ListOrdered, RefreshCw, ExternalLink, Sparkles, Flag, Plus, Trash2, GripVertical, ClipboardList, ChevronDown, BookOpen, Layers, RotateCcw, Target, CheckCircle, Zap, X, Image } from "lucide-react";
import { SESSION_TYPE_ICONS } from "@/lib/lesson-plan/session-ui";
import { DotRail, type DotRailStep, type DotState } from "./DotRail";
import { getSessionTypeColor, getSessionTypeLabel, isFormStop, type SessionTypeConfig, type EducatorType } from "@/lib/lesson-plan/session-ui";
import { SessionTPList, UnassignedTPList, type TPItem, type SessionOption } from "@/components/shared/SessionTPList";
import type { SessionEntry, SessionMediaRef, SessionMediaMap, StudentProgress } from "@/lib/lesson-plan/types";
import "./journey-rail.css";

// ── Available Media type (for "add material" dropdowns) ──

export interface AvailableMedia {
  id: string;
  fileName: string;
  title: string | null;
}

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

  /** Hide the class overview (enrolled caller rows) */
  hideClassOverview?: boolean;

  // ── Merged from SessionPlanViewer ─────────────────

  /** Teaching points per session (keyed by session number) */
  sessionTPs?: Record<number, TPItem[]>;
  /** Teaching points not assigned to any session */
  unassignedTPs?: TPItem[];
  /** Session media map (images, thumbnails, unassigned) */
  mediaMap?: SessionMediaMap | null;
  /** Available media for assignment dropdowns */
  availableMedia?: AvailableMedia[];
  /** Move a TP to a different session */
  onTPMove?: (assertionId: string, toSession: number) => void;
  /** Assign media to a session */
  onSessionMediaAssign?: (mediaId: string, sessionNum: number) => void;
  /** Remove media from a session */
  onSessionMediaRemove?: (sessionNum: number, mediaId: string) => void;
  /** Assign media to a phase within a session */
  onPhaseMediaAssign?: (sessionNum: number, phaseId: string, mediaId: string) => void;
  /** Remove media from a phase within a session */
  onPhaseMediaRemove?: (sessionNum: number, phaseId: string, mediaId: string) => void;
  /** Reorder media within a session */
  onMediaReorder?: (sessionNum: number, fromIdx: number, toIdx: number) => void;

  /** Variant: "full" (default) for interactive rail, "timeline" for read-only compact preview */
  variant?: "full" | "timeline";
  /** Read-only mode (no edit controls) */
  readonly?: boolean;
  /** Max collapsed sessions in timeline variant before "show all" */
  maxCollapsed?: number;
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

      {/* Zebra-striped phases (SPV style) */}
      {entry.phases && entry.phases.length > 0 && (
        <div className="spv-phases">
          {entry.phases.map((phase, pi) => (
            <div
              key={phase.id + pi}
              className={`spv-phase ${pi % 2 === 0 ? "spv-phase--even" : "spv-phase--odd"}`}
            >
              <div className="spv-phase-accent" style={{ background: color }} />
              <div className="spv-phase-content">
                <div className="spv-phase-header">
                  <span className="spv-phase-label">{phase.label}</span>
                  {phase.durationMins && (
                    <span className="spv-phase-dur">{phase.durationMins}m</span>
                  )}
                </div>
                {phase.teachMethods?.length ? (
                  <div className="spv-phase-methods">
                    <Zap size={9} className="hf-session-methods-icon" />
                    {phase.teachMethods.map((m) => (
                      <span key={m} className="hf-chip hf-chip-sm">{m}</span>
                    ))}
                  </div>
                ) : null}
                {phase.guidance && (
                  <div className="spv-phase-guidance">{phase.guidance}</div>
                )}
                {/* Per-phase materials */}
                {phase.media && phase.media.length > 0 && (
                  <div className="spv-phase-materials">
                    {phase.media.map((m) => (
                      <span key={m.mediaId} className="spv-material-chip">
                        <Paperclip size={10} />
                        <span className="spv-material-name">{m.fileName || m.figureRef || "File"}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Session-level materials */}
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
  hideClassOverview = false,
  sessionTPs = {},
  unassignedTPs = [],
  mediaMap,
  availableMedia = [],
  onTPMove,
  onSessionMediaAssign,
  onSessionMediaRemove,
  onPhaseMediaAssign,
  onPhaseMediaRemove,
  onMediaReorder,
  variant = "full",
  readonly = false,
  maxCollapsed = 6,
}: JourneyRailProps) {
  const router = useRouter();
  const [focusCallerId, setFocusCallerId] = useState<string | null>(initialFocusCallerId);
  const [expandedSession, setExpandedSession] = useState<number | null>(null);
  const [insertPickerAfter, setInsertPickerAfter] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const stationRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [lightboxImage, setLightboxImage] = useState<(SessionMediaRef & { mimeType: string }) | null>(null);
  const [unassignedSearch, setUnassignedSearch] = useState("");
  const [dragMediaId, setDragMediaId] = useState<string | null>(null);
  const [phaseDropdown, setPhaseDropdown] = useState<{ sessionNum: number; phaseId: string } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isTimeline = variant === "timeline";
  const isAdmin = !!(onAddSession || onRemoveSession || onRetypeSession) && !isTimeline && !readonly;
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

  // Auto-poll when regenerating — polls until plan data appears.
  useEffect(() => {
    if (sessions.length > 0 || loading || !!error || !regenerating || !onRetry) return;
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
  }, [sessions.length, loading, error, regenerating, onRetry, courseId]);

  // Close phase media dropdown on outside click
  useEffect(() => {
    if (!phaseDropdown) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setPhaseDropdown(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [phaseDropdown]);

  // TP derived data
  const tpLoaded = Object.keys(sessionTPs).length > 0 || unassignedTPs.length > 0;

  const sessionTPOptions: SessionOption[] = useMemo(
    () => sessions.map((e) => ({ session: e.session, label: e.label })),
    [sessions],
  );

  // Media already assigned to phases (to exclude from "available" dropdowns)
  const assignedMediaIds = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of sessions) {
      for (const m of entry.media || []) ids.add(m.mediaId);
      for (const phase of entry.phases || []) {
        for (const m of phase.media || []) ids.add(m.mediaId);
      }
    }
    return ids;
  }, [sessions]);

  const filteredAvailableMedia = useMemo(
    () => availableMedia.filter((m) => !assignedMediaIds.has(m.id)),
    [availableMedia, assignedMediaIds],
  );

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
    if (regenerating) {
      return (
        <div className="jrl-empty hf-glow-active">
          <ListOrdered size={36} className="hf-text-tertiary" />
          <div className="hf-heading-sm hf-text-secondary">Generating lesson plan...</div>
          <p className="hf-text-xs hf-text-muted">This usually takes a few seconds.</p>
        </div>
      );
    }
    return (
      <div className="jrl-empty">
        <ListOrdered size={36} className="hf-text-tertiary" />
        <div className="hf-heading-sm hf-text-secondary">No lesson plan yet</div>
        <p className="hf-text-xs hf-text-muted">
          Generate a lesson plan from your course content.
        </p>
        {onRegenerate && (
          <button onClick={onRegenerate} className="hf-btn hf-btn-primary hf-btn-sm">
            <Sparkles size={14} /> Generate Lesson Plan
          </button>
        )}
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
              <Icon size={14} className="jrl-station-icon" />
            </div>
          );
        })()}

        {/* Collapsed row */}
        <div
          className="jrl-station-row"
          style={{ "--station-color": color } as React.CSSProperties}
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
                {onTogglePreTest && !isComprehension && (
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

        {/* Expanded: Teaching Points (from SPV merge) */}
        {isExpanded && tpLoaded && onTPMove && !formStop && (
          <div style={{ marginLeft: "1.75rem" }}>
            <SessionTPList
              sessionNumber={entry.session}
              assertions={sessionTPs[entry.session] || []}
              sessions={sessionTPOptions}
              onMove={onTPMove}
              readonly={readonly}
            />
          </div>
        )}

        {/* Expanded: Session media strip (drag-drop, from SPV merge) */}
        {isExpanded && !isTimeline && mediaMap && !formStop && (
          <div
            className={`spv-session-media${dragMediaId ? " spv-drop-target" : ""}`}
            style={{ marginLeft: "1.75rem" }}
            onDragOver={(e) => { if (dragMediaId) { e.preventDefault(); e.currentTarget.classList.add("spv-drop-hover"); } }}
            onDragLeave={(e) => e.currentTarget.classList.remove("spv-drop-hover")}
            onDrop={(e) => {
              e.currentTarget.classList.remove("spv-drop-hover");
              if (dragMediaId && onSessionMediaAssign) {
                onSessionMediaAssign(dragMediaId, entry.session);
                setDragMediaId(null);
              }
            }}
          >
            {(() => {
              const sm = mediaMap.sessions?.find((s) => s.session === entry.session);
              if (sm && sm.images.length > 0) {
                return sm.images.map((img) => (
                  <div
                    key={img.mediaId}
                    className="hf-session-media-thumb"
                    title={img.captionText || img.figureRef || img.fileName}
                  >
                    {img.mimeType.startsWith("image/") ? (
                      <img
                        src={`/api/media/${img.mediaId}`}
                        alt={img.captionText || img.figureRef || ""}
                        onClick={() => setLightboxImage(img)}
                        style={{ cursor: "pointer" }}
                      />
                    ) : (
                      <span className="hf-session-media-icon" onClick={() => setLightboxImage(img)} style={{ cursor: "pointer" }}>{img.figureRef || "File"}</span>
                    )}
                    {!readonly && onSessionMediaRemove && (
                      <button
                        className="hf-session-media-remove"
                        onClick={(e) => { e.stopPropagation(); onSessionMediaRemove(entry.session, img.mediaId); }}
                        title="Remove from session"
                      >&#10005;</button>
                    )}
                  </div>
                ));
              }
              return null;
            })()}
          </div>
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

  // ── Timeline variant: visible entries ──────────────

  const visibleEntries = isTimeline && !showAll && sessions.length > maxCollapsed
    ? [...sessions.slice(0, maxCollapsed - 1), sessions[sessions.length - 1]]
    : sessions;

  const hiddenCount = isTimeline && !showAll && sessions.length > maxCollapsed
    ? sessions.length - maxCollapsed
    : 0;

  // ── Unassigned images (below rail) ───────────────

  const renderUnassignedImages = () => {
    if (isTimeline || !mediaMap || mediaMap.unassigned.length === 0) return null;
    const filtered = unassignedSearch
      ? mediaMap.unassigned.filter((img) => {
          const q = unassignedSearch.toLowerCase();
          return (img.fileName?.toLowerCase().includes(q)) ||
            (img.captionText?.toLowerCase().includes(q)) ||
            (img.figureRef?.toLowerCase().includes(q));
        })
      : mediaMap.unassigned;
    const PAGE_SIZE = 12;
    const shown = filtered.slice(0, PAGE_SIZE);
    const remaining = filtered.length - PAGE_SIZE;

    return (
      <div className="hf-card-compact hf-mt-md">
        <div className="hf-flex hf-flex-between hf-items-center hf-mb-sm">
          <span className="hf-section-title hf-text-sm">
            <Image size={14} /> Unassigned Images ({mediaMap.unassigned.length})
          </span>
          <div className="hf-flex hf-gap-sm hf-items-center">
            {mediaMap.unassigned.length > 6 && (
              <input
                type="text"
                className="hf-input hf-input-xs"
                placeholder="Filter images\u2026"
                value={unassignedSearch}
                onChange={(e) => setUnassignedSearch(e.target.value)}
                style={{ width: 140 }}
              />
            )}
            <span className="hf-text-xs hf-text-muted">
              {mediaMap.stats.assigned} of {mediaMap.stats.total} assigned
            </span>
          </div>
        </div>
        <div className="hf-session-media-grid">
          {shown.map((img) => (
            <div
              key={img.mediaId}
              className="hf-session-media-card"
              draggable={!readonly}
              onDragStart={(e) => { setDragMediaId(img.mediaId); e.dataTransfer.setData("text/plain", `assign:${img.mediaId}`); e.dataTransfer.effectAllowed = "move"; }}
              onDragEnd={() => setDragMediaId(null)}
            >
              <div className="hf-session-media-card-thumb" onClick={() => setLightboxImage(img)} style={{ cursor: "pointer" }}>
                {img.mimeType.startsWith("image/") ? (
                  <img src={`/api/media/${img.mediaId}`} alt={img.captionText || img.figureRef || ""} />
                ) : (
                  <span className="hf-session-media-icon">{img.figureRef || "File"}</span>
                )}
              </div>
              <div className="hf-session-media-card-label">
                {img.figureRef || img.captionText || img.fileName}
              </div>
              {!readonly && onSessionMediaAssign && (
                <select
                  className="hf-input hf-input-xs"
                  defaultValue=""
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (val > 0) onSessionMediaAssign(img.mediaId, val);
                    e.target.value = "";
                  }}
                >
                  <option value="" disabled>Assign to session\u2026</option>
                  {sessions.map((se) => (
                    <option key={se.session} value={se.session}>
                      S{se.session}: {se.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ))}
        </div>
        {remaining > 0 && (
          <p className="hf-text-xs hf-text-muted hf-mt-sm">
            +{remaining} more — use the filter to find specific images
          </p>
        )}
      </div>
    );
  };

  // ── Main Render ───────────────────────────────────

  const dur = totalDuration(sessions);

  // Timeline variant: simplified read-only view
  if (isTimeline) {
    return (
      <div className="jrl-container">
        <div className="spv-timeline-header">
          <span className="hf-section-title hf-mb-0">Session Plan</span>
          <span className="hf-text-xs hf-text-muted">
            {sessions.length} session{sessions.length !== 1 ? "s" : ""}
            {dur > 0 ? ` \u00b7 ~${formatDuration(dur)}` : ""}
          </span>
        </div>
        <div className="spv-timeline">
          <div className="spv-timeline-line" />
          {visibleEntries.map((entry, i) => {
            const realIndex = !showAll && sessions.length > maxCollapsed && i === visibleEntries.length - 1
              ? sessions.length - 1
              : i;
            const color = getSessionTypeColor(entry.type);
            return (
              <div key={`sess-${entry.session}`} className="spv-timeline-item">
                <div className="spv-timeline-node" style={{ borderColor: color }} />
                <div className="hf-session-row" style={{ "--session-color": color } as React.CSSProperties}>
                  <span className="hf-session-num">{entry.session}</span>
                  <span className="hf-session-type cd-session-type">{getSessionTypeLabel(entry.type)}</span>
                  <span className="hf-session-label">{entry.label}</span>
                  {entry.estimatedDurationMins ? (
                    <span className="hf-session-meta">{entry.estimatedDurationMins}m</span>
                  ) : null}
                </div>
                {/* Phase breadcrumbs */}
                {entry.phases && entry.phases.length > 0 && (
                  <div className="jrl-phase-trail">
                    {entry.phases.map((p, pi) => (
                      <span key={p.id + pi}>
                        {pi > 0 && <span className="jrl-phase-sep">&rsaquo;</span>}
                        {p.label.split(" — ")[0]}
                      </span>
                    ))}
                  </div>
                )}
                {/* "Show all" toggle */}
                {hiddenCount > 0 && i === maxCollapsed - 2 && (
                  <button className="spv-show-all-btn" onClick={() => setShowAll(true)}>
                    Show all {sessions.length} sessions ({hiddenCount} hidden)
                  </button>
                )}
              </div>
            );
          })}
          {showAll && sessions.length > maxCollapsed && (
            <button className="spv-show-all-btn" onClick={() => setShowAll(false)}>
              Show fewer
            </button>
          )}
        </div>
      </div>
    );
  }

  // Full variant: interactive rail
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
        {onRegenerate && !readonly && (
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

      {/* Unassigned TPs (from SPV merge) */}
      {tpLoaded && unassignedTPs.length > 0 && onTPMove && (
        <UnassignedTPList
          assertions={unassignedTPs}
          sessions={sessionTPOptions}
          onMove={onTPMove}
        />
      )}

      {/* Unassigned images (from SPV merge) */}
      {renderUnassignedImages()}

      {/* Class overview rows */}
      {!hideClassOverview && renderClassOverview()}

      {/* Lightbox */}
      {lightboxImage && (
        <div className="spv-lightbox-overlay" onClick={() => setLightboxImage(null)}>
          <div className="spv-lightbox-content" onClick={(e) => e.stopPropagation()}>
            {lightboxImage.mimeType.startsWith("image/") ? (
              <img src={`/api/media/${lightboxImage.mediaId}`} alt={lightboxImage.captionText || ""} />
            ) : null}
            {lightboxImage.captionText && <p className="spv-lightbox-caption">{lightboxImage.captionText}</p>}
            <button className="spv-lightbox-close" onClick={() => setLightboxImage(null)}>&#10005;</button>
          </div>
        </div>
      )}
    </div>
  );
}
