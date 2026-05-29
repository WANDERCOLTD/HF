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

interface SkillsTrajectory {
  kind: 'skills';
  profile: string;
  profileLabel: string;
  competencyLevel: string | null;
  parameters: LearningScore[];
  checkpoints: CheckpointStatus[];
}

interface ModuleLearningOutcome {
  loRef: string;
  mastery: number;
  updatedAt: string;
}

interface ModuleProgressView {
  moduleId: string;
  slug: string | null;
  label: string;
  status: string;
  mastery: number;
  callCount: number;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  learningOutcomes: ModuleLearningOutcome[];
}

interface ModuleMasteryTrajectory {
  kind: 'module-mastery';
  playbookId: string;
  playbookName: string | null;
  modules: ModuleProgressView[];
}

type TrajectoryData = SkillsTrajectory | ModuleMasteryTrajectory;

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

// #953 — map module status to badge color. Mirrors BAND_COLORS so the two
// trajectory kinds feel consistent in the same card slot.
const MODULE_STATUS_COLORS: Record<string, string> = {
  COMPLETED: 'var(--status-success-text)',
  IN_PROGRESS: 'var(--accent-primary)',
  NOT_STARTED: 'var(--text-muted)',
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

  if (loading || !data) return null;

  // ── #953 module-mastery variant ──────────────────────────────────────────
  if (data.kind === 'module-mastery') {
    if (data.modules.length === 0) return null;
    return <ModuleMasteryView data={data} />;
  }

  // ── Skills variant (existing) ────────────────────────────────────────────
  if (data.parameters.length === 0) return null;

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

// #953 — Module-mastery variant. Surfaced for courses whose authored
// module catalogue drives scoring (IELTS Speaking, language exam prep)
// where the skills-trajectory parameter prefix never matches.
function ModuleMasteryView({ data }: { data: ModuleMasteryTrajectory }): JSX.Element {
  return (
    <div className="hf-card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 className="hf-section-title" style={{ margin: 0 }}>Module Mastery</h3>
        {data.playbookName && (
          <span className="hf-text-xs hf-text-muted" style={{ fontWeight: 500 }}>
            {data.playbookName}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {data.modules.map((m) => {
          const statusColor = MODULE_STATUS_COLORS[m.status] ?? 'var(--text-muted)';
          const masteryPct = Math.round(m.mastery * 100);
          return (
            <div key={m.moduleId} style={{
              padding: '10px 12px',
              border: '1px solid var(--border-default)',
              borderRadius: 10,
              background: 'var(--surface-secondary)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {m.label}
                  </span>
                  <span className="hf-text-xs hf-text-muted">
                    {m.callCount} call{m.callCount === 1 ? '' : 's'}
                  </span>
                </div>
                <span style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 10,
                  background: `color-mix(in srgb, ${statusColor} 15%, transparent)`,
                  color: statusColor,
                  textTransform: 'capitalize',
                }}>
                  {m.status.replace(/_/g, ' ').toLowerCase()}
                </span>
              </div>

              {/* Mastery progress bar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  flex: 1,
                  height: 8,
                  borderRadius: 4,
                  background: 'var(--border-default)',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${masteryPct}%`,
                    height: '100%',
                    background: statusColor,
                    transition: 'width 200ms ease-out',
                  }} />
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', minWidth: 38, textAlign: 'right' }}>
                  {masteryPct}%
                </span>
              </div>

              {/* LO sub-list when present */}
              {m.learningOutcomes.length > 0 && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border-default)' }}>
                  <div className="hf-text-xs hf-text-muted" style={{ marginBottom: 4 }}>
                    Learning outcomes
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {m.learningOutcomes.map((lo) => {
                      const loPct = Math.round(lo.mastery * 100);
                      const loColor = lo.mastery >= 0.7
                        ? 'var(--status-success-text)'
                        : lo.mastery > 0
                          ? 'var(--accent-primary)'
                          : 'var(--text-muted)';
                      return (
                        <span key={lo.loRef} style={{
                          fontSize: 11,
                          padding: '2px 8px',
                          borderRadius: 8,
                          background: `color-mix(in srgb, ${loColor} 12%, transparent)`,
                          color: loColor,
                          fontWeight: 500,
                        }}>
                          {lo.loRef} {loPct}%
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
