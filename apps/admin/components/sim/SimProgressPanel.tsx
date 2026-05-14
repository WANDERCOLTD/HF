'use client';

import { useEffect, type JSX } from 'react';
import { ArrowLeft, X, Target, BookOpen, Lightbulb, Phone, TrendingUp } from 'lucide-react';
import { useStudentProgress } from '@/hooks/useStudentProgress';
import { useJourneyPosition } from '@/hooks/useJourneyPosition';

interface SimProgressPanelProps {
  onClose: () => void;
  callerId: string;
  callerName: string;
}

export function SimProgressPanel({ onClose, callerId }: SimProgressPanelProps): JSX.Element {
  const { data, loading, error } = useStudentProgress(callerId);
  const { position } = useJourneyPosition(callerId);

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
