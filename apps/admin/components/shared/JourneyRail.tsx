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
import { Paperclip, Users2, ArrowLeft, ListOrdered, RefreshCw, ExternalLink, Sparkles, Flag } from "lucide-react";
import { DotRail, type DotRailStep, type DotState } from "./DotRail";
import { getSessionTypeColor, getSessionTypeLabel } from "@/lib/lesson-plan/session-ui";
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
            onSwitchTab("onboarding");
          } else {
            router.push(`/x/courses/${courseId}?tab=onboarding`);
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
            onSwitchTab("onboarding");
          } else {
            router.push(`/x/courses/${courseId}?tab=onboarding`);
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
}: JourneyRailProps) {
  const router = useRouter();
  const [focusCallerId, setFocusCallerId] = useState<string | null>(initialFocusCallerId);
  const [expandedSession, setExpandedSession] = useState<number | null>(null);
  const stationRefs = useRef<Record<number, HTMLDivElement | null>>({});

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
      <div className="jrl-empty">
        <ListOrdered size={36} className="hf-text-tertiary" />
        <div className="hf-heading-sm hf-text-secondary">No lesson plan yet</div>
        <p className="hf-text-xs hf-text-muted">
          A lesson plan is created when you set up your course content.
        </p>
      </div>
    );
  }

  // ── Station render (one session row) ──────────────

  const renderStation = (entry: SessionEntry) => {
    const state = getDotState(entry.session);
    const color = getSessionTypeColor(entry.type);
    const typeLabel = getSessionTypeLabel(entry.type);
    const mats = materialCount(entry);
    const tps = entry.assertionCount ?? 0;
    const onThisSession = callersOnSession(entry.session);

    // In caller mode: active session auto-expands
    const isActiveForCaller = mode === "caller" && focusCaller?.currentSession === entry.session;
    const isExpanded = isActiveForCaller || expandedSession === entry.session;

    return (
      <div
        key={entry.session}
        className="jrl-station"
        ref={(el) => { stationRefs.current[entry.session] = el; }}
      >
        {/* Node on the rail */}
        <div
          className={`jrl-station-node jrl-station-node--${state}`}
          style={{ "--station-color": color } as React.CSSProperties}
        />

        {/* Collapsed row */}
        <div
          className="jrl-station-row"
          onClick={() => {
            if (isActiveForCaller) {
              // Active session in caller mode: navigate to detail
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
          <span className="jrl-station-num">{entry.session}</span>
          <span className="jrl-station-label">{entry.label}</span>
          <span
            className="jrl-station-type"
            style={{ "--station-color": color } as React.CSSProperties}
          >
            {typeLabel}
          </span>
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
          </span>
        </div>

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
            <OnboardingSessionDetail courseId={courseId} color={color} onSwitchTab={onSwitchTab} />
          ) : entry.type === "offboarding" ? (
            <OffboardingSessionDetail courseId={courseId} color={color} onSwitchTab={onSwitchTab} />
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
        {sessions.map(renderStation)}
      </div>

      {/* Class overview rows */}
      {renderClassOverview()}
    </div>
  );
}
