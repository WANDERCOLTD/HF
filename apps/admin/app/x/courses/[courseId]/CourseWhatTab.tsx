'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  BookMarked, AlertTriangle, Zap, RefreshCw,
} from 'lucide-react';
import { TeachMethodStats } from '@/components/shared/TeachMethodStats';
import { getDocTypeInfo } from '@/lib/doc-type-icons';
import { CONTENT_CATEGORIES, CATEGORY_ORDER } from '@/lib/content-categories';
import { INSTRUCTION_CATEGORIES } from '@/lib/content-trust/resolve-config';
import { ReExtractModal } from './ReExtractModal';

// ── Types ──────────────────────────────────────────────

type SourceDetail = {
  id: string;
  name: string;
  documentType: string;
  extractorVersion: number | null;
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
  instructionCount?: number;
  unassignedContentCount?: number;
  categoryCounts?: Record<string, number>;
  isOperator: boolean;
  onContentRefresh?: (methods: MethodBreakdown[], total: number, instructionCount?: number, unassignedContentCount?: number) => void;
};

import { SectionHeader } from './SectionHeader';

// ── Main Component ─────────────────────────────────────

// ── Teaching Points Inventory ─────────────────────────
// Fetches all assertions for the course, grouped by module/LO.
// Read-only — editing happens in session detail pages.

import { AssertionDetailDrawer } from '@/components/shared/AssertionDetailDrawer';
import { getCategoryStyle } from '@/lib/content-categories';

type TPData = {
  id: string;
  assertion: string;
  category: string;
  teachMethod: string | null;
  learningOutcomeRef: string | null;
  sourceName: string;
  session?: number | null;
};

const INSTRUCTION_SET = new Set<string>(INSTRUCTION_CATEGORIES);

function AssertionList({ items, drawerAssertionId, onSelect }: {
  items: TPData[];
  drawerAssertionId: string | null;
  onSelect: (id: string) => void;
}) {
  // Group by learningOutcomeRef
  const grouped = useMemo(() => {
    const groups = new Map<string, TPData[]>();
    for (const tp of items) {
      const key = tp.learningOutcomeRef || 'Unassigned';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(tp);
    }
    return groups;
  }, [items]);

  return (
    <div className="hf-flex-col hf-gap-sm" style={{ maxHeight: 400, overflowY: 'auto' }}>
      {Array.from(grouped.entries()).map(([loRef, groupItems]) => (
        <div key={loRef}>
          <div className="hf-text-xs hf-text-bold hf-text-muted hf-mb-xs" style={{ paddingLeft: 4 }}>
            {loRef}
            <span className="hf-text-placeholder hf-ml-sm">({groupItems.length})</span>
          </div>
          {groupItems.map((tp) => {
            const cs = getCategoryStyle(tp.category);
            return (
              <button
                key={tp.id}
                type="button"
                className={`hf-btn-reset hf-flex hf-items-start hf-gap-xs hf-text-xs cwt-tp-row${drawerAssertionId === tp.id ? ' cwt-tp-row-active' : ''}`}
                onClick={() => onSelect(tp.id)}
              >
                <span
                  className="hf-micro-badge-sm hf-flex-shrink-0 cwt-tp-cat"
                  style={{ background: cs.color }}
                >
                  {tp.category}
                </span>
                <span className="hf-flex-1 hf-text-secondary hf-text-left">{tp.assertion}</span>
                <span className="hf-text-placeholder hf-flex-shrink-0">[{tp.sourceName}]</span>
                {tp.session != null && (
                  <span className="hf-micro-badge-sm hf-flex-shrink-0 cwt-tp-session">
                    S{tp.session}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function TeachingPointsInventory({ courseId, subjects }: { courseId: string; subjects: SubjectSummary[] }) {
  const [allItems, setAllItems] = useState<TPData[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedTP, setExpandedTP] = useState(false);
  const [expandedTI, setExpandedTI] = useState(false);
  const [drawerAssertionId, setDrawerAssertionId] = useState<string | null>(null);

  const fetched = expandedTP || expandedTI;

  // Arrow key navigation when drawer is open
  const handleKeyNav = useCallback((e: KeyboardEvent) => {
    if (!drawerAssertionId || allItems.length === 0) return;
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const idx = allItems.findIndex((tp) => tp.id === drawerAssertionId);
    const next = e.key === 'ArrowDown'
      ? Math.min(idx + 1, allItems.length - 1)
      : Math.max(idx - 1, 0);
    if (next !== idx) setDrawerAssertionId(allItems[next].id);
  }, [drawerAssertionId, allItems]);

  useEffect(() => {
    if (!drawerAssertionId) return;
    document.addEventListener('keydown', handleKeyNav);
    return () => document.removeEventListener('keydown', handleKeyNav);
  }, [drawerAssertionId, handleKeyNav]);

  // Only fetch when either section is expanded
  useEffect(() => {
    if (!fetched || allItems.length > 0) return;
    setLoading(true);
    fetch(`/api/courses/${courseId}/assertions?limit=500&scope=all`)
      .then((r) => r.json())
      .then((res) => {
        if (res.ok && Array.isArray(res.assertions)) {
          setAllItems(res.assertions);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [fetched, courseId, allItems.length]);

  // Use contentTotal (from breakdown API via PlaybookSource) — not subjects.reduce
  // which double-counts when sources are linked to multiple subjects.
  const totalCount = contentTotal || subjects.reduce((sum, s) => sum + s.assertionCount, 0);
  if (totalCount === 0) return null;

  // Split into TPs (content) and TIs (instructions)
  const { tps, tis } = useMemo(() => {
    const content: TPData[] = [];
    const instructions: TPData[] = [];
    for (const item of allItems) {
      if (INSTRUCTION_SET.has(item.category)) {
        instructions.push(item);
      } else {
        content.push(item);
      }
    }
    return { tps: content, tis: instructions };
  }, [allItems]);

  // Estimate counts before fetch using categoryCounts not available here — use allItems split
  const tpCount = allItems.length > 0 ? tps.length : null;
  const tiCount = allItems.length > 0 ? tis.length : null;

  return (
    <div className="hf-mb-lg">
      {/* ── Teaching Points (content) ── */}
      <button
        onClick={() => setExpandedTP(!expandedTP)}
        className="hf-btn-reset hf-flex hf-items-center hf-gap-sm hf-w-full hf-section-divider hf-mb-sm"
        style={{ cursor: 'pointer' }}
      >
        <BookMarked size={16} className="hf-text-muted" />
        <span className="hf-text-xs hf-text-bold hf-text-muted hf-uppercase hf-flex-1" style={{ textAlign: 'left' }}>
          Teaching Points{tpCount != null ? ` (${tpCount})` : ''}
        </span>
        <span className="hf-text-xs hf-text-placeholder">{expandedTP ? '▼' : '▶'}</span>
      </button>

      {expandedTP && (
        loading ? (
          <div className="hf-text-xs hf-text-muted hf-p-sm">Loading...</div>
        ) : tps.length === 0 ? (
          <div className="hf-text-xs hf-text-muted hf-p-sm">No teaching points</div>
        ) : (
          <AssertionList items={tps} drawerAssertionId={drawerAssertionId} onSelect={setDrawerAssertionId} />
        )
      )}

      {/* ── Teaching Instructions ── */}
      <button
        onClick={() => setExpandedTI(!expandedTI)}
        className="hf-btn-reset hf-flex hf-items-center hf-gap-sm hf-w-full hf-section-divider hf-mb-sm"
        style={{ cursor: 'pointer', marginTop: expandedTP ? 12 : 0 }}
      >
        <Zap size={16} className="hf-text-muted" />
        <span className="hf-text-xs hf-text-bold hf-text-muted hf-uppercase hf-flex-1" style={{ textAlign: 'left' }}>
          Teaching Instructions{tiCount != null ? ` (${tiCount})` : ''}
        </span>
        <span className="hf-text-xs hf-text-placeholder">{expandedTI ? '▼' : '▶'}</span>
      </button>

      {expandedTI && (
        loading ? (
          <div className="hf-text-xs hf-text-muted hf-p-sm">Loading...</div>
        ) : tis.length === 0 ? (
          <div className="hf-text-xs hf-text-muted hf-p-sm">No teaching instructions</div>
        ) : (
          <AssertionList items={tis} drawerAssertionId={drawerAssertionId} onSelect={setDrawerAssertionId} />
        )
      )}

      <AssertionDetailDrawer
        courseId={courseId}
        assertionId={drawerAssertionId}
        onClose={() => setDrawerAssertionId(null)}
      />
    </div>
  );
}

export function CourseWhatTab({
  courseId,
  detail,
  subjects,
  contentMethods,
  contentTotal,
  instructionCount = 0,
  unassignedContentCount = 0,
  categoryCounts,
  isOperator,
  onContentRefresh,
}: CourseWhatTabProps) {
  const contentOnlyTotal = contentTotal - instructionCount;
  // ── Backfill state ────────────────────────────────────
  const [backfilling, setBackfilling] = useState(false);
  const [showReExtract, setShowReExtract] = useState(false);

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

  const allSources = useMemo(
    () => [...courseGuideSources, ...otherSources],
    [courseGuideSources, otherSources],
  );

  return (
    <>
      {/* ── Course Guide ──────────────────────────────── */}
      {courseGuideSources.length > 0 && (
        <>
          <SectionHeader
            title="Course Guide"
            icon={getDocTypeInfo('COURSE_REFERENCE').icon}
            actions={isOperator && otherSources.length === 0 && allSources.length > 0 ? (
              <button
                className="hf-btn hf-btn-xs hf-btn-secondary hf-flex hf-items-center hf-gap-xs"
                onClick={() => setShowReExtract(true)}
              >
                <RefreshCw size={12} />
                Re-extract
              </button>
            ) : undefined}
          />
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
          <SectionHeader
            title="Sources"
            icon={BookMarked}
            actions={isOperator && allSources.length > 0 ? (
              <button
                className="hf-btn hf-btn-xs hf-btn-secondary hf-flex hf-items-center hf-gap-xs"
                onClick={() => setShowReExtract(true)}
              >
                <RefreshCw size={12} />
                Re-extract
              </button>
            ) : undefined}
          />
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

      {/* ── Content Stats ─────────────────────────────── */}
      {contentTotal > 0 && (
        <div className="hf-flex hf-gap-md hf-mb-lg">
          <div className="hf-stat-card hf-stat-card-compact">
            <div className="hf-stat-value-sm">📚 {contentOnlyTotal}</div>
            <div className="hf-text-xs hf-text-muted">Teaching Points</div>
          </div>
          <div className="hf-stat-card hf-stat-card-compact">
            <div className="hf-stat-value-sm">⚙️ {instructionCount}</div>
            <div className="hf-text-xs hf-text-muted">Teaching Instructions</div>
          </div>
        </div>
      )}

      {/* ── Teaching Methods ──────────────────────────── */}
      {contentMethods.length > 0 && (() => {
        const allUnassigned = unassignedContentCount === contentOnlyTotal;

        return (
          <div className="hf-mb-lg">
            <div className="hf-text-xs hf-text-bold hf-text-muted hf-uppercase hf-mb-sm">
              Teaching Methods
            </div>

            {/* Alert banner when content TPs need assignment (excludes TIs) */}
            {isOperator && unassignedContentCount > 0 && (
              <div className={`hf-banner ${allUnassigned ? 'hf-banner-warning' : 'hf-banner-info'} hf-mb-sm`}>
                <div className="hf-flex hf-items-center hf-gap-sm hf-flex-1">
                  <AlertTriangle size={14} className="hf-flex-shrink-0" />
                  <span className="hf-text-sm">
                    {allUnassigned
                      ? `All ${unassignedContentCount} teaching points need a method assigned`
                      : `${unassignedContentCount} teaching point${unassignedContentCount === 1 ? '' : 's'} not yet assigned a method`
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
                          onContentRefresh(bd.methods || [], bd.total || 0, bd.instructionCount || 0, bd.unassignedContentCount || 0);
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

            <TeachMethodStats methods={contentMethods} total={contentOnlyTotal} />

            {/* Category breakdown pills */}
            {categoryCounts && Object.keys(categoryCounts).length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div className="hf-category-label" style={{ marginBottom: 6 }}>
                  By Category
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {CATEGORY_ORDER
                    .filter(cat => (categoryCounts[cat] ?? 0) > 0)
                    .map(cat => {
                      const meta = CONTENT_CATEGORIES[cat];
                      return (
                        <span
                          key={cat}
                          className="hf-badge"
                          style={{
                            color: meta.color,
                            background: meta.bg,
                          }}
                        >
                          {meta.label}
                          <span style={{ opacity: 0.7, marginLeft: 4 }}>{categoryCounts[cat]}</span>
                        </span>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Re-extract Modal ────────────────────────── */}
      {showReExtract && (
        <ReExtractModal
          courseId={courseId}
          sources={allSources}
          onClose={() => setShowReExtract(false)}
          onComplete={async () => {
            // Refresh content breakdown after re-extraction
            if (onContentRefresh) {
              try {
                const bd = await fetch(`/api/courses/${courseId}/content-breakdown?bySubject=true`).then(r => r.json());
                if (bd.ok) {
                  onContentRefresh(bd.methods || [], bd.total || 0, bd.instructionCount || 0, bd.unassignedContentCount || 0);
                }
              } catch { /* ignore */ }
            }
          }}
        />
      )}
    </>
  );
}
