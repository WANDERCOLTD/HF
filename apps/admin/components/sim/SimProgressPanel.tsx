'use client';

import { useEffect, type JSX } from 'react';
import { ArrowLeft, X, Target, BookOpen, Lightbulb, Phone, TrendingUp, CheckCircle2, Circle, PlayCircle, Award } from 'lucide-react';
import { useStudentProgress } from '@/hooks/useStudentProgress';
import { useJourneyPosition } from '@/hooks/useJourneyPosition';
import { useSchedulerDecision } from '@/hooks/useSchedulerDecision';
import { getSchedulerModeLabel } from '@/lib/scheduler/mode-labels';

/**
 * #917 Slice 2 — countdown copy assumes the BALANCED preset cadence (3 calls
 * between Mock checkpoints, see `lib/pipeline/scheduler-presets.ts`). Until
 * the API surfaces the active playbook's effective cadence, this is the
 * default. Per-course overrides via `Playbook.config.tolerances.retrievalCadenceOverride`
 * (#598 Slice 1) are NOT reflected in this number — acceptable for v1 since
 * the cadence is approximate guidance, not a contract.
 */
const DEFAULT_MOCK_CADENCE = 3;

/** #493 Slice 5.4 — humanise the completion mode into educator-friendly copy. */
function describeCompletionMode(mode: 'all-modules' | 'terminal-only' | 'any'): string {
  if (mode === 'terminal-only') return 'You finished the final module of this course.';
  if (mode === 'all-modules') return 'You mastered every module.';
  return 'You completed your first module — keep going to master the rest.';
}

/** #493 Slice 5.4 — format an ISO date with `Intl.DateTimeFormat`, medium style. */
function formatCompletedAt(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(d);
}

interface SimProgressPanelProps {
  onClose: () => void;
  callerId: string;
  callerName: string;
}

export function SimProgressPanel({ onClose, callerId }: SimProgressPanelProps): JSX.Element {
  const { data, loading, error } = useStudentProgress(callerId);
  const { position } = useJourneyPosition(callerId);
  const { data: decision } = useSchedulerDecision(callerId);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="wa-progress-panel">
      {/* Header */}
      <div className="wa-progress-header">
        <button className="wa-back-btn" onClick={onClose} aria-label="Close progress panel">
          <ArrowLeft size={22} />
        </button>
        <span className="wa-progress-header-title">Progress</span>
        <button className="wa-back-btn" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
      </div>

      {/* Body */}
      <div className="wa-progress-body">
        {loading && (
          <div className="wa-progress-loading">
            <div className="hf-spinner" />
          </div>
        )}

        {error && (
          <div className="wa-progress-empty">{error}</div>
        )}

        {!loading && !error && data && (
          <>
            {/* #493 Slice 5.4 — Course Complete hero. Rendered FIRST when the
                course-completion predicate returns complete=true. Educator-
                friendly copy varies by completionMode (terminal-only is the
                IELTS-style default; all-modules covers strict-mastery courses;
                any covers open-ended / exploratory courses). */}
            {data.courseComplete?.complete && (
              <div className="wa-progress-course-complete">
                <div className="wa-progress-course-complete-icon">
                  <Award size={28} />
                </div>
                <div className="wa-progress-course-complete-title">Course complete!</div>
                {data.courseComplete.completedAt && (
                  <div className="wa-progress-course-complete-subtitle">
                    You completed this course on {formatCompletedAt(data.courseComplete.completedAt)}.
                  </div>
                )}
                <div className="wa-progress-course-complete-desc">
                  {describeCompletionMode(data.courseComplete.mode)}
                </div>
              </div>
            )}

            {/* #917 Slice 2 — "Today's call" section. Hidden entirely when
                the scheduler decision is null (cold start, stale, multi-course
                learner, fully-sanitized reason). Countdown is omitted when
                the next call is already a Mock (`mode === 'assess'`). */}
            {decision && (
              <div className="wa-progress-section wa-progress-today-call">
                <div className="wa-progress-section-title">Today&apos;s call</div>
                <div className="wa-progress-today-header">
                  <span className="wa-progress-today-mode">
                    {getSchedulerModeLabel(decision.mode)} mode
                  </span>
                  {decision.mode !== 'assess' && decision.callsSinceAssess != null && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="wa-progress-today-countdown">
                        {Math.max(0, DEFAULT_MOCK_CADENCE - decision.callsSinceAssess)} calls until Mock
                      </span>
                    </>
                  )}
                </div>
                {decision.reason && (
                  <div className="wa-progress-today-reason">{decision.reason}</div>
                )}
              </div>
            )}

            {/* Journey progress */}
            {position && position.totalStops > 0 && (
              <div className="wa-progress-section">
                <div className="wa-progress-section-title">
                  {position.isContinuous ? 'Progress' : 'Journey'}
                </div>
                <div className="wa-progress-journey">
                  <div className="wa-progress-bar">
                    <div
                      className="wa-progress-bar-fill"
                      style={{
                        width: position.isContinuous
                          ? `${position.progressPercentage ?? 0}%`
                          : `${position.totalStops > 0 ? (position.completedStops / position.totalStops) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="wa-progress-journey-label">
                    {position.isContinuous
                      ? `${position.progressPercentage ?? 0}% mastered`
                      : `${position.completedStops} of ${position.totalStops} sessions complete`
                    }
                  </span>
                </div>
              </div>
            )}

            {/* #493 Slice 5.3 — Focus areas section. Higher signal than the
                module roster post-Mock, so rendered ABOVE Modules. Shows the
                summary sentence, then a strength/focus-next/weak-skill list.
                Each item is conditional — strength + weak skill may be null on
                the very first Mock when there's no prior evidence. */}
            {data.diagnosticFromMock && (
              <div className="wa-progress-section wa-progress-focus-section">
                <div className="wa-progress-section-title">Focus areas</div>
                {data.diagnosticFromMock.summary && (
                  <div className="wa-progress-empty">
                    {data.diagnosticFromMock.summary}
                  </div>
                )}
                {data.diagnosticFromMock.strengthModule && (
                  <div className="wa-progress-focus-row wa-progress-focus-strength">
                    <CheckCircle2 size={14} className="wa-progress-focus-icon" />
                    <span>{data.diagnosticFromMock.strengthModule.title}</span>
                  </div>
                )}
                {data.diagnosticFromMock.focusModules.map((m) => (
                  <div key={m.id} className="wa-progress-focus-row wa-progress-focus-next">
                    <PlayCircle size={14} className="wa-progress-focus-icon" />
                    <span>{m.title}</span>
                  </div>
                ))}
                {data.diagnosticFromMock.weakSkill && (
                  <div className="wa-progress-focus-row wa-progress-focus-weak">
                    <Lightbulb size={14} className="wa-progress-focus-icon" />
                    <span>{data.diagnosticFromMock.weakSkill}</span>
                  </div>
                )}
              </div>
            )}

            {/* #493 Slice 5.2 — Modules section. Per-module status from
                CallerModuleProgress. Inserted between Journey and Goals so the
                learner sees module structure first, then per-goal % progress.
                Status icons: CheckCircle2 (mastered) / PlayCircle (in progress)
                / Circle (not started). LOCKED is presentation-only (E4 picker
                computes it from prereqs); the API never returns it. */}
            {data.modules && data.modules.length > 0 && (
              <div className="wa-progress-section">
                <div className="wa-progress-section-title">
                  Modules ({data.modules.length})
                </div>
                <div className="wa-progress-modules">
                  {data.modules.map(m => {
                    const StatusIcon =
                      m.status === 'MASTERED' ? CheckCircle2
                      : m.status === 'IN_PROGRESS' ? PlayCircle
                      : Circle;
                    const statusClass =
                      m.status === 'MASTERED' ? 'wa-progress-module-mastered'
                      : m.status === 'IN_PROGRESS' ? 'wa-progress-module-in-progress'
                      : 'wa-progress-module-not-started';
                    return (
                      <div key={m.id} className={`wa-progress-module-row ${statusClass}`}>
                        <StatusIcon size={14} className="wa-progress-module-icon" />
                        <span className="wa-progress-module-title">{m.title}</span>
                        <span className="wa-progress-module-meta">
                          {m.callCount > 0 ? `${m.callCount} call${m.callCount === 1 ? '' : 's'}` : '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Goals */}
            {data.goals.length > 0 && (
              <div className="wa-progress-section">
                <div className="wa-progress-section-title">
                  Goals ({data.goals.length})
                </div>
                <div className="wa-progress-goals">
                  {data.goals.map(goal => (
                    <div key={goal.id} className="wa-progress-goal-row">
                      <div className="wa-progress-goal-header">
                        <Target size={14} className="wa-progress-goal-icon" />
                        <span className="wa-progress-goal-name">{goal.name}</span>
                        <span className="wa-progress-goal-pct">
                          {Math.round(goal.progress * 100)}%
                        </span>
                      </div>
                      <div className="wa-progress-goal-bar">
                        <div
                          className="wa-progress-goal-bar-fill"
                          style={{ width: `${goal.progress * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Stats grid */}
            <div className="wa-progress-section">
              <div className="wa-progress-section-title">Stats</div>
              <div className="wa-progress-stat-grid">
                <div className="wa-progress-stat">
                  <Phone size={16} className="wa-progress-stat-icon" />
                  <span className="wa-progress-stat-value">{data.totalCalls}</span>
                  <span className="wa-progress-stat-label">Calls</span>
                </div>
                <div className="wa-progress-stat">
                  <BookOpen size={16} className="wa-progress-stat-icon" />
                  <span className="wa-progress-stat-value">{data.topicCount}</span>
                  <span className="wa-progress-stat-label">Topics</span>
                </div>
                <div className="wa-progress-stat">
                  <Lightbulb size={16} className="wa-progress-stat-icon" />
                  <span className="wa-progress-stat-value">{data.keyFactCount}</span>
                  <span className="wa-progress-stat-label">Key Facts</span>
                </div>
                {data.testScores.uplift && (
                  <div className="wa-progress-stat">
                    <TrendingUp size={16} className="wa-progress-stat-icon" />
                    <span className="wa-progress-stat-value">
                      +{Math.round(data.testScores.uplift.absolute)}%
                    </span>
                    <span className="wa-progress-stat-label">Improvement</span>
                  </div>
                )}
              </div>
            </div>

            {/* Test scores */}
            {(data.testScores.preTest != null || data.testScores.postTest != null) && (
              <div className="wa-progress-section">
                <div className="wa-progress-section-title">Test Scores</div>
                <div className="wa-progress-test-row">
                  {data.testScores.preTest != null && (
                    <div className="wa-progress-test-score">
                      <span className="wa-progress-test-label">Pre-test</span>
                      <span className="wa-progress-test-value">
                        {Math.round(data.testScores.preTest)}%
                      </span>
                    </div>
                  )}
                  {data.testScores.preTest != null && data.testScores.postTest != null && (
                    <span className="wa-progress-test-arrow">→</span>
                  )}
                  {data.testScores.postTest != null && (
                    <div className="wa-progress-test-score">
                      <span className="wa-progress-test-label">Post-test</span>
                      <span className="wa-progress-test-value wa-progress-test-post">
                        {Math.round(data.testScores.postTest)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Recent topics */}
            {data.topTopics.length > 0 && (
              <div className="wa-progress-section">
                <div className="wa-progress-section-title">Recent Topics</div>
                <div className="wa-progress-topic-list">
                  {data.topTopics.slice(0, 5).map(t => (
                    <div key={t.topic} className="wa-progress-topic-item">
                      {t.topic}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Empty state — no data at all */}
            {data.goals.length === 0 && data.totalCalls === 0 && data.topicCount === 0 && (
              <div className="wa-progress-empty">
                No progress data yet. Start a practice session to begin tracking.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
