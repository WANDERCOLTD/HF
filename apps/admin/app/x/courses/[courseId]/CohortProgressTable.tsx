'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import './cohort-progress.css';

// ── Types ──────────────────────────────────────────────

type StudentRow = {
  callerId: string;
  name: string | null;
  email: string | null;
  avgMastery: number | null;
  delta: number | null;        // confidence delta
  knowledgeDelta: number | null;
  callCount: number;
  lastCallAt: string | null;
};

type SortKey = 'name' | 'mastery' | 'confDelta' | 'knowDelta' | 'calls' | 'lastCall' | 'momentum';

type Props = {
  students: StudentRow[];
};

// ── Helpers ────────────────────────────────────────────

function relativeDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 30) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function daysSince(iso: string | null): number {
  if (!iso) return Infinity;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

function momentum(lastCallAt: string | null, callCount: number): { label: string; cls: string } {
  if (callCount === 0) return { label: '—', cls: 'cp-momentum--new' };
  const days = daysSince(lastCallAt);
  if (days <= 3) return { label: 'Active', cls: 'cp-momentum--accelerating' };
  if (days <= 7) return { label: 'Steady', cls: 'cp-momentum--steady' };
  if (days <= 14) return { label: 'Fading', cls: 'cp-momentum--slowing' };
  return { label: 'Inactive', cls: 'cp-momentum--inactive' };
}

function formatDelta(value: number | null, suffix = ''): React.ReactElement {
  if (value == null) return <span className="cp-delta--neutral">—</span>;
  const cls = value > 0 ? 'cp-delta--positive' : value < 0 ? 'cp-delta--negative' : 'cp-delta--neutral';
  const sign = value > 0 ? '+' : '';
  return <span className={cls}>{sign}{value.toFixed(1)}{suffix}</span>;
}

// ── Component ──────────────────────────────────────────

export function CohortProgressTable({ students }: Props): React.ReactElement {
  const [sortKey, setSortKey] = useState<SortKey>('mastery');
  const [sortAsc, setSortAsc] = useState(false);

  const handleSort = (key: SortKey): void => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === 'name'); // name asc by default, others desc
    }
  };

  const sorted = useMemo(() => {
    const rows = [...students];
    const dir = sortAsc ? 1 : -1;

    rows.sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return dir * (a.name ?? '').localeCompare(b.name ?? '');
        case 'mastery':
          return dir * ((a.avgMastery ?? -1) - (b.avgMastery ?? -1));
        case 'confDelta':
          return dir * ((a.delta ?? -999) - (b.delta ?? -999));
        case 'knowDelta':
          return dir * ((a.knowledgeDelta ?? -999) - (b.knowledgeDelta ?? -999));
        case 'calls':
          return dir * (a.callCount - b.callCount);
        case 'lastCall':
          return dir * (daysSince(b.lastCallAt) - daysSince(a.lastCallAt));
        case 'momentum': {
          const aDays = daysSince(a.lastCallAt);
          const bDays = daysSince(b.lastCallAt);
          return dir * (bDays - aDays);
        }
        default:
          return 0;
      }
    });

    return rows;
  }, [students, sortKey, sortAsc]);

  const sortArrow = (key: SortKey): string => {
    if (sortKey !== key) return '';
    return sortAsc ? ' ▲' : ' ▼';
  };

  const thClass = (key: SortKey): string =>
    sortKey === key ? 'cp-sorted' : '';

  if (students.length === 0) {
    return (
      <div className="hf-empty-state">
        <div className="hf-empty-state-icon">👥</div>
        <div className="hf-empty-state-title">No learner progress yet</div>
        <div className="hf-empty-state-desc">
          Progress data will appear as learners complete calls and surveys.
        </div>
      </div>
    );
  }

  return (
    <div className="hf-card cp-table-wrap">
      <table className="cp-table">
        <thead>
          <tr>
            <th className={thClass('name')} onClick={() => handleSort('name')}>
              Name<span className="cp-sort-arrow">{sortArrow('name')}</span>
            </th>
            <th className={thClass('mastery')} onClick={() => handleSort('mastery')}>
              Mastery<span className="cp-sort-arrow">{sortArrow('mastery')}</span>
            </th>
            <th className={thClass('confDelta')} onClick={() => handleSort('confDelta')}>
              Conf Δ<span className="cp-sort-arrow">{sortArrow('confDelta')}</span>
            </th>
            <th className={thClass('knowDelta')} onClick={() => handleSort('knowDelta')}>
              Know Δ<span className="cp-sort-arrow">{sortArrow('knowDelta')}</span>
            </th>
            <th className={thClass('calls')} onClick={() => handleSort('calls')}>
              Calls<span className="cp-sort-arrow">{sortArrow('calls')}</span>
            </th>
            <th className={thClass('lastCall')} onClick={() => handleSort('lastCall')}>
              Last Call<span className="cp-sort-arrow">{sortArrow('lastCall')}</span>
            </th>
            <th className={thClass('momentum')} onClick={() => handleSort('momentum')}>
              Momentum<span className="cp-sort-arrow">{sortArrow('momentum')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((s) => {
            const mom = momentum(s.lastCallAt, s.callCount);
            const masteryPct = s.avgMastery != null ? Math.round(s.avgMastery * 100) : 0;
            return (
              <tr key={s.callerId}>
                <td>
                  <div className="cp-name-cell">
                    <Link href={`/x/callers/${s.callerId}?tab=uplift`} className="cp-name-link">
                      {s.name || 'Unnamed'}
                    </Link>
                    {s.email && <span className="cp-email">{s.email}</span>}
                  </div>
                </td>
                <td>
                  <div className="cp-mastery-bar">
                    <div className="cp-mastery-track">
                      <div className="cp-mastery-fill" style={{ width: `${masteryPct}%` }} />
                    </div>
                    <span className="cp-mastery-pct">{masteryPct}%</span>
                  </div>
                </td>
                <td>{formatDelta(s.delta)}</td>
                <td>{formatDelta(s.knowledgeDelta != null ? Math.round(s.knowledgeDelta * 100) : null, 'pp')}</td>
                <td>{s.callCount}</td>
                <td>{relativeDate(s.lastCallAt)}</td>
                <td><span className={`cp-momentum ${mom.cls}`}>{mom.label}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
