'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import Link from 'next/link';
import {
  BookMarked, FileText, Plus,
  AlertTriangle, Upload, Target, ListOrdered, Link2, Zap,
  CheckCircle2, XCircle, TrendingUp, ShieldAlert,
} from 'lucide-react';
import { TeachMethodStats } from '@/components/shared/TeachMethodStats';
import { TrustBadge } from '@/app/x/content-sources/_components/shared/badges';
import { getDocTypeInfo } from '@/lib/doc-type-icons';
import type { GoalTemplate, PlaybookConfig } from '@/lib/types/json-fields';

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

type SuccessCriterion = {
  id: string;
  assertion: string;
  chapter: string | null;
  section: string | null;
  tags: string[];
};

type SessionPlanInfo = {
  estimatedSessions: number;
  totalDurationMins: number;
  generatedAt?: string | null;
} | null;

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
  sessionPlan: SessionPlanInfo;
  onContentRefresh?: (methods: MethodBreakdown[], total: number, instructionCount?: number) => void;
  onDetailUpdate?: (updater: (prev: any) => any) => void;
};

// ── Goal type labels (shared with /x/goals page) ───────

const GOAL_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  LEARN: { label: 'Learn', color: 'var(--accent-primary)' },
  ACHIEVE: { label: 'Achieve', color: 'var(--status-warning-text)' },
  CHANGE: { label: 'Change', color: 'var(--badge-purple-text)' },
  CONNECT: { label: 'Connect', color: 'var(--badge-pink-text)' },
  SUPPORT: { label: 'Support', color: 'var(--status-success-text)' },
  CREATE: { label: 'Create', color: 'var(--badge-cyan-text)' },
};

// ── Success criteria tier display ────────────────────────

function getTierConfig(tier: string): { icon: typeof CheckCircle2; color: string } {
  const lower = tier.toLowerCase();
  if (lower.includes('fail')) return { icon: XCircle, color: 'var(--status-error-text)' };
  if (lower.includes('strong') || lower.includes('confidence')) return { icon: TrendingUp, color: 'var(--accent-primary)' };
  if (lower.includes('minimum') || lower.includes('pass')) return { icon: CheckCircle2, color: 'var(--status-success-text)' };
  return { icon: Target, color: 'var(--text-muted)' };
}

// ── Section Header ─────────────────────────────────────

function SectionHeader({ title, icon: Icon }: { title: string; icon: React.ComponentType<{ size?: number; className?: string }> }) {
  return (
    <div className="hf-flex hf-gap-sm hf-items-center hf-mb-md hf-section-divider">
      <Icon size={18} className="hf-text-muted" />
      <h2 className="hf-section-title hf-mb-0">{title}</h2>
    </div>
  );
}

// ── Linked Source Tree ──────────────────────────────────
// Renders sources grouped: passages with their linked QBs nested below,
// standalone sources (no link) shown flat.

function SourceTree({ sources, courseId, subjectId }: { sources: SourceDetail[]; courseId: string; subjectId: string }) {
  // Build a set of IDs that are linked TO a parent (i.e. they are children)
  const linkedChildIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of sources) {
      if (s.linkedSourceId) ids.add(s.id);
    }
    return ids;
  }, [sources]);

  // Find children for a given parent source
  const childrenOf = useCallback((parentId: string) =>
    sources.filter((s) => s.linkedSourceId === parentId),
  [sources]);

  // Root sources: not a child of another source in this list
  const roots = useMemo(() =>
    sources.filter((s) => !linkedChildIds.has(s.id)),
  [sources, linkedChildIds]);

  if (sources.length === 0) return null;

  return (
    <div className="hf-flex hf-flex-col hf-gap-xs hf-mt-sm">
      {roots.map((src) => {
        const children = childrenOf(src.id);
        const info = getDocTypeInfo(src.documentType);
        const Icon = info.icon;
        return (
          <div key={src.id}>
            <Link href={`/x/content-sources/${src.id}`} className="hf-flex hf-items-center hf-gap-sm hf-text-xs hf-link-row">
              <Icon size={13} style={{ color: info.color, flexShrink: 0 }} />
              <span className="hf-flex-1 hf-text-secondary hf-truncate" title={src.name}>{src.name}</span>
              <span className="hf-badge hf-badge-xs" style={{ color: info.color, borderColor: info.color }}>
                {info.label}
              </span>
              <span className="hf-text-placeholder">{src.assertionCount} pts</span>
            </Link>
            {children.map((child) => {
              const cInfo = getDocTypeInfo(child.documentType);
              const CIcon = cInfo.icon;
              return (
                <Link key={child.id} href={`/x/content-sources/${child.id}`} className="hf-flex hf-items-center hf-gap-sm hf-text-xs hf-pl-lg hf-link-row">
                  <Link2 size={10} className="hf-text-placeholder hf-flex-shrink-0" />
                  <CIcon size={13} style={{ color: cInfo.color, flexShrink: 0 }} />
                  <span className="hf-flex-1 hf-text-secondary hf-truncate" title={child.name}>{child.name}</span>
                  <span className="hf-badge hf-badge-xs" style={{ color: cInfo.color, borderColor: cInfo.color }}>
                    {cInfo.label}
                  </span>
                  <span className="hf-text-placeholder">{child.assertionCount} pts</span>
                </Link>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

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
  sessionPlan,
  onContentRefresh,
  onDetailUpdate,
}: CourseWhatTabProps) {
  const config = (detail.config || {}) as PlaybookConfig;
  const goals = config.goals || [];
  const constraints: string[] = (config as PlaybookConfig & { constraints?: string[] }).constraints || [];

  // ── Backfill state ────────────────────────────────────
  const [backfilling, setBackfilling] = useState(false);

  // ── Inline edit states ────────────────────────────────
  const [saving, setSaving] = useState(false);

  // ── Collect COURSE_REFERENCE sources across all subjects ──
  const courseGuideSources = useMemo(() => {
    const guides: SourceDetail[] = [];
    for (const sub of subjects) {
      for (const src of sub.sources || []) {
        if (src.documentType === 'COURSE_REFERENCE') guides.push(src);
      }
    }
    return guides;
  }, [subjects]);

  // True when a course reference exists but hasn't finished extracting yet
  const goalsExtracting = useMemo(
    () => courseGuideSources.length > 0 && courseGuideSources.every((s) => s.assertionCount === 0),
    [courseGuideSources],
  );

  // ── Success criteria + boundaries from course reference ──
  const [successCriteria, setSuccessCriteria] = useState<SuccessCriterion[]>([]);
  const [extractedBoundaries, setExtractedBoundaries] = useState<string[]>([]);
  const [criteriaLoading, setCriteriaLoading] = useState(false);

  useEffect(() => {
    if (courseGuideSources.length === 0) return;
    setCriteriaLoading(true);
    fetch(`/api/courses/${courseId}/course-instructions`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          if (data.categories?.assessment_approach) {
            setSuccessCriteria(data.categories.assessment_approach);
          }
          // Extract boundary items from teaching_rule + edge_case
          const prohibRe = /\b(never|do not|don'?t|avoid|must not|should not|shouldn'?t|forbidden|prohibited|not allowed)\b/i;
          const boundaries = [
            ...(data.categories?.teaching_rule || []),
            ...(data.categories?.edge_case || []),
          ]
            .filter((item: { assertion: string }) => prohibRe.test(item.assertion))
            .map((item: { assertion: string }) => item.assertion.replace(/^[\s•\-–—]+/, ''));
          setExtractedBoundaries(boundaries);
        }
      })
      .catch(() => {})
      .finally(() => setCriteriaLoading(false));
  }, [courseId, courseGuideSources.length]);

  // Merge manual constraints + extracted boundaries (deduped)
  const allBoundaries = useMemo(() => {
    const manualSet = new Set(constraints.map((c) => c.toLowerCase().trim()));
    return [
      ...constraints,
      ...extractedBoundaries.filter((b) => !manualSet.has(b.toLowerCase().trim())),
    ];
  }, [constraints, extractedBoundaries]);

  // Group criteria by section or chapter (tier names like "Minimum", "Strong", "Fail conditions")
  const criteriaByTier = useMemo(() => {
    const groups = new Map<string, SuccessCriterion[]>();
    for (const c of successCriteria) {
      // Prefer section (sub-heading) over chapter (top-level heading)
      const tier = c.section || c.chapter || 'General';
      const list = groups.get(tier) ?? [];
      list.push(c);
      groups.set(tier, list);
    }
    return groups;
  }, [successCriteria]);

  // ── Config save helper ────────────────────────────────
  const saveConfig = useCallback(async (patch: Record<string, unknown>) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/playbooks/${detail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: patch }),
      });
      const data = await res.json();
      if (data.ok && onDetailUpdate) {
        onDetailUpdate((prev: any) => prev ? {
          ...prev,
          config: { ...(prev.config || {}), ...patch },
        } : prev);
      }
      return data.ok;
    } finally {
      setSaving(false);
    }
  }, [detail.id, onDetailUpdate]);

  return (
    <>
      {/* ── Goals / Success Criteria ─────────────────── */}
      <SectionHeader title="Goals" icon={Target} />
      <div className="hf-card-compact hf-mb-lg">
        {/* Wizard-defined goals */}
        {goals.length > 0 && (
          <div className="hf-flex hf-flex-col hf-gap-sm hf-mb-md">
            {goals.map((g, i) => {
              const typeConfig = GOAL_TYPE_CONFIG[g.type] || { label: g.type, color: 'var(--text-muted)' };
              return (
                <div key={i} className="hf-flex hf-gap-sm hf-items-start cov-goal-row">
                  <span
                    className="hf-badge hf-badge-sm"
                    style={{ color: typeConfig.color, borderColor: typeConfig.color }}
                  >
                    {typeConfig.label}
                  </span>
                  <div className="hf-flex-1">
                    <div className="hf-text-sm">{g.name}</div>
                    {g.description && (
                      <div className="hf-text-xs hf-text-muted">{g.description}</div>
                    )}
                  </div>
                  {g.isAssessmentTarget && (
                    <span className="hf-badge hf-badge-sm hf-badge-warning" title={`Assessment target — ${Math.round((g.assessmentConfig?.threshold || 0.8) * 100)}% threshold`}>
                      Assessment
                    </span>
                  )}
                  {g.isDefault && (
                    <span className="hf-badge hf-badge-sm hf-badge-muted">Default</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Success criteria from course reference (only if no synced goals — they're the same data) */}
        {criteriaLoading ? (
          <div className="hf-text-sm hf-text-muted">Loading success criteria...</div>
        ) : successCriteria.length > 0 && goals.length === 0 ? (
          <div className="hf-flex hf-flex-col hf-gap-md">
            {[...criteriaByTier.entries()].map(([tier, items]) => {
              const tierConfig = getTierConfig(tier);
              const TierIcon = tierConfig.icon;
              return (
                <div key={tier}>
                  <div className="hf-flex hf-items-center hf-gap-xs hf-mb-xs">
                    <TierIcon size={13} style={{ color: tierConfig.color }} />
                    <span className="hf-text-xs hf-text-bold" style={{ color: tierConfig.color }}>
                      {tier}
                    </span>
                  </div>
                  <div className="hf-flex hf-flex-col hf-gap-xs">
                    {items.map((c) => (
                      <div key={c.id} className="hf-flex hf-gap-sm hf-items-start hf-text-sm">
                        <span className="hf-text-placeholder hf-mt-xs" style={{ flexShrink: 0 }}>&#8226;</span>
                        <span className="hf-text-secondary">{c.assertion}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : goals.length === 0 ? (
          goalsExtracting ? (
            <div className="hf-flex hf-items-center hf-gap-sm hf-text-sm hf-text-muted">
              <span className="hf-glow-active" style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0 }} />
              Extracting goals from course reference…
            </div>
          ) : (
            <div className="hf-text-sm hf-text-muted">
              No goals configured. Set goals in the Course Setup wizard to track learner progress.
            </div>
          )
        ) : null}
      </div>

      {/* ── Boundaries ─────────────────────────────────── */}
      {(allBoundaries.length > 0 || goalsExtracting) && (
        <>
          <SectionHeader title="Boundaries" icon={ShieldAlert} />
          <div className="hf-card-compact hf-mb-lg">
            {allBoundaries.length > 0 ? (
              <div className="hf-flex hf-flex-col hf-gap-xs">
                {allBoundaries.map((c, i) => (
                  <div key={i} className="hf-flex hf-gap-sm hf-items-start hf-text-sm">
                    <ShieldAlert size={13} className="hf-text-error hf-mt-xs" style={{ flexShrink: 0 }} />
                    <span className="hf-text-secondary">{c}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="hf-flex hf-items-center hf-gap-sm hf-text-sm hf-text-muted">
                <span className="hf-glow-active" style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0 }} />
                Extracting boundaries from course reference…
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Course Guide ──────────────────────────────── */}
      {courseGuideSources.length > 0 && (
        <>
          <SectionHeader title="Course Guide" icon={getDocTypeInfo('COURSE_REFERENCE').icon} />
          <div className="hf-card-compact hf-mb-lg" style={{ borderLeft: '3px solid #7c3aed' }}>
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

      {/* ── What You're Teaching ──────────────────────── */}
      <div className="hf-flex hf-flex-between hf-items-center hf-mb-md hf-section-divider">
        <div className="hf-flex hf-gap-sm hf-items-center">
          <BookMarked size={18} className="hf-text-muted" />
          <h2 className="hf-section-title hf-mb-0">What You&apos;re Teaching</h2>
        </div>
        {isOperator && subjects.length > 0 && (
          <Link
            href={`/x/courses/new?domainId=${detail.domain.id}`}
            className="hf-btn-sm hf-btn-secondary"
          >
            <Plus size={13} />
            Add Subject
          </Link>
        )}
      </div>

      {subjects.length === 0 ? (
        <div className="hf-empty-compact hf-mb-lg">
          <BookMarked size={36} className="hf-text-tertiary hf-mb-sm" />
          <div className="hf-heading-sm hf-text-secondary hf-mb-sm">No subjects yet</div>
          <p className="hf-text-xs hf-text-muted hf-mb-md">Subjects are created when you upload content or use the Course Setup wizard.</p>
          {isOperator && (
            <Link href={`/x/courses/new?domainId=${detail.domain.id}`} className="hf-btn hf-btn-primary">
              <Plus size={14} />
              Set Up Course
            </Link>
          )}
        </div>
      ) : (
        <div className="hf-card-grid-md hf-mb-lg">
          {subjects.map((sub) => {
            // Filter out COURSE_REFERENCE sources — they're shown in the Course Guide card
            const contentSources = (sub.sources || []).filter((s) => s.documentType !== 'COURSE_REFERENCE');
            return (
              <div key={sub.id} className="hf-card-compact">
                <Link
                  href={`/x/courses/${courseId}/subjects/${sub.id}`}
                  className="hf-card-link-inner"
                >
                  <div className="hf-flex hf-gap-sm hf-items-center hf-mb-sm">
                    <BookMarked size={16} className="hf-text-accent hf-flex-shrink-0" />
                    <h3 className="hf-heading-sm hf-mb-0 hf-flex-1">{sub.name}</h3>
                    <TrustBadge level={sub.defaultTrustLevel} />
                  </div>
                  {sub.description && (
                    <p className="hf-text-xs hf-text-muted hf-mb-sm hf-line-clamp-2">{sub.description}</p>
                  )}
                  <div className="hf-flex hf-gap-md hf-text-xs hf-text-muted">
                    {sub.sourceCount === 0 ? (
                      <span className="hf-text-warning hf-flex hf-items-center hf-gap-xs">
                        <AlertTriangle size={12} />No content yet
                      </span>
                    ) : (
                      <span><FileText size={12} className="hf-icon-inline" />{sub.sourceCount} sources</span>
                    )}
                    <span>{sub.assertionCount} teaching points</span>
                    {sub.curriculumCount > 0 && <span>{sub.curriculumCount} curricula</span>}
                  </div>
                </Link>
                {/* ── Source tree with linked pairing ── */}
                {contentSources.length > 0 && (
                  <SourceTree sources={contentSources} courseId={courseId} subjectId={sub.id} />
                )}
                {isOperator && sub.sourceCount === 0 && (
                  <Link
                    href={`/x/courses/${courseId}/subjects/${sub.id}`}
                    className="hf-btn-sm hf-btn-primary hf-mt-sm"
                  >
                    <Upload size={13} />
                    Upload Content
                  </Link>
                )}
              </div>
            );
          })}
        </div>
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

      {/* ── Session Plan Summary ──────────────────────── */}
      {sessionPlan && sessionPlan.estimatedSessions > 0 && (
        <>
          <SectionHeader title="Session Plan" icon={ListOrdered} />
          <div className="hf-card-compact hf-mb-lg">
            <div className="hf-flex hf-gap-lg">
              <div>
                <div className="hf-text-lg hf-text-bold">{sessionPlan.estimatedSessions}</div>
                <div className="hf-text-xs hf-text-muted">Sessions</div>
              </div>
              {sessionPlan.totalDurationMins > 0 && (
                <div>
                  <div className="hf-text-lg hf-text-bold">
                    {sessionPlan.totalDurationMins >= 60
                      ? `${Math.round(sessionPlan.totalDurationMins / 60 * 10) / 10}h`
                      : `${sessionPlan.totalDurationMins}m`
                    }
                  </div>
                  <div className="hf-text-xs hf-text-muted">Total Duration</div>
                </div>
              )}
              {sessionPlan.totalDurationMins > 0 && sessionPlan.estimatedSessions > 0 && (
                <div>
                  <div className="hf-text-lg hf-text-bold">
                    {Math.round(sessionPlan.totalDurationMins / sessionPlan.estimatedSessions)}m
                  </div>
                  <div className="hf-text-xs hf-text-muted">Avg per Session</div>
                </div>
              )}
            </div>
            {sessionPlan.generatedAt && (
              <div className="hf-text-xs hf-text-placeholder hf-mt-sm">
                Generated {new Date(sessionPlan.generatedAt).toLocaleDateString()}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
