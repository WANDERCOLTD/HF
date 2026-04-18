'use client';

/**
 * CourseIntelligenceTab — "Content Intelligence" dashboard.
 *
 * Layout:
 *   1. Stat cards row (large method counts)
 *   2. Two-column: sources + category proportional bar
 *   3. Two segments: Course Map | Teaching Points
 *      - Course Map = GenomeBrowser (session×module×LO×TP grid)
 *      - Teaching Points = grouped list with "Group by" dropdown + category filter chips
 *   4. Single AssertionDetailDrawer shared across all views
 */

import { useState, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  BookMarked, AlertTriangle, Zap, RefreshCw,
  Map as MapIcon, ChevronDown,
} from 'lucide-react';
import { getDocTypeInfo } from '@/lib/doc-type-icons';
import { CONTENT_CATEGORIES, getCategoryStyle } from '@/lib/content-categories';
import { INSTRUCTION_CATEGORIES, TEACH_METHOD_CONFIG } from '@/lib/content-trust/resolve-config';
import { CourseGenomeTab } from './CourseGenomeTab';
import { ReExtractModal } from './ReExtractModal';
import { AssertionDetailDrawer } from '@/components/shared/AssertionDetailDrawer';
import './course-intelligence.css';

// ── Types ──────────────────────────────────────────────

type SourceItem = {
  id: string;
  name: string;
  documentType: string;
  extractorVersion: number | null;
  assertionCount: number;
  contentAssertionCount: number;
  instructionAssertionCount: number;
  sortOrder: number;
  tags: string[];
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
  sources?: Array<{
    id: string; name: string; documentType: string;
    extractorVersion: number | null; assertionCount: number;
    linkedSourceId: string | null; linkedSourceName: string | null;
  }>;
};

type MethodBreakdown = { teachMethod: string; count: number; reviewed: number };

export type CourseIntelligenceTabProps = {
  courseId: string;
  detail: {
    id: string;
    name: string;
    config?: Record<string, unknown> | null;
    domain: { id: string; name: string; slug: string };
  };
  subjects: SubjectSummary[];
  courseSources?: SourceItem[];
  courseTeachingProfile?: string | null;
  contentMethods: MethodBreakdown[];
  contentTotal: number;
  instructionCount?: number;
  unassignedContentCount?: number;
  categoryCounts?: Record<string, number>;
  isOperator: boolean;
  onContentRefresh?: (methods: MethodBreakdown[], total: number, instructionCount?: number, unassignedContentCount?: number) => void;
};

// ── Constants ──────────────────────────────────────────

const INSTRUCTION_SET = new Set<string>(INSTRUCTION_CATEGORIES);
type Segment = 'map' | 'points';
type GroupBy = 'learningOutcomeRef' | 'teachMethod' | 'sourceName';

const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'learningOutcomeRef', label: 'Outcome' },
  { value: 'teachMethod', label: 'Method' },
  { value: 'sourceName', label: 'Source' },
];

type TPData = {
  id: string;
  assertion: string;
  category: string;
  teachMethod: string | null;
  learningOutcomeRef: string | null;
  sourceName: string;
  session?: number | null;
};

// ── Sub-components ─────────────────────────────────────

/** Two-segment toggle: Course Map | Teaching Points */
function SegmentedControl({ active, onChange, pointsCount }: {
  active: Segment;
  onChange: (s: Segment) => void;
  pointsCount: number;
}) {
  return (
    <div className="ci-segment-bar" role="tablist">
      <button
        role="tab"
        aria-selected={active === 'map'}
        className={`ci-segment-btn${active === 'map' ? ' ci-segment-active' : ''}`}
        onClick={() => onChange('map')}
      >
        <MapIcon size={14} />
        <span>Course Map</span>
      </button>
      <button
        role="tab"
        aria-selected={active === 'points'}
        className={`ci-segment-btn${active === 'points' ? ' ci-segment-active' : ''}`}
        onClick={() => onChange('points')}
      >
        <BookMarked size={14} />
        <span>Teaching Points</span>
        {pointsCount > 0 && <span className="ci-segment-count">{pointsCount}</span>}
      </button>
    </div>
  );
}

/** Category filter chips — toggle categories on/off */
function CategoryFilterChips({ categories, activeFilters, onToggle }: {
  categories: Array<{ cat: string; count: number }>;
  activeFilters: Set<string>;
  onToggle: (cat: string) => void;
}) {
  if (categories.length === 0) return null;
  const allActive = activeFilters.size === 0; // empty = show all

  return (
    <div className="ci-filter-chips">
      {categories.map(({ cat, count }) => {
        const meta = CONTENT_CATEGORIES[cat] ?? getCategoryStyle(cat);
        const isActive = allActive || activeFilters.has(cat);
        return (
          <button
            key={cat}
            type="button"
            className={`ci-filter-chip${isActive ? '' : ' ci-filter-chip-off'}`}
            style={{
              '--chip-color': meta.color,
              '--chip-bg': meta.bg,
            } as React.CSSProperties}
            onClick={() => onToggle(cat)}
          >
            <span className="ci-filter-chip-swatch" style={{ background: meta.color }} />
            {meta.label}
            <span className="ci-filter-chip-count">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Group-by dropdown */
function GroupBySelect({ value, onChange }: {
  value: GroupBy;
  onChange: (v: GroupBy) => void;
}) {
  return (
    <div className="ci-groupby">
      <span className="ci-groupby-label">Group by</span>
      <div className="ci-groupby-select-wrap">
        <select
          className="ci-groupby-select"
          value={value}
          onChange={(e) => onChange(e.target.value as GroupBy)}
        >
          {GROUP_BY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <ChevronDown size={12} className="ci-groupby-chevron" />
      </div>
    </div>
  );
}

/** Assertion list grouped by an arbitrary key */
function GroupedAssertionList({ items, groupBy, drawerAssertionId, onSelect }: {
  items: TPData[];
  groupBy: GroupBy;
  drawerAssertionId: string | null;
  onSelect: (id: string) => void;
}) {
  const grouped = useMemo(() => {
    const groups = new Map<string, TPData[]>();

    if (groupBy === 'teachMethod') {
      const methodKeys = Object.keys(TEACH_METHOD_CONFIG);
      for (const key of methodKeys) groups.set(key, []);
      for (const tp of items) {
        const key = tp.teachMethod ?? 'unassigned';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(tp);
      }
      for (const [k, v] of groups) { if (v.length === 0) groups.delete(k); }
    } else {
      for (const tp of items) {
        const key = groupBy === 'learningOutcomeRef'
          ? (tp.learningOutcomeRef || 'Unassigned')
          : tp.sourceName;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(tp);
      }
    }
    return groups;
  }, [items, groupBy]);

  return (
    <div className="ci-assertion-scroll">
      {Array.from(grouped.entries()).map(([groupKey, groupItems]) => {
        const isMethod = groupBy === 'teachMethod';
        const cfg = isMethod
          ? TEACH_METHOD_CONFIG[groupKey as keyof typeof TEACH_METHOD_CONFIG]
          : null;
        const heading = isMethod
          ? (cfg ? `${cfg.icon} ${cfg.label}` : (groupKey === 'unassigned' ? 'Unassigned' : groupKey))
          : groupKey;

        return (
          <div key={groupKey} className="ci-group">
            <div className="ci-group-heading">
              <span className="ci-group-label">{heading}</span>
              <span className="ci-group-count">{groupItems.length}</span>
            </div>
            {groupItems.map((tp) => {
              const cs = getCategoryStyle(tp.category);
              const isInstruction = INSTRUCTION_SET.has(tp.category);
              return (
                <button
                  key={tp.id}
                  type="button"
                  className={`ci-tp-row${drawerAssertionId === tp.id ? ' ci-tp-row-active' : ''}${isInstruction ? ' ci-tp-row-instruction' : ''}`}
                  onClick={() => onSelect(tp.id)}
                >
                  <span className="ci-tp-cat" style={{ background: cs.color }}>{tp.category}</span>
                  <span className="ci-tp-text">{tp.assertion}</span>
                  {groupBy !== 'sourceName' && (
                    <span className="ci-tp-source">[{tp.sourceName}]</span>
                  )}
                  {tp.session != null && (
                    <span className="ci-tp-session">S{tp.session}</span>
                  )}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ── Squarify treemap layout ───────────────────────────

type TreemapRect = { cat: string; count: number; x: number; y: number; w: number; h: number };

/** Squarified treemap: lays out items into a rectangle, optimising for square-ish cells. */
function squarify(
  items: Array<{ cat: string; count: number }>,
  width: number,
  height: number,
): TreemapRect[] {
  const total = items.reduce((s, i) => s + i.count, 0);
  if (total === 0 || items.length === 0) return [];

  // Normalise areas to fill width * height
  const areas = items.map((i) => ({ ...i, area: (i.count / total) * width * height }));

  const rects: TreemapRect[] = [];
  let x = 0, y = 0, w = width, h = height;

  function layoutRow(row: typeof areas, rowArea: number, short: number, isHoriz: boolean) {
    const long = rowArea / short;
    let offset = 0;
    for (const item of row) {
      const size = item.area / long;
      if (isHoriz) {
        rects.push({ cat: item.cat, count: item.count, x, y: y + offset, w: long, h: size });
      } else {
        rects.push({ cat: item.cat, count: item.count, x: x + offset, y, w: size, h: long });
      }
      offset += size;
    }
    if (isHoriz) { x += long; w -= long; }
    else { y += long; h -= long; }
  }

  function worst(row: typeof areas, short: number): number {
    const rowArea = row.reduce((s, i) => s + i.area, 0);
    let max = 0;
    for (const item of row) {
      const long = rowArea / short;
      const size = item.area / long;
      const ratio = Math.max(long / size, size / long);
      if (ratio > max) max = ratio;
    }
    return max;
  }

  let remaining = [...areas];
  while (remaining.length > 0) {
    const short = Math.min(w, h);
    const isHoriz = h <= w;
    const row: typeof areas = [remaining[0]];
    remaining = remaining.slice(1);

    while (remaining.length > 0) {
      const candidate = [...row, remaining[0]];
      if (worst(candidate, short) <= worst(row, short)) {
        row.push(remaining[0]);
        remaining = remaining.slice(1);
      } else {
        break;
      }
    }
    const rowArea = row.reduce((s, i) => s + i.area, 0);
    layoutRow(row, rowArea, short, isHoriz);
  }
  return rects;
}

/** Category treemap — HDD-style proportional display */
function CategoryTreemap({ categoryCounts }: { categoryCounts: Record<string, number> }) {
  const total = Object.values(categoryCounts).reduce((s, c) => s + c, 0);
  if (total === 0) return null;

  const entries = Object.entries(categoryCounts)
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1]);

  const TREEMAP_W = 100; // percentage-based
  const TREEMAP_H = 100;
  const rects = squarify(
    entries.map(([cat, count]) => ({ cat, count })),
    TREEMAP_W,
    TREEMAP_H,
  );

  return (
    <div className="ci-treemap-container">
      <div className="ci-treemap">
        {rects.map((r) => {
          const meta = CONTENT_CATEGORIES[r.cat] ?? getCategoryStyle(r.cat);
          const pct = Math.round((r.count / total) * 100);
          // Show label inside if cell is big enough
          const showLabel = r.w > 15 && r.h > 18;
          const showCount = r.w > 10 && r.h > 12;
          return (
            <div
              key={r.cat}
              className="ci-treemap-cell"
              style={{
                left: `${r.x}%`,
                top: `${r.y}%`,
                width: `${r.w}%`,
                height: `${r.h}%`,
                background: meta.color,
              }}
              data-label={`${meta.label}: ${r.count} (${pct}%)`}
            >
              {showLabel && <span className="ci-treemap-label">{meta.label}</span>}
              {showCount && <span className="ci-treemap-count">{r.count}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────

export function CourseIntelligenceTab({
  courseId,
  subjects,
  courseSources,
  contentMethods,
  contentTotal,
  instructionCount = 0,
  unassignedContentCount = 0,
  categoryCounts,
  isOperator,
  onContentRefresh,
}: CourseIntelligenceTabProps) {
  const contentOnlyTotal = contentTotal - instructionCount;

  // ── State ────────────────────────────────────────────
  const [segment, setSegment] = useState<Segment>('map');
  const [groupBy, setGroupBy] = useState<GroupBy>('learningOutcomeRef');
  const [categoryFilters, setCategoryFilters] = useState<Set<string>>(new Set());
  const [showInstructions, setShowInstructions] = useState(true);
  const [allItems, setAllItems] = useState<TPData[]>([]);
  const [fetched, setFetched] = useState(false);
  const [drawerAssertionId, setDrawerAssertionId] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [showReExtract, setShowReExtract] = useState(false);

  // ── Lazy fetch assertions when switching to points ──
  const needsAssertions = segment === 'points';
  const loading = needsAssertions && !fetched && allItems.length === 0;

  useEffect(() => {
    if (!needsAssertions || allItems.length > 0 || fetched) return;
    let cancelled = false;

    fetch(`/api/courses/${courseId}/assertions?limit=500&scope=all`)
      .then((r) => r.json())
      .then((res) => {
        if (!cancelled && res.ok && Array.isArray(res.assertions)) {
          setAllItems(res.assertions);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setFetched(true);
      });

    return () => { cancelled = true; };
  }, [needsAssertions, courseId, allItems.length, fetched]);

  // ── Arrow key navigation ─────────────────────────────
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

  // ── Derived: split TPs vs instructions ──────────────
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

  // ── Derived: category list for filter chips ─────────
  const availableCategories = useMemo(() => {
    const counts = new Map<string, number>();
    const items = showInstructions ? [...tps, ...tis] : tps;
    for (const tp of items) {
      counts.set(tp.category, (counts.get(tp.category) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([cat, count]) => ({ cat, count }))
      .sort((a, b) => b.count - a.count);
  }, [tps, tis, showInstructions]);

  // ── Derived: filtered items ─────────────────────────
  const filteredItems = useMemo(() => {
    const combined = showInstructions ? [...tps, ...tis] : tps;
    if (categoryFilters.size === 0) return combined; // no filter = show all
    return combined.filter((tp) => categoryFilters.has(tp.category));
  }, [tps, tis, showInstructions, categoryFilters]);

  // ── Toggle a category filter chip ───────────────────
  const toggleCategoryFilter = useCallback((cat: string) => {
    setCategoryFilters((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  }, []);

  // ── Sources ──────────────────────────────────────────
  const { courseGuideSources, otherSources, allSources } = useMemo(() => {
    const guides: SourceItem[] = [];
    const others: SourceItem[] = [];

    if (courseSources && courseSources.length > 0) {
      for (const src of courseSources) {
        if (src.documentType === 'COURSE_REFERENCE') {
          guides.push(src);
        } else {
          others.push(src);
        }
      }
    } else {
      const seen = new Set<string>();
      for (const sub of subjects) {
        for (const src of sub.sources || []) {
          if (seen.has(src.id)) continue;
          seen.add(src.id);
          const item: SourceItem = {
            ...src,
            contentAssertionCount: 0,
            instructionAssertionCount: 0,
            sortOrder: 0,
            tags: [],
          };
          if (src.documentType === 'COURSE_REFERENCE') {
            guides.push(item);
          } else {
            others.push(item);
          }
        }
      }
    }
    return { courseGuideSources: guides, otherSources: others, allSources: [...guides, ...others] };
  }, [courseSources, subjects]);

  // ── Auto-assign handler ──────────────────────────────
  const handleBackfill = useCallback(async () => {
    setBackfilling(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/backfill-teach-methods`, { method: 'POST' });
      const data = await res.json();
      if (data.ok && data.updated > 0) {
        setAllItems([]);
        setFetched(false);
        if (onContentRefresh) {
          const bd = await fetch(`/api/courses/${courseId}/content-breakdown?bySubject=true`).then(r => r.json());
          if (bd.ok) {
            onContentRefresh(bd.methods || [], bd.total || 0, bd.instructionCount || 0, bd.unassignedContentCount || 0);
          }
        }
      }
    } catch { /* ignore */ }
    setBackfilling(false);
  }, [courseId, onContentRefresh]);

  const allUnassigned = unassignedContentCount === contentOnlyTotal;
  const visibleMethods = contentMethods.filter((m) => m.count > 0);

  return (
    <div className="ci-container">
      {/* ── ROW 1: Stat Cards ────────────────────────── */}
      <div className="ci-stats-row">
        {visibleMethods.map((m) => {
          const cfg = TEACH_METHOD_CONFIG[m.teachMethod as keyof typeof TEACH_METHOD_CONFIG];
          const icon = cfg?.icon || '?';
          const label = cfg?.label || m.teachMethod;
          return (
            <div key={m.teachMethod} className="ci-stat-card">
              <div className="ci-stat-number">{icon} {m.count}</div>
              <div className="ci-stat-label">{label}</div>
            </div>
          );
        })}
        {contentOnlyTotal > 0 && (
          <div className="ci-stat-card">
            <div className="ci-stat-number">{contentOnlyTotal}</div>
            <div className="ci-stat-label">Teaching Points</div>
          </div>
        )}
        {instructionCount > 0 && (
          <div className="ci-stat-card">
            <div className="ci-stat-number">{instructionCount}</div>
            <div className="ci-stat-label">Instructions</div>
          </div>
        )}
        {unassignedContentCount > 0 && (
          <div className="ci-stat-card ci-stat-card-warn">
            <div className="ci-stat-number">{unassignedContentCount}</div>
            <div className="ci-stat-label">Unassigned</div>
          </div>
        )}
      </div>

      {/* ── ROW 2: Sources + Categories (2-col) ──────── */}
      <div className="ci-two-col">
        <div className="ci-sources-panel">
          <div className="ci-panel-header">
            <span className="ci-panel-title">
              <BookMarked size={14} /> Sources ({allSources.length})
            </span>
            {isOperator && allSources.length > 0 && (
              <button
                className="hf-btn hf-btn-xs hf-btn-secondary hf-flex hf-items-center hf-gap-xs"
                onClick={() => setShowReExtract(true)}
              >
                <RefreshCw size={12} />
                Re-extract
              </button>
            )}
          </div>
          <div className="ci-source-list">
            {courseGuideSources.map((src) => {
              const info = getDocTypeInfo(src.documentType);
              const Icon = info.icon;
              return (
                <Link key={src.id} href={`/x/content-sources/${src.id}`} className="ci-source-row">
                  <Icon size={14} style={{ color: info.color, flexShrink: 0 }} />
                  <span className="ci-source-name">{src.name}</span>
                  <span className="hf-badge hf-badge-sm" style={{ color: info.color, borderColor: info.color }}>
                    {info.label}
                  </span>
                  <span className="ci-source-count">{src.assertionCount}</span>
                </Link>
              );
            })}
            {otherSources.map((src) => {
              const info = getDocTypeInfo(src.documentType);
              const Icon = info.icon;
              return (
                <Link key={src.id} href={`/x/content-sources/${src.id}`} className="ci-source-row">
                  <Icon size={14} style={{ color: info.color, flexShrink: 0 }} />
                  <span className="ci-source-name">{src.name}</span>
                  <span className="hf-badge hf-badge-sm" style={{ color: info.color, borderColor: info.color }}>
                    {info.label}
                  </span>
                  {src.assertionCount > 0 && (
                    <span className="ci-source-count">{src.assertionCount}</span>
                  )}
                </Link>
              );
            })}
            {allSources.length === 0 && (
              <div className="hf-empty hf-text-sm">No sources uploaded yet</div>
            )}
          </div>
        </div>

        <div className="ci-category-panel">
          <div className="ci-panel-header">
            <span className="ci-panel-title">Content Mix</span>
          </div>
          {categoryCounts && Object.keys(categoryCounts).length > 0 ? (
            <CategoryTreemap categoryCounts={categoryCounts} />
          ) : (
            <div className="hf-empty hf-text-sm">No categories yet</div>
          )}
        </div>
      </div>

      {/* ── Unassigned alert ─────────────────────────── */}
      {isOperator && unassignedContentCount > 0 && (
        <div className={`hf-banner ${allUnassigned ? 'hf-banner-warning' : 'hf-banner-info'}`}>
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
            onClick={handleBackfill}
          >
            <Zap size={12} />
            {backfilling ? 'Assigning\u2026' : 'Auto-assign'}
          </button>
        </div>
      )}

      {/* ── ROW 3: Segmented Control ─────────────────── */}
      <SegmentedControl
        active={segment}
        onChange={setSegment}
        pointsCount={contentOnlyTotal + instructionCount}
      />

      {/* ── Segment Content ──────────────────────────── */}
      <div className="ci-segment-content">
        {segment === 'map' && (
          <CourseGenomeTab
            courseId={courseId}
            onAssertionSelect={setDrawerAssertionId}
            activeAssertionId={drawerAssertionId}
          />
        )}

        {segment === 'points' && (
          loading ? (
            <div className="hf-empty">
              <span className="hf-spinner" />
              <span>Loading teaching points...</span>
            </div>
          ) : allItems.length === 0 ? (
            <div className="hf-empty">
              <BookMarked size={24} />
              <span>No teaching points yet</span>
              <span className="hf-text-muted hf-text-xs">
                Upload content sources to extract teaching points.
              </span>
            </div>
          ) : (
            <>
              {/* Toolbar: Group by + Instructions toggle + Filter chips */}
              <div className="ci-toolbar">
                <GroupBySelect value={groupBy} onChange={setGroupBy} />
                {tis.length > 0 && (
                  <label className="ci-toggle">
                    <input
                      type="checkbox"
                      checked={showInstructions}
                      onChange={(e) => setShowInstructions(e.target.checked)}
                    />
                    <span className="ci-toggle-label">
                      Instructions ({tis.length})
                    </span>
                  </label>
                )}
                {categoryFilters.size > 0 && (
                  <button
                    type="button"
                    className="ci-clear-filters"
                    onClick={() => setCategoryFilters(new Set())}
                  >
                    Clear filters
                  </button>
                )}
              </div>

              <CategoryFilterChips
                categories={availableCategories}
                activeFilters={categoryFilters}
                onToggle={toggleCategoryFilter}
              />

              {/* Filtered count */}
              {categoryFilters.size > 0 && (
                <div className="ci-filter-status">
                  Showing {filteredItems.length} of {showInstructions ? tps.length + tis.length : tps.length}
                </div>
              )}

              {/* Grouped list */}
              <GroupedAssertionList
                items={filteredItems}
                groupBy={groupBy}
                drawerAssertionId={drawerAssertionId}
                onSelect={setDrawerAssertionId}
              />
            </>
          )
        )}
      </div>

      {/* ── Shared Drawer ────────────────────────────── */}
      <AssertionDetailDrawer
        courseId={courseId}
        assertionId={drawerAssertionId}
        onClose={() => setDrawerAssertionId(null)}
      />

      {/* ── Re-extract Modal ─────────────────────────── */}
      {showReExtract && (
        <ReExtractModal
          courseId={courseId}
          sources={allSources}
          onClose={() => setShowReExtract(false)}
          onComplete={async () => {
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
    </div>
  );
}
