'use client';

import { useState, useEffect } from 'react';

interface LearningParam {
  parameterId: string;
  name: string;
  scores: number[];
  latest: number;
}

interface LearningData {
  profile: string;
  profileLabel: string;
  competencyLevel: string | null;
  parameters: LearningParam[];
  checkpoints: { key: string; status: string; score: number | null }[];
}

const BAND_LABELS: Record<string, string> = {
  mastery: 'Mastery',
  secure: 'Secure',
  developing: 'Developing',
  emerging: 'Emerging',
  no_evidence: 'No evidence yet',
};

const PARAM_LABELS: Record<string, string> = {
  COMP_RETRIEVAL: 'Retrieval', COMP_INFERENCE: 'Inference', COMP_VOCABULARY: 'Vocabulary',
  COMP_LANGUAGE: 'Language', COMP_EVALUATION: 'Evaluation', COMP_RECALL: 'Recall',
  DISC_PERSPECTIVE: 'Perspective', DISC_ARGUMENT: 'Argument', DISC_SHIFT: 'Position Shift', DISC_REFLECTION: 'Reflection',
  COACH_CLARITY: 'Goal Clarity', COACH_ACTION: 'Action', COACH_AWARENESS: 'Self-Awareness', COACH_FOLLOWUP: 'Follow-Through',
};

/**
 * Compact progress card shown in SimChat after a call ends.
 * Fetches the caller's learning trajectory and shows a WhatsApp-style summary.
 * Self-loading — renders null if no learning data exists.
 */
export function PostCallProgressCard({ callerId }: { callerId: string }): JSX.Element | null {
  const [data, setData] = useState<LearningData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/callers/${callerId}/learning-trajectory`);
        if (!res.ok) { setLoading(false); return; }
        const json = await res.json();
        if (!cancelled && json.ok) setData(json.data);
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [callerId]);

  if (loading || !data || data.parameters.length === 0) return null;

  const avgScore = data.parameters.reduce((s, p) => s + p.latest, 0) / data.parameters.length;

  return (
    <div className="wa-progress-card">
      <div className="wa-progress-header">
        <span className="wa-progress-label">{data.profileLabel}</span>
        {data.competencyLevel && (
          <span className={`wa-progress-badge wa-progress-badge--${data.competencyLevel}`}>
            {BAND_LABELS[data.competencyLevel] ?? data.competencyLevel}
          </span>
        )}
      </div>

      <div className="wa-progress-params">
        {data.parameters.map((p) => {
          const label = PARAM_LABELS[p.parameterId] ?? p.name;
          const pct = Math.round(p.latest * 100);
          const trend = p.scores.length >= 2
            ? p.latest > p.scores[p.scores.length - 2] ? 'up' : p.latest < p.scores[p.scores.length - 2] ? 'down' : 'flat'
            : 'flat';
          return (
            <div key={p.parameterId} className="wa-progress-param">
              <span className="wa-progress-param-label">{label}</span>
              <div className="wa-progress-param-bar">
                <div
                  className="wa-progress-param-fill"
                  style={{
                    width: `${pct}%`,
                    background: p.latest >= 0.6 ? 'var(--wa-green-primary)' : p.latest >= 0.4 ? 'var(--status-warning-text)' : 'var(--status-error-text)',
                  }}
                />
              </div>
              <span className="wa-progress-param-pct">
                {pct}%
                {trend === 'up' && <span className="wa-progress-trend wa-progress-trend--up">&uarr;</span>}
                {trend === 'down' && <span className="wa-progress-trend wa-progress-trend--down">&darr;</span>}
              </span>
            </div>
          );
        })}
      </div>

      {data.checkpoints.length > 0 && (
        <div className="wa-progress-checkpoints">
          {data.checkpoints.map((cp) => (
            <span
              key={cp.key}
              className={`wa-progress-cp ${cp.status === 'PASSED' ? 'wa-progress-cp--passed' : ''}`}
            >
              {cp.key} {cp.status === 'PASSED' ? '\u2713' : '\u2022'}
            </span>
          ))}
        </div>
      )}

      <div className="wa-progress-footer">
        Overall: {Math.round(avgScore * 100)}%
      </div>
    </div>
  );
}
