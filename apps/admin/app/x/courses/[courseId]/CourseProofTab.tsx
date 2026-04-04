'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp, Users2, Phone, Star, BookOpen,
  Download, RefreshCw, CheckCircle2, Clock,
} from 'lucide-react';
import './course-proof.css';

// ── Types ──────────────────────────────────────────────

type StudentRow = {
  name: string | null;
  email: string | null;
  preConfidence: number | null;
  postConfidence: number | null;
  delta: number | null;
  callCount: number;
  nps: number | null;
  satisfaction: number | null;
  preSurveyDone: boolean;
  postSurveyDone: boolean;
  avgMastery: number | null;
  modulesCompleted: number;
  modulesTotal: number;
};

type ModuleAggregate = {
  moduleId: string;
  slug: string;
  title: string;
  sortOrder: number;
  avgMastery: number;
  completionRate: number;
  learnerCount: number;
};

type MasteryOverview = {
  modules: ModuleAggregate[];
  avgMastery: number | null;
  completionRate: number | null;
  learnersWithProgress: number;
};

type ConfidenceLift = {
  avgPre: number | null;
  avgPost: number | null;
  meanDelta: number | null;
  stdDev: number | null;
  sigma: number | null;
  n: number;
};

type Engagement = {
  totalCallers: number;
  activeCallers: number;
  avgCallsPerStudent: number;
  totalCalls: number;
};

type Satisfaction = {
  avgNps: number | null;
  avgSatisfaction: number | null;
  surveyCount: number;
};

type ProofData = {
  confidenceLift: ConfidenceLift;
  engagement: Engagement;
  satisfaction: Satisfaction;
  mastery: MasteryOverview;
  students: StudentRow[];
};

type Props = {
  courseId: string;
};

// ── Helpers ────────────────────────────────────────────

function formatNum(v: number | null, decimals = 1): string {
  if (v == null) return '—';
  return v.toFixed(decimals);
}

function sigmaColor(sigma: number | null): string {
  if (sigma == null) return '';
  if (sigma >= 2) return 'cp-sigma--great';
  if (sigma >= 1) return 'cp-sigma--good';
  return 'cp-sigma--early';
}

function barWidth(value: number | null, max: number): string {
  if (value == null || max === 0) return '0%';
  return `${Math.min((value / max) * 100, 100)}%`;
}

function surveyBadge(done: boolean): { label: string; className: string } {
  return done
    ? { label: 'Done', className: 'cp-survey-badge cp-survey-badge--done' }
    : { label: 'Pending', className: 'cp-survey-badge cp-survey-badge--pending' };
}

// ── Component ──────────────────────────────────────────

export function CourseProofTab({ courseId }: Props): React.ReactElement {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ProofData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'name' | 'delta' | 'calls' | 'nps' | 'mastery'>('name');
  const [sortAsc, setSortAsc] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(`/api/courses/${courseId}/proof-points`);
      const json = await res.json();
      if (json.ok) {
        setData(json);
      } else {
        setError(json.error || 'Failed to load');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleExport = useCallback(() => {
    window.open(`/api/courses/${courseId}/proof-points?format=csv`, '_blank');
  }, [courseId]);

  const handleSort = useCallback((col: typeof sortBy) => {
    if (sortBy === col) {
      setSortAsc((prev) => !prev);
    } else {
      setSortBy(col);
      setSortAsc(col === 'name');
    }
  }, [sortBy]);

  // Sort students
  const sortedStudents = data?.students ? [...data.students].sort((a, b) => {
    const dir = sortAsc ? 1 : -1;
    switch (sortBy) {
      case 'name': return dir * (a.name ?? '').localeCompare(b.name ?? '');
      case 'delta': return dir * ((a.delta ?? -999) - (b.delta ?? -999));
      case 'calls': return dir * (a.callCount - b.callCount);
      case 'nps': return dir * ((a.nps ?? -999) - (b.nps ?? -999));
      case 'mastery': return dir * ((a.avgMastery ?? -1) - (b.avgMastery ?? -1));
      default: return 0;
    }
  }) : [];

  // ── Render ──

  if (loading) {
    return (
      <div className="hf-empty">
        <div className="hf-spinner" style={{ width: 28, height: 28 }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="hf-empty">
        <p>{error}</p>
        <button className="hf-btn hf-btn-sm" onClick={fetchData}>Retry</button>
      </div>
    );
  }

  if (!data || data.students.length === 0) {
    return (
      <div className="hf-empty">
        No learner data yet. Enrol students and wait for them to complete surveys and practice sessions.
      </div>
    );
  }

  const { confidenceLift, engagement, satisfaction, mastery } = data;

  return (
    <div className="cp-container">
      {/* ── Confidence Lift ── */}
      <div className="hf-card cp-section">
        <div className="cp-section-header">
          <TrendingUp size={16} />
          <span>Confidence Lift</span>
          {confidenceLift.n > 0 && (
            <span className="cp-n">n = {confidenceLift.n}</span>
          )}
        </div>

        {confidenceLift.n === 0 ? (
          <div className="cp-awaiting">
            <Clock size={14} />
            Awaiting pre + post survey completions to calculate lift
          </div>
        ) : (
          <div className="cp-lift">
            <div className="cp-bar-group">
              <div className="cp-bar-row">
                <span className="cp-bar-label">Pre</span>
                <div className="cp-bar-track">
                  <div className="cp-bar cp-bar--pre" style={{ width: barWidth(confidenceLift.avgPre, 5) }} />
                </div>
                <span className="cp-bar-value">{formatNum(confidenceLift.avgPre)} / 5</span>
              </div>
              <div className="cp-bar-row">
                <span className="cp-bar-label">Post</span>
                <div className="cp-bar-track">
                  <div className="cp-bar cp-bar--post" style={{ width: barWidth(confidenceLift.avgPost, 5) }} />
                </div>
                <span className="cp-bar-value">{formatNum(confidenceLift.avgPost)} / 5</span>
              </div>
            </div>
            <div className="cp-sigma-card">
              <div className={`cp-sigma-value ${sigmaColor(confidenceLift.sigma)}`}>
                {confidenceLift.sigma != null ? `${formatNum(confidenceLift.sigma)}σ` : '—'}
              </div>
              <div className="cp-sigma-detail">
                Delta: +{formatNum(confidenceLift.meanDelta)}
                {confidenceLift.stdDev != null && ` (SD ${formatNum(confidenceLift.stdDev)})`}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Summary Cards ── */}
      <div className="cp-stats">
        <div className="hf-card-compact cp-stat">
          <Phone size={16} className="cp-stat-icon" />
          <div className="cp-stat-value">{formatNum(engagement.avgCallsPerStudent)}</div>
          <div className="cp-stat-label">Avg Calls</div>
        </div>
        <div className="hf-card-compact cp-stat">
          <Users2 size={16} className="cp-stat-icon" />
          <div className="cp-stat-value">{engagement.activeCallers}/{engagement.totalCallers}</div>
          <div className="cp-stat-label">Active</div>
        </div>
        <div className="hf-card-compact cp-stat">
          <Star size={16} className="cp-stat-icon" />
          <div className="cp-stat-value">{satisfaction.avgNps != null ? `+${satisfaction.avgNps}` : '—'}</div>
          <div className="cp-stat-label">NPS</div>
        </div>
        <div className="hf-card-compact cp-stat">
          <Star size={16} className="cp-stat-icon" />
          <div className="cp-stat-value">{satisfaction.avgSatisfaction != null ? `${formatNum(satisfaction.avgSatisfaction)}/5` : '—'}</div>
          <div className="cp-stat-label">Satisfaction</div>
        </div>
      </div>

      {/* ── Pipeline Mastery ── */}
      <div className="hf-card cp-section">
        <div className="cp-section-header">
          <BookOpen size={16} />
          <span>Pipeline Mastery</span>
          {mastery.learnersWithProgress > 0 && (
            <span className="cp-n">{mastery.learnersWithProgress} learner{mastery.learnersWithProgress !== 1 ? 's' : ''} with progress</span>
          )}
        </div>

        {mastery.modules.length === 0 ? (
          <div className="cp-awaiting">
            <Clock size={14} />
            No curriculum modules found for this course
          </div>
        ) : mastery.learnersWithProgress === 0 ? (
          <div className="cp-awaiting">
            <Clock size={14} />
            Awaiting session completions to track mastery
          </div>
        ) : (
          <>
            <div className="cp-mastery-summary">
              <div className="hf-card-compact cp-stat">
                <div className="cp-stat-value">{mastery.avgMastery != null ? `${Math.round(mastery.avgMastery * 100)}%` : '—'}</div>
                <div className="cp-stat-label">Avg Mastery</div>
              </div>
              <div className="hf-card-compact cp-stat">
                <div className="cp-stat-value">{mastery.completionRate != null ? `${Math.round(mastery.completionRate * 100)}%` : '—'}</div>
                <div className="cp-stat-label">Completion</div>
              </div>
            </div>
            <div className="cp-module-bars">
              {mastery.modules.map((mod) => (
                <div key={mod.moduleId} className="cp-module-row">
                  <span className="cp-module-label" title={mod.title}>{mod.title}</span>
                  <div className="cp-bar-track">
                    <div className="cp-bar cp-bar--mastery" style={{ width: `${Math.round(mod.avgMastery * 100)}%` }} />
                  </div>
                  <span className="cp-module-pct">{Math.round(mod.avgMastery * 100)}%</span>
                  <span className="cp-module-completion">{Math.round(mod.completionRate * 100)}% done</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Per Student Table ── */}
      <div className="hf-card cp-section">
        <div className="cp-table-header">
          <span className="cp-table-count">
            {data.students.length} student{data.students.length !== 1 ? 's' : ''}
          </span>
          <div className="cp-table-actions">
            <button className="hf-btn hf-btn-xs" onClick={fetchData} title="Refresh">
              <RefreshCw size={12} />
            </button>
            <button className="hf-btn hf-btn-xs" onClick={handleExport} title="Export CSV">
              <Download size={12} />
              Export CSV
            </button>
          </div>
        </div>

        <table className="cp-table">
          <thead>
            <tr>
              <th className="cp-sortable" onClick={() => handleSort('name')}>
                Name {sortBy === 'name' && (sortAsc ? '↑' : '↓')}
              </th>
              <th>Pre</th>
              <th>Post</th>
              <th className="cp-sortable" onClick={() => handleSort('delta')}>
                Delta {sortBy === 'delta' && (sortAsc ? '↑' : '↓')}
              </th>
              <th className="cp-sortable" onClick={() => handleSort('calls')}>
                Calls {sortBy === 'calls' && (sortAsc ? '↑' : '↓')}
              </th>
              <th className="cp-sortable" onClick={() => handleSort('mastery')}>
                Mastery {sortBy === 'mastery' && (sortAsc ? '↑' : '↓')}
              </th>
              <th>Modules</th>
              <th className="cp-sortable" onClick={() => handleSort('nps')}>
                NPS {sortBy === 'nps' && (sortAsc ? '↑' : '↓')}
              </th>
              <th>Satis.</th>
              <th>Surveys</th>
            </tr>
          </thead>
          <tbody>
            {sortedStudents.map((s, i) => {
              const pre = surveyBadge(s.preSurveyDone);
              const post = surveyBadge(s.postSurveyDone);
              return (
                <tr key={i} className="cp-row">
                  <td>
                    <div className="cp-student-name">{s.name || 'Unnamed'}</div>
                    {s.email && <div className="cp-student-email">{s.email}</div>}
                  </td>
                  <td>{formatNum(s.preConfidence, 0)}</td>
                  <td>{formatNum(s.postConfidence, 0)}</td>
                  <td>
                    {s.delta != null ? (
                      <span className={s.delta > 0 ? 'cp-delta--positive' : s.delta < 0 ? 'cp-delta--negative' : ''}>
                        {s.delta > 0 ? '+' : ''}{s.delta}
                      </span>
                    ) : '—'}
                  </td>
                  <td>{s.callCount}</td>
                  <td>
                    {s.avgMastery != null ? (
                      <span className={s.avgMastery >= 0.8 ? 'cp-delta--positive' : ''}>
                        {Math.round(s.avgMastery * 100)}%
                      </span>
                    ) : '—'}
                  </td>
                  <td>{s.modulesTotal > 0 ? `${s.modulesCompleted}/${s.modulesTotal}` : '—'}</td>
                  <td>{s.nps != null ? s.nps : '—'}</td>
                  <td>{s.satisfaction != null ? `${s.satisfaction}/5` : '—'}</td>
                  <td className="cp-survey-cell">
                    <span className={pre.className} title="Pre-survey">
                      {s.preSurveyDone && <CheckCircle2 size={10} />}
                      Pre
                    </span>
                    <span className={post.className} title="Post-survey">
                      {s.postSurveyDone && <CheckCircle2 size={10} />}
                      Post
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
