'use client';

import { useState, useEffect, type JSX } from 'react';
import { Sparkline } from '@/components/shared/Sparkline';

interface LearningScore {
  parameterId: string;
  name: string;
  scores: number[];
  latest: number;
  callDates: string[];
}

interface CheckpointStatus {
  key: string;
  status: string;
  score: number | null;
}

interface TrajectoryData {
  profile: string;
  profileLabel: string;
  competencyLevel: string | null;
  parameters: LearningScore[];
  checkpoints: CheckpointStatus[];
}

const PROFILE_LABELS: Record<string, string> = {
  'comprehension-led': 'Comprehension Skills',
  'discussion-led': 'Discussion Skills',
  'coaching-led': 'Coaching Progress',
};

const PARAM_LABELS: Record<string, string> = {
  COMP_RETRIEVAL: 'Retrieval',
  COMP_INFERENCE: 'Inference',
  COMP_VOCABULARY: 'Vocabulary',
  COMP_LANGUAGE: 'Language',
  COMP_EVALUATION: 'Evaluation',
  COMP_RECALL: 'Recall',
  DISC_PERSPECTIVE: 'Perspective Diversity',
  DISC_ARGUMENT: 'Argument Quality',
  DISC_SHIFT: 'Position Shift',
  DISC_REFLECTION: 'Reflection',
  COACH_CLARITY: 'Goal Clarity',
  COACH_ACTION: 'Action Commitment',
  COACH_AWARENESS: 'Self-Awareness',
  COACH_FOLLOWUP: 'Follow-Through',
};

const BAND_COLORS: Record<string, string> = {
  mastery: 'var(--status-success-text)',
  secure: 'var(--accent-primary)',
  developing: 'var(--status-warning-text)',
  emerging: 'var(--status-error-text)',
  no_evidence: 'var(--text-muted)',
};

export function LearningTrajectoryCard({ callerId }: { callerId: string }): JSX.Element | null {
  const [data, setData] = useState<TrajectoryData | null>(null);
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

  const bandColor = BAND_COLORS[data.competencyLevel ?? 'no_evidence'] ?? 'var(--text-muted)';

  return (
    <div className="hf-card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 className="hf-section-title" style={{ margin: 0 }}>{data.profileLabel}</h3>
        {data.competencyLevel && (
          <span style={{
            fontSize: 12,
            fontWeight: 600,
            padding: '2px 10px',
            borderRadius: 12,
            background: `color-mix(in srgb, ${bandColor} 15%, transparent)`,
            color: bandColor,
            textTransform: 'capitalize',
          }}>
            {data.competencyLevel.replace(/_/g, ' ')}
          </span>
        )}
      </div>

      {/* Parameter sparklines */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px' }}>
        {data.parameters.map((p) => (
          <div key={p.parameterId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 2 }}>
                {PARAM_LABELS[p.parameterId] ?? p.name}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Sparkline
                  history={p.scores}
                  color="var(--accent-primary)"
                  label={PARAM_LABELS[p.parameterId] ?? p.name}
                  historyLabels={p.callDates}
                />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {(p.latest * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Checkpoints */}
      {data.checkpoints.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-default)' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Checkpoints</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {data.checkpoints.map((cp) => (
              <span key={cp.key} style={{
                fontSize: 12,
                padding: '2px 8px',
                borderRadius: 8,
                background: cp.status === 'PASSED'
                  ? 'color-mix(in srgb, var(--status-success-text) 12%, transparent)'
                  : 'var(--surface-secondary)',
                color: cp.status === 'PASSED' ? 'var(--status-success-text)' : 'var(--text-muted)',
              }}>
                {cp.key} {cp.status === 'PASSED' ? '✓' : '○'}
                {cp.score != null && ` ${(cp.score * 100).toFixed(0)}%`}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
