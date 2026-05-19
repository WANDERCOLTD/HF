'use client';

/**
 * #493 Slice 5.5 — Educator-side parallel mirror of the learner's
 * SimProgressPanel.
 *
 * - Reads from the SAME `/api/student/progress?callerId=X` endpoint via the
 *   SAME `useStudentProgress` hook the learner panel uses. Single source of
 *   truth — no parallel data paths.
 * - Read-only. No click handlers on module rows, no recommended-next chip,
 *   no celebratory hero.
 * - Educator tone: analytical, calm, factual. Course completion shows as a
 *   stat line, not a hero card. Mastery thresholds + EMA values are surfaced
 *   as informational badges next to module bars.
 * - Uses admin shell `hf-*` classes only (NOT learner-chat `wa-*` classes).
 * - All non-dynamic visual styling lives in `app/x/educator/educator.css`
 *   under the `.epv-*` namespace. Inline `style={{}}` only for runtime widths.
 */

import type { JSX } from 'react';
import {
  Award,
  BookOpen,
  CheckCircle2,
  Circle,
  Lightbulb,
  PlayCircle,
  Phone,
  Target,
  TrendingUp,
} from 'lucide-react';
import { useStudentProgress } from '@/hooks/useStudentProgress';

interface EducatorProgressViewProps {
  callerId: string;
}

/** #493 Slice 5.5 — humanise the completion mode into educator-facing copy. */
function describeCompletionMode(mode: 'all-modules' | 'terminal-only' | 'any'): string {
  if (mode === 'terminal-only') return 'Learner finished the terminal module of this course.';
  if (mode === 'all-modules') return 'Learner mastered every module.';
  return 'Learner completed at least one module of an open-ended course.';
}

/** #493 Slice 5.5 — format an ISO date with `Intl.DateTimeFormat`, medium style. */
function formatCompletedAt(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(d);
}

/** #493 Slice 5.5 — format an EMA mastery value against its threshold. */
function formatMasteryBadge(mastery: number, threshold: number): string {
  return `EMA mastery ${mastery.toFixed(2)} / ${threshold.toFixed(2)} threshold`;
}

export function EducatorProgressView({ callerId }: EducatorProgressViewProps): JSX.Element {
  const { data, loading, error } = useStudentProgress(callerId);

  if (loading) {
    return (
      <div className="epv-loading" data-testid="epv-loading">
        <div className="hf-spinner" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="hf-banner hf-banner-error" data-testid="epv-error">
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="hf-empty" data-testid="epv-empty">
        No progress data available for this learner.
      </div>
    );
  }

  const noActivity =
    data.goals.length === 0 &&
    data.totalCalls === 0 &&
    data.topicCount === 0 &&
    (!data.modules || data.modules.length === 0);

  if (noActivity) {
    return (
      <div className="hf-empty" data-testid="epv-empty">
        No progress data yet. Learner has not started any practice sessions.
      </div>
    );
  }

  const masteredCount = data.modules?.filter((m) => m.status === 'MASTERED').length ?? 0;
  const totalModules = data.modules?.length ?? 0;

  return (
    <div className="epv-root" data-testid="epv-root">
      {/* #493 Slice 5.5 — Course completion as a stat row, NOT a celebratory
          hero. Educator gets a one-line factual readout: status + date. */}
      {data.courseComplete?.complete && (
        <div className="epv-course-complete" data-testid="epv-course-complete">
          <Award size={16} className="epv-course-complete-icon" aria-hidden />
          <span className="epv-course-complete-label">Status:</span>
          <span className="epv-course-complete-value">
            Course complete
            {data.courseComplete.completedAt
              ? ` — completed ${formatCompletedAt(data.courseComplete.completedAt)}`
              : ''}
          </span>
          <span className="epv-info-badge" title={describeCompletionMode(data.courseComplete.mode)}>
            {data.courseComplete.mode}
          </span>
        </div>
      )}

      {/* #493 Slice 5.5 — Progress / Journey section. Same data shape as the
          learner panel, but framed as "progress against journey", not "your
          journey". */}
      {totalModules > 0 && (
        <div className="hf-card-compact epv-section">
          <div className="hf-section-title epv-section-title">
            Progress
            <span className="epv-info-badge">
              {masteredCount} / {totalModules} modules mastered
            </span>
          </div>
          <div className="epv-progress-bar">
            <div
              className="epv-progress-bar-fill"
              style={{
                width: `${totalModules > 0 ? (masteredCount / totalModules) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* #493 Slice 5.5 — Focus areas from the most-recent Mock diagnostic.
          Same source as the learner panel (`diagnosticFromMock`), but framed
          for the educator as "what to coach next". */}
      {data.diagnosticFromMock && (
        <div className="hf-card-compact epv-section" data-testid="epv-diagnostic">
          <div className="hf-section-title epv-section-title">
            Last Mock diagnostic
          </div>
          {data.diagnosticFromMock.summary && (
            <div className="epv-section-desc">{data.diagnosticFromMock.summary}</div>
          )}
          <div className="epv-focus-list">
            {data.diagnosticFromMock.strengthModule && (
              <div className="epv-focus-row epv-focus-strength">
                <CheckCircle2 size={14} className="epv-focus-icon" aria-hidden />
                <span className="epv-focus-label">Strength:</span>
                <span className="epv-focus-value">{data.diagnosticFromMock.strengthModule.title}</span>
              </div>
            )}
            {data.diagnosticFromMock.focusModules.map((m) => (
              <div key={m.id} className="epv-focus-row epv-focus-next">
                <PlayCircle size={14} className="epv-focus-icon" aria-hidden />
                <span className="epv-focus-label">Focus next:</span>
                <span className="epv-focus-value">{m.title}</span>
              </div>
            ))}
            {data.diagnosticFromMock.weakSkill && (
              <div className="epv-focus-row epv-focus-weak">
                <Lightbulb size={14} className="epv-focus-icon" aria-hidden />
                <span className="epv-focus-label">Weakest skill:</span>
                <span className="epv-focus-value">{data.diagnosticFromMock.weakSkill}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* #493 Slice 5.5 — Modules section. READ-ONLY status rows — no click
          handlers, no recommended-next badge. Each row carries an EMA-mastery
          info badge so the educator can see exactly how far below threshold
          the learner is. */}
      {totalModules > 0 && (
        <div className="hf-card-compact epv-section" data-testid="epv-modules">
          <div className="hf-section-title epv-section-title">
            Modules
            <span className="epv-info-badge">{totalModules} total</span>
          </div>
          <div className="epv-modules">
            {data.modules.map((m) => {
              const StatusIcon =
                m.status === 'MASTERED'
                  ? CheckCircle2
                  : m.status === 'IN_PROGRESS'
                    ? PlayCircle
                    : Circle;
              const statusClass =
                m.status === 'MASTERED'
                  ? 'epv-module-mastered'
                  : m.status === 'IN_PROGRESS'
                    ? 'epv-module-in-progress'
                    : 'epv-module-not-started';
              const statusLabel =
                m.status === 'MASTERED'
                  ? 'Mastered'
                  : m.status === 'IN_PROGRESS'
                    ? 'In progress'
                    : 'Not started';
              return (
                <div key={m.id} className={`epv-module-row ${statusClass}`}>
                  <StatusIcon size={14} className="epv-module-icon" aria-hidden />
                  <span className="epv-module-title">{m.title}</span>
                  <span className="epv-module-status-badge">{statusLabel}</span>
                  <span className="epv-info-badge epv-module-mastery-badge">
                    {formatMasteryBadge(m.mastery, m.masteryThreshold)}
                  </span>
                  <span className="epv-module-meta">
                    {m.callCount > 0
                      ? `${m.callCount} call${m.callCount === 1 ? '' : 's'}`
                      : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* #493 Slice 5.5 — Goals section. Identical data shape to learner side,
          rendered with neutral admin-shell styling. */}
      {data.goals.length > 0 && (
        <div className="hf-card-compact epv-section" data-testid="epv-goals">
          <div className="hf-section-title epv-section-title">
            Goals
            <span className="epv-info-badge">{data.goals.length} active</span>
          </div>
          <div className="epv-goals">
            {data.goals.map((goal) => (
              <div key={goal.id} className="epv-goal-row">
                <div className="epv-goal-header">
                  <Target size={14} className="epv-goal-icon" aria-hidden />
                  <span className="epv-goal-name">{goal.name}</span>
                  <span className="epv-goal-pct">{Math.round(goal.progress * 100)}%</span>
                </div>
                <div className="epv-goal-bar">
                  <div
                    className="epv-goal-bar-fill"
                    style={{ width: `${goal.progress * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* #493 Slice 5.5 — Stats grid. Same four metrics as the learner panel. */}
      <div className="hf-card-compact epv-section" data-testid="epv-stats">
        <div className="hf-section-title epv-section-title">Stats</div>
        <div className="epv-stat-grid">
          <div className="epv-stat">
            <Phone size={16} className="epv-stat-icon" aria-hidden />
            <span className="epv-stat-value">{data.totalCalls}</span>
            <span className="epv-stat-label">Calls</span>
          </div>
          <div className="epv-stat">
            <BookOpen size={16} className="epv-stat-icon" aria-hidden />
            <span className="epv-stat-value">{data.topicCount}</span>
            <span className="epv-stat-label">Topics</span>
          </div>
          <div className="epv-stat">
            <Lightbulb size={16} className="epv-stat-icon" aria-hidden />
            <span className="epv-stat-value">{data.keyFactCount}</span>
            <span className="epv-stat-label">Key facts</span>
          </div>
          {data.testScores.uplift && (
            <div className="epv-stat">
              <TrendingUp size={16} className="epv-stat-icon" aria-hidden />
              <span className="epv-stat-value">
                +{Math.round(data.testScores.uplift.absolute)}%
              </span>
              <span className="epv-stat-label">Uplift</span>
            </div>
          )}
        </div>
      </div>

      {/* #493 Slice 5.5 — Test scores section. */}
      {(data.testScores.preTest != null || data.testScores.postTest != null) && (
        <div className="hf-card-compact epv-section" data-testid="epv-test-scores">
          <div className="hf-section-title epv-section-title">Test scores</div>
          <div className="epv-test-row">
            {data.testScores.preTest != null && (
              <div className="epv-test-score">
                <span className="epv-test-label">Pre-test</span>
                <span className="epv-test-value">
                  {Math.round(data.testScores.preTest)}%
                </span>
              </div>
            )}
            {data.testScores.preTest != null && data.testScores.postTest != null && (
              <span className="epv-test-arrow" aria-hidden>
                →
              </span>
            )}
            {data.testScores.postTest != null && (
              <div className="epv-test-score">
                <span className="epv-test-label">Post-test</span>
                <span className="epv-test-value epv-test-post">
                  {Math.round(data.testScores.postTest)}%
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* #493 Slice 5.5 — Recent topics. */}
      {data.topTopics.length > 0 && (
        <div className="hf-card-compact epv-section" data-testid="epv-recent-topics">
          <div className="hf-section-title epv-section-title">Recent topics</div>
          <div className="epv-topic-list">
            {data.topTopics.slice(0, 5).map((t) => (
              <div key={t.topic} className="epv-topic-item">
                {t.topic}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
