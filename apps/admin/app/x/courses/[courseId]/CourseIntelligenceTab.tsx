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

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  BookMarked, AlertTriangle, Zap, RefreshCw,
  Map as MapIcon, ChevronDown,
  Plus, Trash2, Upload,
} from 'lucide-react';
import { getDocTypeInfo } from '@/lib/doc-type-icons';
import { CONTENT_CATEGORIES, getCategoryStyle } from '@/lib/content-categories';
import { INSTRUCTION_CATEGORIES, TEACH_METHOD_CONFIG } from '@/lib/content-trust/resolve-config';
import { CourseGenomeTab } from './CourseGenomeTab';
import { ReExtractModal } from './ReExtractModal';
import { AssertionDetailDrawer } from '@/components/shared/AssertionDetailDrawer';
import { CategoryTreemap } from '@/components/shared/CategoryTreemap';
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
  categoryItems?: Record<string, string[]>;
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

/**
 * Single row in the Sources list. Renders the doc-type icon, source name,
 * type badge, and assertion count link to the source detail page. For
 * operators, shows two icon-only action buttons:
 *  - Extract: re-runs assertion extraction on the source (POST /content-sources/[id]/extract)
 *  - Delete: hard cascade delete (DELETE /content-sources/[id]/permanent)
 *
 * The Link wraps name + counts so the row stays clickable; action buttons
 * stopPropagation so they don't trigger navigation.
 */
function SourceRow({
  src,
  isOperator,
  busy,
  onExtract,
  onDelete,
}: {
  src: SourceItem;
  isOperator: boolean;
  busy: boolean;
  onExtract: () => void;
  onDelete: () => void;
}) {
  const info = getDocTypeInfo(src.documentType);
  const Icon = info.icon;
  return (
    <div className="ci-source-row ci-source-row--with-actions">
      <Link href={`/x/content-sources/${src.id}`} className="ci-source-row-link">
        <Icon size={14} style={{ color: info.color, flexShrink: 0 }} />
        <span className="ci-source-name">{src.name}</span>
        <span className="hf-badge hf-badge-sm" style={{ color: info.color, borderColor: info.color }}>
          {info.label}
        </span>
        {src.assertionCount > 0 && (
          <span className="ci-source-count">{src.assertionCount}</span>
        )}
      </Link>
      {isOperator && (
        <div className="ci-source-actions">
          <button
            className="hf-btn hf-btn-xs hf-btn-icon"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onExtract(); }}
            disabled={busy}
            title="Re-extract assertions from this source"
            aria-label={`Extract ${src.name}`}
          >
            <RefreshCw size={12} />
          </button>
          <button
            className="hf-btn hf-btn-xs hf-btn-icon hf-btn-danger"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
            disabled={busy}
            title="Delete this source and all its extracted content (cascade)"
            aria-label={`Delete ${src.name}`}
          >
            <Trash2 size={12} />
          </button>
        </div>
      )}
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
  categoryItems,
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

  // ── #284: course-level upload / extract / delete ──
  // Bind uploads to the course's primary subject — that's what the
  // backend expects (see /api/subjects/[subjectId]/upload). When the
  // course has no subjects yet, the affordance hides.
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);
  const [busySourceId, setBusySourceId] = useState<string | null>(null);
  const primarySubjectId = subjects[0]?.id ?? null;

  const handleFiles = useCallback(
    async (filesToUpload: File[]) => {
      if (!primarySubjectId) {
        setOpError("This course has no subject — can't upload yet.");
        return;
      }
      if (filesToUpload.length === 0) return;
      setUploading(true);
      setOpError(null);
      try {
        for (const file of filesToUpload) {
          const fd = new FormData();
          fd.append("file", file);
          fd.append("playbookId", courseId);
          const res = await fetch(`/api/subjects/${primarySubjectId}/upload`, {
            method: "POST",
            body: fd,
          });
          const data = await res.json();
          if (!res.ok || data.ok === false) {
            throw new Error(data.error || `Upload failed (${res.status})`);
          }
        }
        // Reload to pick up the new sources. Once-extracted-by-default sources
        // appear with their classified type; user can hit the "Extract" icon
        // per row to run extraction (intentionally NOT auto-fired here so the
        // educator can correct misclassification first).
        router.refresh();
      } catch (e) {
        setOpError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [courseId, primarySubjectId, router],
  );

  const handleExtract = useCallback(
    async (sourceId: string) => {
      setBusySourceId(sourceId);
      setOpError(null);
      try {
        const res = await fetch(`/api/content-sources/${sourceId}/extract`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const data = await res.json();
        if (!res.ok || data.ok === false) {
          throw new Error(data.error || `Extract failed (${res.status})`);
        }
        router.refresh();
      } catch (e) {
        setOpError(e instanceof Error ? e.message : "Extract failed");
      } finally {
        setBusySourceId(null);
      }
    },
    [router],
  );

  const handleDelete = useCallback(
    async (sourceId: string, name: string) => {
      // Two-step hard delete (per safety rule on /permanent route):
      //   1. DELETE /[sourceId]            — archive (soft delete)
      //   2. DELETE /[sourceId]/permanent  — cascade hard delete
      // Cascade drops assertions, questions, vocabulary, SubjectSource and
      // PlaybookSource links via Prisma's onDelete: Cascade relations.
      if (!confirm(`Delete "${name}" and all its extracted assertions / questions? This cannot be undone.`)) {
        return;
      }
      setBusySourceId(sourceId);
      setOpError(null);
      try {
        // Step 1: archive
        const archiveRes = await fetch(`/api/content-sources/${sourceId}`, {
          method: "DELETE",
        });
        if (!archiveRes.ok) {
          const data = await archiveRes.json().catch(() => ({}));
          throw new Error(data.error || `Archive failed (${archiveRes.status})`);
        }
        // Step 2: permanent delete
        const permRes = await fetch(`/api/content-sources/${sourceId}/permanent`, {
          method: "DELETE",
        });
        if (!permRes.ok) {
          const data = await permRes.json().catch(() => ({}));
          throw new Error(data.error || `Permanent delete failed (${permRes.status})`);
        }
        router.refresh();
      } catch (e) {
        setOpError(e instanceof Error ? e.message : "Delete failed");
      } finally {
        setBusySourceId(null);
      }
    },
    [router],
  );

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
        <div
          className={`ci-sources-panel${dragOver ? " ci-sources-panel--dragover" : ""}`}
          onDragOver={(e) => {
            if (!isOperator || !primarySubjectId) return;
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            if (!isOperator || !primarySubjectId) return;
            e.preventDefault();
            setDragOver(false);
            const dropped = Array.from(e.dataTransfer.files);
            if (dropped.length > 0) handleFiles(dropped);
          }}
        >
          <div className="ci-panel-header">
            <span className="ci-panel-title">
              <BookMarked size={14} /> Sources ({allSources.length})
            </span>
            {isOperator && (
              <div className="hf-flex hf-items-center hf-gap-xs">
                {/* Hidden file input — opened by the + button. */}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.docx,.txt,.md,.markdown,.json"
                  className="hf-hidden"
                  onChange={(e) => {
                    const picked = Array.from(e.target.files ?? []);
                    if (picked.length > 0) handleFiles(picked);
                    e.target.value = ""; // allow re-picking the same file
                  }}
                />
                <button
                  className="hf-btn hf-btn-xs hf-btn-primary hf-flex hf-items-center hf-gap-xs"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || !primarySubjectId}
                  title={primarySubjectId ? "Upload a file to this course" : "No subject linked yet"}
                >
                  <Plus size={12} />
                  Add
                </button>
                {allSources.length > 0 && (
                  <button
                    className="hf-btn hf-btn-xs hf-btn-secondary hf-flex hf-items-center hf-gap-xs"
                    onClick={() => setShowReExtract(true)}
                  >
                    <RefreshCw size={12} />
                    Re-extract
                  </button>
                )}
              </div>
            )}
          </div>
          {opError && (
            <div className="hf-banner hf-banner-error hf-text-xs" role="alert">
              {opError}
            </div>
          )}
          {uploading && (
            <div className="hf-text-xs hf-text-muted hf-flex hf-items-center hf-gap-xs" style={{ padding: "4px 8px" }}>
              <Upload size={12} /> Uploading…
            </div>
          )}
          <div className="ci-source-list">
            {courseGuideSources.map((src) => (
              <SourceRow
                key={src.id}
                src={src}
                isOperator={isOperator}
                busy={busySourceId === src.id}
                onExtract={() => handleExtract(src.id)}
                onDelete={() => handleDelete(src.id, src.name)}
              />
            ))}
            {otherSources.map((src) => (
              <SourceRow
                key={src.id}
                src={src}
                isOperator={isOperator}
                busy={busySourceId === src.id}
                onExtract={() => handleExtract(src.id)}
                onDelete={() => handleDelete(src.id, src.name)}
              />
            ))}
            {allSources.length === 0 && (
              <div className="hf-empty hf-text-sm">
                {primarySubjectId
                  ? "No sources uploaded yet — drop files here or click + Add."
                  : "No subject linked to this course yet."}
              </div>
            )}
          </div>
        </div>

        <div className="ci-category-panel">
          <div className="ci-panel-header">
            <span className="ci-panel-title">Content Mix</span>
          </div>
          {categoryCounts && Object.keys(categoryCounts).length > 0 ? (
            <CategoryTreemap categoryCounts={categoryCounts} categoryItems={categoryItems} />
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
