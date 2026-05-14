'use client';

import { useState, useEffect, type JSX } from 'react';
import { BarChart3 } from 'lucide-react';

interface CohortAggregateData {
  profile: string;
  profileLabel: string;
  learnerCount: number;
  /** Pre-survey average confidence (1-5) */
  avgPreConfidence: number | null;
  /** Post-survey average confidence (1-5) */
  avgPostConfidence: number | null;
  /** Competency band distribution */
  bandDistribution: { band: string; count: number; pct: number }[];
  /** Per-parameter averages */
  paramAverages: { parameterId: string; label: string; avg: number }[];
  /** Checkpoint pass rates */
  checkpointRates: { key: string; passRate: number }[];
}

const BAND_COLORS: Record<string, string> = {
  mastery: 'var(--status-success-text)',
  secure: 'var(--accent-primary)',
  developing: 'var(--status-warning-text)',
  emerging: 'var(--status-error-text)',
  no_evidence: 'var(--text-muted)',
};

export function CohortLearningAggregate({ courseId }: { courseId: string }): JSX.Element | null {
  const [data, setData] = useState<CohortAggregateData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/courses/${courseId}/cohort-learning`);
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
  }, [courseId]);

  if (loading || !data || data.learnerCount === 0) return null;

  return (
    <div className="hf-card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <BarChart3 size={16} className="hf-icon-muted" />
        <h3 className="hf-section-title" style={{ margin: 0 }}>{data.profileLabel} — Cohort Overview</h3>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {data.learnerCount} learner{data.learnerCount !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Before/After columns */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 12 }}>
        {/* Before (survey) */}
        <div style={{ padding: 12, borderRadius: 8, background: 'var(--surface-secondary)' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Before (survey)</div>
          {data.avgPreConfidence != null ? (
            <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)' }}>
              {data.avgPreConfidence.toFixed(1)}<span style={{ fontSize: 13, color: 'var(--text-muted)' }}>/5 confidence</span>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No survey data yet</div>
          )}
        </div>

        {/* After (survey + sessions) */}
        <div style={{ padding: 12, borderRadius: 8, background: 'var(--surface-secondary)' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>After (sessions)</div>
          {data.avgPostConfidence != null ? (
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)' }}>
                {data.avgPostConfidence.toFixed(1)}
              </span>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>/5 confidence</span>
              {data.avgPreConfidence != null && (
                <span style={{
                  fontSize: 12,
                  marginLeft: 6,
                  color: data.avgPostConfidence > data.avgPreConfidence ? 'var(--status-success-text)' : 'var(--text-muted)',
                }}>
                  {data.avgPostConfidence > data.avgPreConfidence
                    ? `+${(data.avgPostConfidence - data.avgPreConfidence).toFixed(1)}`
                    : data.avgPostConfidence < data.avgPreConfidence
                      ? `${(data.avgPostConfidence - data.avgPreConfidence).toFixed(1)}`
                      : 'no change'}
                </span>
              )}
            </div>
          ) : null}
          {data.bandDistribution.length > 0 ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {data.bandDistribution.filter(b => b.count > 0).map((b) => (
                <span key={b.band} style={{
                  fontSize: 12,
                  padding: '2px 8px',
                  borderRadius: 8,
                  background: `color-mix(in srgb, ${BAND_COLORS[b.band] ?? 'var(--text-muted)'} 12%, transparent)`,
                  color: BAND_COLORS[b.band] ?? 'var(--text-muted)',
                  textTransform: 'capitalize',
                }}>
                  {b.count} {b.band.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No session scores yet</div>
          )}
        </div>
      </div>

      {/* Parameter averages */}
      {data.paramAverages.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', marginBottom: 12 }}>
          {data.paramAverages.map((p) => (
            <div key={p.parameterId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.label}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{
                  width: 48,
                  height: 4,
                  borderRadius: 2,
                  background: 'var(--border-default)',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${p.avg * 100}%`,
                    height: '100%',
                    borderRadius: 2,
                    background: p.avg >= 0.6 ? 'var(--status-success-text)' : p.avg >= 0.4 ? 'var(--status-warning-text)' : 'var(--status-error-text)',
                  }} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, width: 32, textAlign: 'right' }}>
                  {(p.avg * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Checkpoint pass rates */}
      {data.checkpointRates.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border-default)', paddingTop: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Checkpoint pass rates</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {data.checkpointRates.map((cp) => (
              <span key={cp.key} style={{
                fontSize: 12,
                color: cp.passRate >= 0.7 ? 'var(--status-success-text)' : cp.passRate >= 0.4 ? 'var(--status-warning-text)' : 'var(--text-muted)',
              }}>
                {cp.key}: {(cp.passRate * 100).toFixed(0)}%
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
