'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import {
  BookMarked, AlertTriangle, Zap,
} from 'lucide-react';
import { TeachMethodStats } from '@/components/shared/TeachMethodStats';
import { getDocTypeInfo } from '@/lib/doc-type-icons';

// ── Types ──────────────────────────────────────────────

type SourceDetail = {
  id: string;
  name: string;
  documentType: string;
  assertionCount: number;
  linkedSourceId: string | null;
  linkedSourceName: string | null;
};

type SubjectSummary = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  defaultTrustLevel: string;
  teachingProfile: string | null;
  sourceCount: number;
  curriculumCount: number;
  assertionCount: number;
  sources?: SourceDetail[];
};

type MethodBreakdown = { teachMethod: string; count: number; reviewed: number };

export type CourseWhatTabProps = {
  courseId: string;
  detail: {
    id: string;
    name: string;
    config?: Record<string, unknown> | null;
    domain: { id: string; name: string; slug: string };
  };
  subjects: SubjectSummary[];
  contentMethods: MethodBreakdown[];
  contentTotal: number;
  isOperator: boolean;
  onContentRefresh?: (methods: MethodBreakdown[], total: number, instructionCount?: number) => void;
};

import { SectionHeader } from './SectionHeader';

// ── Main Component ─────────────────────────────────────

// ── Teaching Points Inventory ─────────────────────────
// Fetches all assertions for the course, grouped by module/LO.
// Read-only — editing happens in session detail pages.

const CATEGORY_COLORS: Record<string, string> = {
  fact: 'var(--accent-primary)',
  definition: 'var(--badge-purple-text)',
  rule: 'var(--status-warning-text)',
  process: 'var(--badge-cyan-text)',
  example: 'var(--status-success-text)',
  threshold: 'var(--status-error-text)',
};

type TPData = {
  id: string;
  assertion: string;
  category: string;
  teachMethod: string | null;
  learningOutcomeRef: string | null;
  sourceName: string;
  session?: number | null;
};

function TeachingPointsInventory({ courseId, subjects }: { courseId: string; subjects: SubjectSummary[] }) {
  const [tps, setTps] = useState<TPData[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Only fetch when expanded
  useEffect(() => {
    if (!expanded || tps.length > 0) return;
    setLoading(true);
    fetch(`/api/courses/${courseId}/assertions?limit=500`)
      .then((r) => r.json())
      .then((res) => {
        if (res.ok && Array.isArray(res.assertions)) {
          setTps(res.assertions);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [expanded, courseId, tps.length]);

  const totalCount = subjects.reduce((sum, s) => sum + s.assertionCount, 0);
  if (totalCount === 0) return null;

  // Group by learningOutcomeRef
  const grouped = useMemo(() => {
    const groups = new Map<string, TPData[]>();
    for (const tp of tps) {
      const key = tp.learningOutcomeRef || 'Unassigned';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(tp);
    }
    return groups;
  }, [tps]);

  return (
    <div className="hf-mb-lg">
      <button
        onClick={() => setExpanded(!expanded)}
        className="hf-btn-reset hf-flex hf-items-center hf-gap-sm hf-w-full hf-section-divider hf-mb-sm"
        style={{ cursor: 'pointer' }}
      >
        <BookMarked size={16} className="hf-text-muted" />
        <span className="hf-text-xs hf-text-bold hf-text-muted hf-uppercase hf-flex-1" style={{ textAlign: 'left' }}>
          Teaching Points ({totalCount})
        </span>
        <span className="hf-text-xs hf-text-placeholder">{expanded ? '▼' : '▶'}</span>
      </button>

      {expanded && (
        loading ? (
          <div className="hf-text-xs hf-text-muted hf-p-sm">Loading teaching points...</div>
        ) : tps.length === 0 ? (
          <div className="hf-text-xs hf-text-muted hf-p-sm">No assertions loaded</div>
        ) : (
          <div className="hf-flex-col hf-gap-sm" style={{ maxHeight: 400, overflowY: 'auto' }}>
            {Array.from(grouped.entries()).map(([loRef, items]) => (
              <div key={loRef}>
                <div className="hf-text-xs hf-text-bold hf-text-muted hf-mb-xs" style={{ paddingLeft: 4 }}>
                  {loRef}
                  <span className="hf-text-placeholder hf-ml-sm">({items.length})</span>
                </div>
                {items.map((tp) => (
                  <div
                    key={tp.id}
                    className="hf-flex hf-items-start hf-gap-xs hf-text-xs"
                    style={{ padding: '3px 4px', lineHeight: 1.5 }}
                  >
                    <span
                      className="hf-micro-badge-sm hf-flex-shrink-0"
                      style={{
                        background: CATEGORY_COLORS[tp.category] || 'var(--text-muted)',
                        color: 'white',
                        fontSize: 9,
                        padding: '1px 4px',
                        borderRadius: 3,
                        marginTop: 2,
                      }}
                    >
                      {tp.category}
                    </span>
                    <span className="hf-flex-1 hf-text-secondary">{tp.assertion}</span>
                    <span className="hf-text-placeholder hf-flex-shrink-0">[{tp.sourceName}]</span>
                    {tp.session != null && (
                      <span className="hf-micro-badge-sm hf-flex-shrink-0" style={{ background: 'var(--surface-secondary)', fontSize: 9 }}>
                        S{tp.session}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

export function CourseWhatTab({
  courseId,
  detail,
  subjects,
  contentMethods,
  contentTotal,
  isOperator,
  onContentRefresh,
}: CourseWhatTabProps) {
  // ── Backfill state ────────────────────────────────────
  const [backfilling, setBackfilling] = useState(false);

  // ── Collect sources across all subjects ──
  const { courseGuideSources, otherSources } = useMemo(() => {
    const seen = new Set<string>();
    const guides: SourceDetail[] = [];
    const others: SourceDetail[] = [];
    for (const sub of subjects) {
      for (const src of sub.sources || []) {
        if (seen.has(src.id)) continue;
        seen.add(src.id);
        if (src.documentType === 'COURSE_REFERENCE') {
          guides.push(src);
        } else {
          others.push(src);
        }
      }
    }
    return { courseGuideSources: guides, otherSources: others };
  }, [subjects]);

  return (
    <>
      {/* ── Course Guide ──────────────────────────────── */}
      {courseGuideSources.length > 0 && (
        <>
          <SectionHeader title="Course Guide" icon={getDocTypeInfo('COURSE_REFERENCE').icon} />
          <div className="hf-card-compact hf-mb-lg" style={{ borderLeft: '3px solid var(--badge-purple-text)' }}>
            {courseGuideSources.map((src) => {
              const info = getDocTypeInfo(src.documentType);
              const Icon = info.icon;
              return (
                <Link key={src.id} href={`/x/content-sources/${src.id}`} className="hf-flex hf-items-center hf-gap-sm hf-link-row">
                  <Icon size={16} style={{ color: info.color, flexShrink: 0 }} />
                  <div className="hf-flex-1">
                    <div className="hf-text-sm hf-text-secondary">{src.name}</div>
                    <div className="hf-text-xs hf-text-muted">
                      Defines your teaching approach, skills framework, and session flow
                    </div>
                  </div>
                  <span className="hf-badge hf-badge-sm" style={{ color: info.color, borderColor: info.color }}>
                    {info.label}
                  </span>
                  <span className="hf-text-xs hf-text-placeholder">{src.assertionCount} rules</span>
                </Link>
              );
            })}
          </div>
        </>
      )}

      {/* ── Other Sources ────────────────────────────── */}
      {otherSources.length > 0 && (
        <>
          <SectionHeader title="Sources" icon={BookMarked} />
          <div className="hf-card-compact hf-mb-lg">
            {otherSources.map((src) => {
              const info = getDocTypeInfo(src.documentType);
              const Icon = info.icon;
              return (
                <Link key={src.id} href={`/x/content-sources/${src.id}`} className="hf-flex hf-items-center hf-gap-sm hf-link-row">
                  <Icon size={16} style={{ color: info.color, flexShrink: 0 }} />
                  <div className="hf-flex-1">
                    <div className="hf-text-sm hf-text-secondary">{src.name}</div>
                  </div>
                  <span className="hf-badge hf-badge-sm" style={{ color: info.color, borderColor: info.color }}>
                    {info.label}
                  </span>
                  {src.assertionCount > 0 && (
                    <span className="hf-text-xs hf-text-placeholder">{src.assertionCount} rules</span>
                  )}
                </Link>
              );
            })}
          </div>
        </>
      )}

      {/* ── Teaching Points Inventory ─────────────────── */}
      <TeachingPointsInventory courseId={courseId} subjects={subjects} />

      {/* ── Teaching Methods ──────────────────────────── */}
      {contentMethods.length > 0 && (() => {
        const unassigned = contentMethods.find((m) => m.teachMethod === 'unassigned');
        const unassignedCount = unassigned?.count ?? 0;
        const allUnassigned = unassignedCount === contentTotal;

        return (
          <div className="hf-mb-lg">
            <div className="hf-text-xs hf-text-bold hf-text-muted hf-uppercase hf-mb-sm">
              Teaching Methods
            </div>

            {/* Alert banner when TPs need assignment */}
            {isOperator && unassignedCount > 0 && (
              <div className={`hf-banner ${allUnassigned ? 'hf-banner-warning' : 'hf-banner-info'} hf-mb-sm`}>
                <div className="hf-flex hf-items-center hf-gap-sm hf-flex-1">
                  <AlertTriangle size={14} className="hf-flex-shrink-0" />
                  <span className="hf-text-sm">
                    {allUnassigned
                      ? `All ${unassignedCount} teaching points need a method assigned`
                      : `${unassignedCount} teaching point${unassignedCount === 1 ? '' : 's'} not yet assigned a method`
                    }
                  </span>
                </div>
                <button
                  className="hf-btn hf-btn-xs hf-btn-primary hf-flex hf-items-center hf-gap-xs"
                  disabled={backfilling}
                  title="Auto-assign teaching methods based on content categories"
                  onClick={async () => {
                    setBackfilling(true);
                    try {
                      const res = await fetch(`/api/courses/${courseId}/backfill-teach-methods`, { method: 'POST' });
                      const data = await res.json();
                      if (data.ok && data.updated > 0 && onContentRefresh) {
                        const bd = await fetch(`/api/courses/${courseId}/content-breakdown?bySubject=true`).then(r => r.json());
                        if (bd.ok) {
                          onContentRefresh(bd.methods || [], bd.total || 0, bd.instructionCount || 0);
                        }
                      }
                    } catch { /* ignore */ }
                    setBackfilling(false);
                  }}
                >
                  <Zap size={12} />
                  {backfilling ? 'Assigning\u2026' : 'Auto-assign'}
                </button>
              </div>
            )}

            <TeachMethodStats methods={contentMethods} total={contentTotal} />
          </div>
        );
      })()}

    </>
  );
}
