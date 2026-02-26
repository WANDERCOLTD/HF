'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  BookMarked, FileText, ExternalLink, Plus,
  Sparkles, BarChart3, Sliders, Shield, Compass,
  Settings as SettingsIcon, ChevronRight, CheckCircle2,
} from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useTerminology } from '@/contexts/TerminologyContext';
import { useEntityContext } from '@/contexts/EntityContext';
import { EditableTitle } from '@/components/shared/EditableTitle';
import { StatusBadge, DomainPill } from '@/src/components/shared/EntityPill';
import { TrustBadge } from '@/app/x/content-sources/_components/shared/badges';
import { HierarchyBreadcrumb } from '@/components/shared/HierarchyBreadcrumb';
import { DraggableTabs, type TabDefinition } from '@/components/shared/DraggableTabs';
import { TeachMethodStats } from '@/components/shared/TeachMethodStats';
import {
  groupSpecs,
  archetypeLabel,
  type PlaybookItem,
  type SystemSpec,
  type SpecDetail,
  type SpecGroup,
} from '@/lib/course/group-specs';
import { TEACH_METHOD_CONFIG } from '@/lib/content-trust/resolve-config';

// ── Types ──────────────────────────────────────────────

type PlaybookDetail = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  version: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  domain: { id: string; name: string; slug: string };
  items: PlaybookItem[];
  systemSpecs: SystemSpec[];
  _count: { items: number };
};

type SubjectSummary = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  defaultTrustLevel: string;
  sourceCount: number;
  curriculumCount: number;
  assertionCount: number;
};

type FlowPhase = {
  id: string;
  label: string;
  duration?: string;
  goals?: string[];
};

type MethodBreakdown = {
  teachMethod: string;
  count: number;
  reviewed: number;
};

type BreakdownBySubject = {
  subjectId: string;
  subjectName: string;
  methods: Array<{ teachMethod: string; count: number }>;
};

type DrillItem = {
  id: string;
  assertion: string;
  category: string;
  teachMethod: string;
  chapter: string | null;
  section: string | null;
  reviewed: boolean;
  sourceName: string | null;
  subjectName: string | null;
};

type DrillState = {
  items: DrillItem[];
  total: number;
  loading: boolean;
  error: string | null;
};

const statusMap: Record<string, 'draft' | 'active' | 'archived'> = {
  draft: 'draft',
  published: 'active',
  archived: 'archived',
};

// ── Section Header ─────────────────────────────────────

function SectionHeader({ title, icon: Icon }: { title: string; icon: React.ComponentType<{ size?: number; className?: string }> }) {
  return (
    <div className="hf-flex hf-gap-sm hf-items-center hf-mb-md hf-section-divider">
      <Icon size={18} className="hf-text-muted" />
      <h2 className="hf-section-title hf-mb-0">{title}</h2>
    </div>
  );
}

// ── Spec Chip List ─────────────────────────────────────

function SpecChipList({ specs, icon: Icon, label }: {
  specs: SpecGroup;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
}) {
  if (specs.length === 0) return null;
  return (
    <div className="hf-card-compact">
      <div className="hf-flex hf-gap-sm hf-items-center hf-mb-sm">
        <Icon size={15} className="hf-text-muted" />
        <span className="hf-text-xs hf-text-bold hf-text-muted hf-uppercase">{label}</span>
      </div>
      <div className="hf-flex hf-flex-col hf-gap-xs">
        {specs.map(s => (
          <div key={s.slug} className="hf-flex hf-gap-sm hf-items-start">
            <ChevronRight size={12} className="hf-text-placeholder hf-flex-shrink-0 hf-mt-xs" />
            <div>
              <div className="hf-text-sm">{s.name}</div>
              {s.description && (
                <div className="hf-text-xs hf-text-muted">
                  {s.description.length > 100 ? s.description.slice(0, 100) + '...' : s.description}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────

export default function CourseDetailPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const router = useRouter();
  const { data: session } = useSession();
  const isOperator = ['OPERATOR', 'EDUCATOR', 'ADMIN', 'SUPERADMIN'].includes((session?.user?.role as string) || '');
  const { plural } = useTerminology();
  const { pushEntity } = useEntityContext();

  // ── State ──────────────────────────────────────────
  const [detail, setDetail] = useState<PlaybookDetail | null>(null);
  const [subjects, setSubjects] = useState<SubjectSummary[]>([]);
  const [flowPhases, setFlowPhases] = useState<FlowPhase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Content breakdown
  const [contentMethods, setContentMethods] = useState<MethodBreakdown[]>([]);
  const [contentBySubject, setContentBySubject] = useState<BreakdownBySubject[]>([]);
  const [contentTotal, setContentTotal] = useState(0);
  const [contentReviewed, setContentReviewed] = useState(0);

  // Tabs
  const [activeTab, setActiveTab] = useState<string>('overview');

  // Content tab drill-down
  const [expandedMethod, setExpandedMethod] = useState<string | null>(null);
  const [drillStates, setDrillStates] = useState<Record<string, DrillState>>({});

  // Settings actions
  const [publishing, setPublishing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // ── Data Loading ─────────────────────────────────────
  useEffect(() => {
    if (!courseId) return;
    setLoading(true);

    Promise.all([
      fetch(`/api/playbooks/${courseId}`).then((r) => r.json()),
      fetch(`/api/courses/${courseId}/subjects`).then((r) => r.json()),
      fetch(`/api/courses/${courseId}/content-breakdown?bySubject=true`).then((r) => r.json()),
    ])
      .then(([pbData, subData, breakdownData]) => {
        if (pbData.ok) {
          setDetail(pbData.playbook);
          pushEntity({
            type: 'playbook',
            id: pbData.playbook.id,
            label: pbData.playbook.name,
            href: `/x/courses/${pbData.playbook.id}`,
          });
          // Fetch domain onboarding phases
          if (pbData.playbook.domain?.id) {
            fetch(`/api/domains/${pbData.playbook.domain.id}`)
              .then((r) => r.json())
              .then((domData) => {
                if (domData.ok && domData.domain?.onboardingFlowPhases) {
                  const raw = domData.domain.onboardingFlowPhases;
                  const phasesArr = Array.isArray(raw) ? raw : raw?.phases;
                  if (Array.isArray(phasesArr)) {
                    setFlowPhases(phasesArr.map((p: any) => ({
                      id: p.phase || p.id || '',
                      label: (p.label || p.phase || '').replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
                      duration: p.duration,
                      goals: p.goals,
                    })));
                  }
                }
              })
              .catch(() => {});
          }
        } else {
          setError(pbData.error || 'Course not found');
        }
        if (subData.ok) {
          setSubjects(subData.subjects || []);
        }
        if (breakdownData.ok) {
          setContentMethods(breakdownData.methods || []);
          setContentBySubject(breakdownData.bySubject || []);
          setContentTotal(breakdownData.total || 0);
          setContentReviewed(breakdownData.reviewedCount || 0);
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [courseId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived Data ─────────────────────────────────────
  const specGroups = useMemo(() => {
    if (!detail) return { persona: [], measure: [], adapt: [], guard: [], voice: [], compose: [] };
    return groupSpecs(detail.items, detail.systemSpecs);
  }, [detail]);

  const persona = useMemo(() => {
    const spec = specGroups.persona[0] as SpecDetail | undefined;
    if (!spec) return null;
    const config = spec.config as any;
    const roleParam = config?.parameters?.find((p: any) => p.id === 'agent_role');
    return {
      name: spec.name,
      extendsAgent: spec.extendsAgent,
      roleStatement: roleParam?.config?.roleStatement || null,
      primaryGoal: roleParam?.config?.primaryGoal || null,
    };
  }, [specGroups]);

  const totalTPs = useMemo(() => subjects.reduce((sum, s) => sum + s.assertionCount, 0), [subjects]);
  const totalSources = useMemo(() => subjects.reduce((sum, s) => sum + s.sourceCount, 0), [subjects]);

  const tabs: TabDefinition[] = useMemo(() => [
    { id: 'overview', label: 'Overview', icon: <Sparkles size={14} /> },
    { id: 'content', label: 'Content', icon: <BookMarked size={14} />, count: contentTotal || null },
  ], [contentTotal]);

  // ── Drill-down: load assertions for a teachMethod ───
  const loadDrillDown = useCallback(async (method: string) => {
    if (!courseId) return;
    if (drillStates[method]?.items?.length) return; // already loaded

    setDrillStates(prev => ({
      ...prev,
      [method]: { items: [], total: 0, loading: true, error: null },
    }));

    try {
      const res = await fetch(
        `/api/courses/${courseId}/content-breakdown?teachMethod=${encodeURIComponent(method)}&limit=50`,
      );
      const data = await res.json();
      if (data.ok) {
        setDrillStates(prev => ({
          ...prev,
          [method]: { items: data.assertions || [], total: data.total || 0, loading: false, error: null },
        }));
      } else {
        setDrillStates(prev => ({
          ...prev,
          [method]: { items: [], total: 0, loading: false, error: data.error || 'Failed to load' },
        }));
      }
    } catch (e) {
      setDrillStates(prev => ({
        ...prev,
        [method]: { items: [], total: 0, loading: false, error: e instanceof Error ? e.message : 'Network error' },
      }));
    }
  }, [courseId, drillStates]);

  const loadMoreDrill = useCallback(async (method: string) => {
    if (!courseId) return;
    const existing = drillStates[method];
    if (!existing) return;

    setDrillStates(prev => ({
      ...prev,
      [method]: { ...prev[method], loading: true },
    }));

    try {
      const res = await fetch(
        `/api/courses/${courseId}/content-breakdown?teachMethod=${encodeURIComponent(method)}&limit=50&offset=${existing.items.length}`,
      );
      const data = await res.json();
      if (data.ok) {
        setDrillStates(prev => ({
          ...prev,
          [method]: {
            items: [...prev[method].items, ...(data.assertions || [])],
            total: data.total || prev[method].total,
            loading: false,
            error: null,
          },
        }));
      } else {
        setDrillStates(prev => ({
          ...prev,
          [method]: { ...prev[method], loading: false, error: data.error || "Failed to load more" },
        }));
      }
    } catch {
      setDrillStates(prev => ({
        ...prev,
        [method]: { ...prev[method], loading: false },
      }));
    }
  }, [courseId, drillStates]);

  const handleToggleMethod = useCallback((method: string) => {
    if (expandedMethod === method) {
      setExpandedMethod(null);
    } else {
      setExpandedMethod(method);
      loadDrillDown(method);
    }
  }, [expandedMethod, loadDrillDown]);

  // ── Action Handlers ──────────────────────────────────
  const handlePublish = async () => {
    if (!detail) return;
    setPublishing(true);
    try {
      const res = await fetch(`/api/playbooks/${detail.id}/publish`, { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setDetail((prev) => prev ? { ...prev, status: 'PUBLISHED', publishedAt: new Date().toISOString() } : prev);
      } else {
        setError(data.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publish failed');
    } finally {
      setPublishing(false);
    }
  };

  const handleArchive = async () => {
    if (!detail) return;
    setArchiving(true);
    try {
      const res = await fetch(`/api/playbooks/${detail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ARCHIVED' }),
      });
      const data = await res.json();
      if (data.ok) setDetail((prev) => prev ? { ...prev, status: 'ARCHIVED' } : prev);
      else setError(data.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Archive failed');
    } finally {
      setArchiving(false);
    }
  };

  const handleRestore = async () => {
    if (!detail) return;
    setArchiving(true);
    try {
      const res = await fetch(`/api/playbooks/${detail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'DRAFT' }),
      });
      const data = await res.json();
      if (data.ok) setDetail((prev) => prev ? { ...prev, status: 'DRAFT' } : prev);
      else setError(data.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Restore failed');
    } finally {
      setArchiving(false);
    }
  };

  const handleDelete = async () => {
    if (!detail) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/playbooks/${detail.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.ok) {
        router.push('/x/courses');
      } else {
        setError(data.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  // ── Loading / Error States ───────────────────────────
  if (loading) {
    return (
      <div className="hf-page-container">
        <div className="hf-empty-compact">
          <div className="hf-spinner" />
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="hf-page-container">
        <HierarchyBreadcrumb
          segments={[{ label: plural('playbook'), href: '/x/courses' }]}
        />
        <div className="hf-banner hf-banner-error">
          {error || 'Course not found'}
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────
  return (
    <div className="hf-page-container hf-page-scroll">
      {/* Breadcrumb */}
      <HierarchyBreadcrumb
        segments={[
          { label: plural('playbook'), href: '/x/courses' },
          { label: detail.name, href: `/x/courses/${detail.id}` },
        ]}
      />

      {/* ── Hero (always visible above tabs) ───────────── */}
      <div className="hf-flex hf-flex-between hf-items-start hf-mb-lg">
        <div>
          <div className="hf-flex hf-gap-md hf-items-center hf-mb-sm">
            <EditableTitle
              value={detail.name}
              as="h1"
              onSave={async (newName) => {
                const res = await fetch(`/api/playbooks/${detail.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: newName }),
                });
                const data = await res.json();
                if (!data.ok) throw new Error(data.error);
                setDetail((prev) => prev ? { ...prev, name: newName } : prev);
              }}
            />
            <StatusBadge status={statusMap[detail.status.toLowerCase()] || 'draft'} />
          </div>
          <div className="hf-flex hf-gap-sm hf-items-center">
            <DomainPill label={detail.domain.name} href={`/x/domains?id=${detail.domain.id}`} size="compact" />
            {(detail as any).group && (
              <span className="hf-pill hf-pill-neutral">{(detail as any).group.name}</span>
            )}
            <span className="hf-text-xs hf-text-placeholder">v{detail.version}</span>
          </div>
        </div>
        <Link
          href={`/x/playbooks/${detail.id}`}
          className="hf-btn hf-btn-secondary hf-nowrap"
        >
          <ExternalLink size={14} />
          Open Editor
        </Link>
      </div>

      {detail.description && (
        <p className="hf-text-sm hf-text-muted hf-mb-lg">{detail.description}</p>
      )}

      {/* ── Stats Row ─────────────────────────────────── */}
      <div className="hf-flex hf-gap-lg hf-mb-lg">
        <div className="hf-stat-card hf-stat-card-compact">
          <div className="hf-stat-value-sm">{subjects.length}</div>
          <div className="hf-text-xs hf-text-muted">Subjects</div>
        </div>
        <div className="hf-stat-card hf-stat-card-compact">
          <div className="hf-stat-value-sm">{totalTPs}</div>
          <div className="hf-text-xs hf-text-muted">Teaching Points</div>
        </div>
        <div className="hf-stat-card hf-stat-card-compact">
          <div className="hf-stat-value-sm">{totalSources}</div>
          <div className="hf-text-xs hf-text-muted">Sources</div>
        </div>
        {detail.publishedAt && (
          <div className="hf-stat-card hf-stat-card-compact">
            <div className="hf-text-sm hf-text-bold">{new Date(detail.publishedAt).toLocaleDateString()}</div>
            <div className="hf-text-xs hf-text-muted">Published</div>
          </div>
        )}
      </div>

      {/* ── Tabs ──────────────────────────────────────── */}
      <DraggableTabs
        storageKey="course-detail-tabs"
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        showReset={false}
      />

      {/* ═══════════════════════════════════════════════ */}
      {/* OVERVIEW TAB                                   */}
      {/* ═══════════════════════════════════════════════ */}
      {activeTab === 'overview' && (
        <>
          {/* TeachMethod summary stats */}
          {contentMethods.length > 0 && (
            <div className="hf-mb-lg hf-mt-md">
              <div className="hf-text-xs hf-text-bold hf-text-muted hf-uppercase hf-mb-sm">
                Teaching Methods
              </div>
              <TeachMethodStats methods={contentMethods} total={contentTotal} />
            </div>
          )}

          {/* What You're Teaching */}
          <SectionHeader title="What You're Teaching" icon={BookMarked} />

          {subjects.length === 0 ? (
            <div className="hf-empty-compact hf-mb-lg">
              <BookMarked size={36} className="hf-text-tertiary hf-mb-sm" />
              <div className="hf-heading-sm hf-text-secondary hf-mb-sm">No subjects yet</div>
              <p className="hf-text-xs hf-text-muted hf-mb-md">Subjects are created when you upload content or use the Course Setup wizard.</p>
              {isOperator && (
                <Link href="/x/courses?action=setup" className="hf-btn hf-btn-primary">
                  <Plus size={14} />
                  Set Up Course
                </Link>
              )}
            </div>
          ) : (
            <div className="hf-card-grid-md hf-mb-lg">
              {subjects.map((sub) => (
                <Link
                  key={sub.id}
                  href={`/x/courses/${courseId}/subjects/${sub.id}`}
                  className="hf-card-compact hf-card-link"
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
                    <span><FileText size={12} className="hf-icon-inline" />{sub.sourceCount} sources</span>
                    <span>{sub.assertionCount} teaching points</span>
                    {sub.curriculumCount > 0 && <span>{sub.curriculumCount} curricula</span>}
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* How It's Taught */}
          <SectionHeader title="How It's Taught" icon={Sparkles} />

          <div className="hf-mb-lg">
            {persona ? (
              <div className="hf-card-compact hf-mb-md">
                <div className="hf-flex hf-gap-sm hf-items-center hf-mb-sm">
                  <Sparkles size={15} className="hf-text-accent" />
                  <span className="hf-text-xs hf-text-bold hf-text-muted hf-uppercase">AI Personality</span>
                </div>
                <div className="hf-heading-sm hf-mb-xs">{persona.name}</div>
                {persona.extendsAgent && (
                  <div className="hf-mb-sm">
                    <span className="hf-text-xs hf-tag-pill">
                      {archetypeLabel(persona.extendsAgent)} archetype
                    </span>
                  </div>
                )}
                {persona.roleStatement && (
                  <p className="hf-text-sm hf-text-secondary hf-mb-xs hf-quote">
                    &ldquo;{persona.roleStatement}&rdquo;
                  </p>
                )}
                {persona.primaryGoal && (
                  <p className="hf-text-xs hf-text-muted">Goal: {persona.primaryGoal}</p>
                )}
              </div>
            ) : (
              <div className="hf-card-compact hf-mb-md">
                <div className="hf-text-sm hf-text-muted">
                  No AI personality configured. The system will use the default archetype.
                </div>
              </div>
            )}

            {(specGroups.measure.length > 0 || specGroups.adapt.length > 0 || specGroups.guard.length > 0) && (
              <div className="hf-card-grid-md">
                <SpecChipList specs={specGroups.measure} icon={BarChart3} label="What's Measured" />
                <SpecChipList specs={specGroups.adapt} icon={Sliders} label="How It Adapts" />
                <SpecChipList specs={specGroups.guard} icon={Shield} label="Guardrails" />
              </div>
            )}

            {specGroups.measure.length === 0 && specGroups.adapt.length === 0 && specGroups.guard.length === 0 && (
              <div className="hf-card-compact">
                <div className="hf-text-sm hf-text-muted">
                  System measurement and adaptation specs will be shown here once configured.
                </div>
              </div>
            )}
          </div>

          {/* Student Journey */}
          <SectionHeader title="Student Journey" icon={Compass} />

          <div className="hf-mb-lg">
            {flowPhases.length > 0 ? (
              <div className="hf-card-compact">
                <div className="hf-flex hf-gap-sm hf-items-center hf-mb-md">
                  <Compass size={15} className="hf-text-muted" />
                  <span className="hf-text-xs hf-text-bold hf-text-muted hf-uppercase">Onboarding Flow</span>
                </div>
                <div className="hf-flex hf-gap-sm hf-items-center hf-flex-wrap">
                  {flowPhases.map((phase, i) => (
                    <div key={phase.id} className="hf-flex hf-gap-sm hf-items-center">
                      <div className="hf-phase-pill">
                        <div className="hf-text-xs hf-text-bold">{phase.label}</div>
                        {phase.duration && (
                          <div className="hf-text-xs hf-text-muted hf-phase-duration">
                            {phase.duration}
                          </div>
                        )}
                      </div>
                      {i < flowPhases.length - 1 && (
                        <ChevronRight size={14} className="hf-text-placeholder" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="hf-card-compact">
                <div className="hf-text-sm hf-text-muted">
                  Onboarding flow will appear here once the institution is configured.
                </div>
              </div>
            )}
          </div>

          {/* Settings */}
          {isOperator && (
            <>
              <SectionHeader title="Settings" icon={SettingsIcon} />

              <div className="hf-mb-lg">
                <div className="hf-flex hf-gap-sm hf-mb-lg hf-flex-wrap">
                  {detail.status === 'DRAFT' && (
                    <button onClick={handlePublish} disabled={publishing} className="hf-btn hf-btn-primary">
                      {publishing ? 'Publishing...' : 'Publish'}
                    </button>
                  )}
                  {detail.status !== 'ARCHIVED' && (
                    <button onClick={handleArchive} disabled={archiving} className="hf-btn hf-btn-secondary">
                      {archiving ? 'Archiving...' : 'Archive'}
                    </button>
                  )}
                  {detail.status === 'ARCHIVED' && (
                    <button onClick={handleRestore} disabled={archiving} className="hf-btn hf-btn-secondary">
                      {archiving ? 'Restoring...' : 'Restore'}
                    </button>
                  )}
                  {detail.status === 'DRAFT' && (
                    <>
                      {!showDeleteConfirm ? (
                        <button onClick={() => setShowDeleteConfirm(true)} className="hf-btn hf-btn-destructive">
                          Delete
                        </button>
                      ) : (
                        <div className="hf-flex hf-gap-xs hf-items-center">
                          <span className="hf-text-xs hf-text-error">Delete permanently?</span>
                          <button onClick={handleDelete} disabled={deleting} className="hf-btn-sm hf-btn-destructive">
                            {deleting ? '...' : 'Yes'}
                          </button>
                          <button onClick={() => setShowDeleteConfirm(false)} className="hf-btn-sm hf-btn-secondary">
                            Cancel
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="hf-meta-row">
                  <div className="hf-flex hf-gap-lg hf-text-xs hf-text-muted">
                    <span>ID: <span className="hf-mono">{detail.id.slice(0, 8)}...</span></span>
                    <span>Created: {new Date(detail.createdAt).toLocaleDateString()}</span>
                    <span>Updated: {new Date(detail.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* CONTENT TAB — drill-down by teachMethod        */}
      {/* ═══════════════════════════════════════════════ */}
      {activeTab === 'content' && (
        <div className="hf-mt-lg">
          {contentMethods.length === 0 ? (
            <div className="hf-empty-compact">
              <BookMarked size={36} className="hf-text-tertiary hf-mb-sm" />
              <div className="hf-heading-sm hf-text-secondary hf-mb-sm">No teaching points yet</div>
              <p className="hf-text-xs hf-text-muted">
                Teaching points will appear here once you upload content and run extraction.
              </p>
            </div>
          ) : (
            <>
              <div className="hf-flex hf-flex-between hf-items-center hf-mb-md">
                <div className="hf-text-xs hf-text-bold hf-text-muted hf-uppercase">
                  Teaching Points by Method
                </div>
                <div className="hf-text-xs hf-text-muted">
                  {contentReviewed}/{contentTotal} reviewed
                </div>
              </div>

              <div>
                {contentMethods.filter(m => m.count > 0).map((m) => {
                  const cfg = TEACH_METHOD_CONFIG[m.teachMethod as keyof typeof TEACH_METHOD_CONFIG];
                  const icon = cfg?.icon || '?';
                  const label = cfg?.label || m.teachMethod;
                  const isExpanded = expandedMethod === m.teachMethod;
                  const drill = drillStates[m.teachMethod];

                  // Per-subject subtitle
                  const subjectParts = contentBySubject
                    .map(s => {
                      const match = s.methods.find(sm => sm.teachMethod === m.teachMethod);
                      return match ? `${s.subjectName}: ${match.count}` : null;
                    })
                    .filter(Boolean);

                  const progressPct = m.count > 0 ? Math.round((m.reviewed / m.count) * 100) : 0;

                  return (
                    <div key={m.teachMethod} className="hf-method-group">
                      <div
                        className="hf-method-group-header"
                        onClick={() => handleToggleMethod(m.teachMethod)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleToggleMethod(m.teachMethod);
                          }
                        }}
                      >
                        <span className="hf-method-group-icon">{icon}</span>
                        <div className="hf-flex-1 hf-min-w-0">
                          <div className="hf-method-group-label">{label}</div>
                          {subjectParts.length > 1 && (
                            <div className="hf-method-group-subtitle">
                              {subjectParts.join('  ·  ')}
                            </div>
                          )}
                        </div>
                        <div className="hf-method-group-progress" title={`${m.reviewed}/${m.count} reviewed`}>
                          <div
                            className="hf-method-group-progress-fill"
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                        <span className="hf-method-group-count">{m.count}</span>
                        <ChevronRight
                          size={14}
                          className={`hf-context-banner-chevron ${isExpanded ? 'hf-context-banner-chevron-open' : ''}`}
                        />
                      </div>

                      {/* Expanded drill-down items */}
                      {isExpanded && (
                        <div className="hf-method-group-items">
                          {drill?.loading && !drill.items.length && (
                            <div className="hf-method-group-item">
                              <div className="hf-spinner hf-spinner-sm" />
                              <span className="hf-text-xs hf-text-muted">Loading...</span>
                            </div>
                          )}

                          {drill?.error && (
                            <div className="hf-method-group-item">
                              <span className="hf-text-xs hf-text-error">{drill.error}</span>
                            </div>
                          )}

                          {drill?.items?.map((item) => (
                            <div key={item.id} className="hf-method-group-item">
                              {item.reviewed && (
                                <CheckCircle2 size={13} className="hf-method-group-item-reviewed" />
                              )}
                              <span className="hf-method-group-item-text">{item.assertion}</span>
                              <span className="hf-tag-pill hf-text-xs">{item.category}</span>
                              {item.sourceName && (
                                <span className="hf-method-group-item-meta">{item.sourceName}</span>
                              )}
                            </div>
                          ))}

                          {drill && !drill.loading && drill.items.length < drill.total && (
                            <button
                              className="hf-method-group-load-more"
                              onClick={() => loadMoreDrill(m.teachMethod)}
                              type="button"
                            >
                              Load more ({drill.total - drill.items.length} remaining)
                            </button>
                          )}

                          {drill?.loading && drill.items.length > 0 && (
                            <div className="hf-method-group-item">
                              <div className="hf-spinner hf-spinner-sm" />
                              <span className="hf-text-xs hf-text-muted">Loading more...</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
