'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  BookMarked, FileText, ExternalLink, Plus, Pencil, Trash2,
  Sparkles, BarChart3, Sliders, Shield, Compass, AlertTriangle,
  Settings as SettingsIcon, ChevronRight, CheckCircle2,
  School, GraduationCap, Users2, Image, Upload,
  ListOrdered, Zap, RefreshCw, Target, BookOpen,
  Layers, PlayCircle,
} from 'lucide-react';
import { StudentJourneyTab } from './StudentJourneyTab';
import { useSession } from 'next-auth/react';
import { useEntityContext } from '@/contexts/EntityContext';
import { EditableTitle } from '@/components/shared/EditableTitle';
import { StatusBadge, DomainPill } from '@/src/components/shared/EntityPill';
import { TrustBadge } from '@/app/x/content-sources/_components/shared/badges';
import { DraggableTabs, type TabDefinition } from '@/components/shared/DraggableTabs';
import { TeachMethodStats } from '@/components/shared/TeachMethodStats';
import { SessionTPList, UnassignedTPList, type TPItem, type SessionOption } from '@/components/shared/SessionTPList';
import {
  groupSpecs,
  archetypeLabel,
  type PlaybookItem,
  type SystemSpec,
  type SpecDetail,
  type SpecGroup,
} from '@/lib/course/group-specs';
import { TEACH_METHOD_CONFIG, TEACHING_MODE_LABELS, INTERACTION_PATTERN_LABELS, type TeachingMode, type InteractionPattern } from '@/lib/content-trust/resolve-config';
import { SESSION_TYPES, SESSION_TYPE_ICONS, getSessionTypeColor, getSessionTypeLabel } from '@/lib/lesson-plan/session-ui';
import { getLessonPlanModel } from '@/lib/lesson-plan/models';
import { PlanSummary, type PlanSession } from '@/app/x/courses/_components/PlanSummary';
import { SimLaunchModal } from '@/components/shared/SimLaunchModal';
import { getTeachingProfile, resolveTeachingProfile } from '@/lib/content-trust/teaching-profiles';
import './course-detail.css';

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
  config?: Record<string, unknown> | null;
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
  teachingProfile: string | null;
  sourceCount: number;
  curriculumCount: number;
  assertionCount: number;
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

type ClassroomItem = {
  id: string;
  name: string;
  memberCount: number;
  maxMembers: number | null;
  fillRate: number;
  institutionName: string | null;
  institutionId: string | null;
};

type StudentItem = {
  id: string;
  name: string | null;
  email: string;
  lastCallAt: string | null;
  callCount: number;
  joinedAt: string;
};

type MediaItem = {
  id: string;
  fileName: string;
  title: string | null;
  fileSize: number;
  mimeType: string;
  trustLevel: string;
  captionText: string | null;
  figureRef: string | null;
  pageNumber: number | null;
  extractedFrom: string | null;
  sourceName: string | null;
  subjectName: string | null;
};

// ── Sessions Tab Types ────────────────────────────────

type SessionPhaseEntry = {
  id: string;
  label: string;
  durationMins?: number;
  teachMethods?: string[];
  learningOutcomeRefs?: string[];
  guidance?: string;
};

type SessionMediaRef = {
  mediaId: string;
  fileName?: string;
  captionText?: string | null;
  figureRef?: string | null;
  mimeType?: string;
};

type SessionEntry = {
  session: number;
  type: string;
  moduleId: string | null;
  moduleLabel: string;
  label: string;
  notes?: string | null;
  estimatedDurationMins?: number | null;
  assertionCount?: number | null;
  phases?: SessionPhaseEntry[] | null;
  learningOutcomeRefs?: string[] | null;
  assertionIds?: string[] | null;
  media?: SessionMediaRef[] | null;
};

type ModuleSummary = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  estimatedDurationMinutes: number | null;
  sortOrder: number;
  learningObjectiveCount: number;
};

type StudentProgress = {
  callerId: string;
  name: string;
  currentSession: number | null;
};

type SessionTabData = {
  plan: { entries: SessionEntry[]; estimatedSessions: number; generatedAt?: string | null; model?: string | null } | null;
  modules: ModuleSummary[];
  curriculumId: string | null;
  subjectCount: number;
  studentProgress?: StudentProgress[];
};

// SESSION_TYPES, SESSION_TYPE_ICONS, getSessionTypeColor, getSessionTypeLabel
// imported from @/lib/lesson-plan/session-ui

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
  const { pushEntity } = useEntityContext();

  // ── State ──────────────────────────────────────────
  const [detail, setDetail] = useState<PlaybookDetail | null>(null);
  const [subjects, setSubjects] = useState<SubjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSimModal, setShowSimModal] = useState(false);

  // Content breakdown
  const [contentMethods, setContentMethods] = useState<MethodBreakdown[]>([]);
  const [contentBySubject, setContentBySubject] = useState<BreakdownBySubject[]>([]);
  const [contentTotal, setContentTotal] = useState(0);
  const [contentReviewed, setContentReviewed] = useState(0);

  // Teaching focus
  const [teachingFocusDraft, setTeachingFocusDraft] = useState("");
  const [teachingFocusSaving, setTeachingFocusSaving] = useState(false);
  const [teachingFocusSaved, setTeachingFocusSaved] = useState(false);

  // Tabs
  const [activeTab, setActiveTab] = useState<string>('overview');

  // Lazy tab data
  const [classrooms, setClassrooms] = useState<ClassroomItem[] | null>(null);
  const [classroomsLoading, setClassroomsLoading] = useState(false);
  const [students, setStudents] = useState<StudentItem[] | null>(null);
  const [studentsLoading, setStudentsLoading] = useState(false);

  // Media tab
  const [mediaAssets, setMediaAssets] = useState<MediaItem[] | null>(null);
  const [mediaTotal, setMediaTotal] = useState(0);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaTypeFilter, setMediaTypeFilter] = useState('all');

  // Sessions tab
  const [sessions, setSessions] = useState<SessionTabData | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [expandedSession, setExpandedSession] = useState<number | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  // Session Teaching Points
  const [sessionTPs, setSessionTPs] = useState<Record<number, TPItem[]>>({});
  const [unassignedTPs, setUnassignedTPs] = useState<TPItem[]>([]);
  const [tpLoaded, setTpLoaded] = useState(false);

  // Session media map
  type MediaRef = { mediaId: string; fileName: string; captionText: string | null; figureRef: string | null; mimeType: string };
  type SessionMediaMap = { sessions: Array<{ session: number; label: string; images: MediaRef[] }>; unassigned: MediaRef[]; stats: { total: number; assigned: number; unassigned: number } };
  const [sessionMediaMap, setSessionMediaMap] = useState<SessionMediaMap | null>(null);
  const [mediaMapLoading, setMediaMapLoading] = useState(false);
  const [editingSessionMedia, setEditingSessionMedia] = useState<number | null>(null);
  const [lightboxImage, setLightboxImage] = useState<MediaRef | null>(null);
  const [unassignedSearch, setUnassignedSearch] = useState('');
  const [dragMediaId, setDragMediaId] = useState<string | null>(null);

  // Content tab drill-down
  const [expandedMethod, setExpandedMethod] = useState<string | null>(null);
  const [drillStates, setDrillStates] = useState<Record<string, DrillState>>({});

  // Settings actions
  const [publishing, setPublishing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Description editing
  const [editingDescription, setEditingDescription] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const [savingDescription, setSavingDescription] = useState(false);

  // ── Data Loading ─────────────────────────────────────
  useEffect(() => {
    if (!courseId) return;
    setLoading(true);

    Promise.all([
      fetch(`/api/playbooks/${courseId}`).then((r) => r.json()),
      fetch(`/api/courses/${courseId}/subjects`).then((r) => r.json()),
      fetch(`/api/courses/${courseId}/content-breakdown?bySubject=true`).then((r) => r.json()),
      fetch(`/api/courses/${courseId}/media?limit=0`).then((r) => r.json()).catch(() => ({ ok: false })),
    ])
      .then(([pbData, subData, breakdownData, mediaData]) => {
        if (pbData.ok) {
          setDetail(pbData.playbook);
          setTeachingFocusDraft((pbData.playbook.config as any)?.teachingFocus || "");
          pushEntity({
            type: 'playbook',
            id: pbData.playbook.id,
            label: pbData.playbook.name,
            href: `/x/courses/${pbData.playbook.id}`,
          });
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
        if (mediaData?.ok) {
          setMediaTotal(mediaData.total || 0);
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

  const totalSessionDuration = useMemo(() => {
    if (!sessions?.plan?.entries) return 0;
    return sessions.plan.entries.reduce((sum, e) => sum + (e.estimatedDurationMins || 0), 0);
  }, [sessions]);

  const tabs: TabDefinition[] = useMemo(() => [
    { id: 'overview', label: 'Overview', icon: <Sparkles size={14} /> },
    { id: 'content', label: 'Content', icon: <BookMarked size={14} />, count: contentTotal || null },
    { id: 'lessons', label: 'Lesson Plan', icon: <ListOrdered size={14} />, count: sessions?.plan?.estimatedSessions || null },
    { id: 'media', label: 'Media', icon: <Image size={14} />, count: mediaTotal || null },
    { id: 'journey', label: 'Journey', icon: <Compass size={14} /> },
    { id: 'classrooms', label: 'Classrooms', icon: <School size={14} /> },
    { id: 'students', label: 'Students', icon: <GraduationCap size={14} /> },
    ...(isOperator ? [{ id: 'settings', label: 'Settings', icon: <SettingsIcon size={14} /> }] : []),
  ], [contentTotal, mediaTotal, isOperator, sessions]);

  // ── Media fetch helper (supports type filter) ────────
  const fetchMedia = useCallback((typeFilter?: string) => {
    if (!courseId) return;
    setMediaLoading(true);
    const qs = typeFilter && typeFilter !== 'all' ? `?type=${typeFilter}` : '';
    fetch(`/api/courses/${courseId}/media${qs}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setMediaAssets(data.media || []);
          setMediaTotal(data.total || 0);
        } else {
          setMediaAssets([]);
        }
      })
      .catch(() => setMediaAssets([]))
      .finally(() => setMediaLoading(false));
  }, [courseId]);

  // ── Tab change: lazy load classrooms / students / media ──
  const handleTabChange = useCallback((tab: string) => {
    setActiveTab(tab);
    if (tab === 'classrooms' && classrooms === null && !classroomsLoading) {
      setClassroomsLoading(true);
      fetch(`/api/courses/${courseId}/classrooms`)
        .then((r) => r.json())
        .then((data) => { if (data.ok) setClassrooms(data.classrooms || []); else setClassrooms([]); })
        .catch(() => setClassrooms([]))
        .finally(() => setClassroomsLoading(false));
    }
    if (tab === 'students' && students === null && !studentsLoading) {
      setStudentsLoading(true);
      fetch(`/api/courses/${courseId}/students`)
        .then((r) => r.json())
        .then((data) => { if (data.ok) setStudents(data.students || []); else setStudents([]); })
        .catch(() => setStudents([]))
        .finally(() => setStudentsLoading(false));
    }
    if (tab === 'media' && mediaAssets === null && !mediaLoading) {
      fetchMedia();
    }
    if (tab === 'lessons' && sessions === null && !sessionsLoading) {
      setSessionsLoading(true);
      setSessionsError(null);
      fetch(`/api/courses/${courseId}/sessions?includeProgress=true`)
        .then((r) => r.json())
        .then((data) => {
          if (data.ok) {
            setSessions(data);
            // Fetch session TPs if curriculum exists
            if (data.curriculumId && !tpLoaded) {
              fetch(`/api/curricula/${data.curriculumId}/session-assertions`)
                .then((r) => r.json())
                .then((tpData) => {
                  if (tpData.ok) {
                    const bySession: Record<number, TPItem[]> = {};
                    if (tpData.sessions) {
                      for (const [key, group] of Object.entries(tpData.sessions)) {
                        bySession[Number(key)] = (group as any).assertions || [];
                      }
                    }
                    setSessionTPs(bySession);
                    setUnassignedTPs(tpData.unassigned || []);
                    setTpLoaded(true);
                  }
                })
                .catch(() => {}); // silent — TPs are supplementary
              // Fetch session media map
              setMediaMapLoading(true);
              fetch(`/api/curricula/${data.curriculumId}/lesson-plan/media-map`)
                .then((r) => r.json())
                .then((mmData) => { if (mmData.ok) setSessionMediaMap(mmData); })
                .catch(() => {}) // silent — media map is supplementary
                .finally(() => setMediaMapLoading(false));
            }
          } else {
            setSessionsError(data.error || 'Failed to load sessions');
          }
        })
        .catch((e) => setSessionsError(e instanceof Error ? e.message : 'Network error'))
        .finally(() => setSessionsLoading(false));
    }
  }, [courseId, classrooms, classroomsLoading, students, studentsLoading, mediaAssets, mediaLoading, fetchMedia, sessions, sessionsLoading]);

  // Re-fetch media when type filter changes
  useEffect(() => {
    if (activeTab === 'media') {
      fetchMedia(mediaTypeFilter);
    }
  }, [mediaTypeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

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
        setDrillStates(prev => {
          const combined = [...prev[method].items, ...(data.assertions || [])];
          const seen = new Set<string>();
          const deduped = combined.filter(item => !seen.has(item.id) && !!seen.add(item.id));
          return {
            ...prev,
            [method]: {
              items: deduped,
              total: data.total || prev[method].total,
              loading: false,
              error: null,
            },
          };
        });
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

  const handleEditDescription = () => {
    setDescDraft(detail?.description ?? '');
    setEditingDescription(true);
  };

  const handleCancelDescription = () => {
    setEditingDescription(false);
    setDescDraft('');
  };

  const handleSaveDescription = async () => {
    if (!detail) return;
    setSavingDescription(true);
    try {
      const res = await fetch(`/api/playbooks/${detail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: descDraft }),
      });
      const data = await res.json();
      if (data.ok) {
        setDetail((prev) => prev ? { ...prev, description: descDraft } : prev);
        setEditingDescription(false);
      } else {
        setError(data.error || 'Failed to save description');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save description');
    } finally {
      setSavingDescription(false);
    }
  };

  // ── Regenerate lesson plan (sessions tab) ────────────
  const handleRegenerate = useCallback(async () => {
    if (!sessions?.curriculumId || regenerating) return;
    setRegenerating(true);
    setSessionsError(null);
    try {
      const res = await fetch(`/api/curricula/${sessions.curriculumId}/lesson-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Failed to start generation');

      // Poll for task completion
      const taskId = data.taskId;
      const poll = async () => {
        try {
          const pollRes = await fetch(`/api/tasks?taskId=${taskId}`);
          if (!pollRes.ok) { setTimeout(poll, 2000); return; }
          const pollData = await pollRes.json();
          const task = pollData.task || pollData.tasks?.[0] || pollData.guidance?.task;
          if (!task) { setTimeout(poll, 2000); return; }
          const ctx = task.context || {};

          if (task.status === 'completed') {
            // Save generated plan to curriculum
            const plan = ctx.plan;
            if (plan && sessions.curriculumId) {
              await fetch(`/api/curricula/${sessions.curriculumId}/lesson-plan`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entries: plan }),
              });
            }
            // Re-fetch sessions to get the saved plan
            const refreshRes = await fetch(`/api/courses/${courseId}/sessions`);
            const refreshData = await refreshRes.json();
            if (refreshData.ok) setSessions(refreshData);
            // Re-fetch TP assignments (plan changed, old assignments are stale)
            if (sessions.curriculumId) {
              fetch(`/api/curricula/${sessions.curriculumId}/session-assertions`)
                .then((r) => r.json())
                .then((tpData) => {
                  if (tpData.ok) {
                    const bySession: Record<number, TPItem[]> = {};
                    if (tpData.sessions) {
                      for (const [key, group] of Object.entries(tpData.sessions)) {
                        bySession[Number(key)] = (group as any).assertions || [];
                      }
                    }
                    setSessionTPs(bySession);
                    setUnassignedTPs(tpData.unassigned || []);
                  }
                })
                .catch(() => {});
            }
            setRegenerating(false);
          } else if (task.status === 'abandoned' || task.status === 'failed') {
            setSessionsError(ctx.error || 'Regeneration failed');
            setRegenerating(false);
          } else if (task.status === 'in_progress' && ctx.error) {
            setSessionsError(ctx.error);
            setRegenerating(false);
          } else {
            setTimeout(poll, 2000);
          }
        } catch {
          // Network error — keep polling
          setTimeout(poll, 2000);
        }
      };
      poll();
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Regeneration failed');
      setRegenerating(false);
    }
  }, [courseId, sessions, regenerating]);

  const handleRetrySessionsLoad = useCallback(() => {
    setSessionsError(null);
    setSessions(null);
    setSessionsLoading(true);
    fetch(`/api/courses/${courseId}/sessions`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setSessions(data);
        else setSessionsError(data.error || 'Failed to load sessions');
      })
      .catch((e) => setSessionsError(e instanceof Error ? e.message : 'Network error'))
      .finally(() => setSessionsLoading(false));
  }, [courseId]);

  // ── TP move handler (course detail — persists via PUT) ──

  const sessionTPOptions: SessionOption[] = useMemo(
    () => (sessions?.plan?.entries || []).map((e, i) => ({ session: i + 1, label: e.label })),
    [sessions],
  );

  const handleTPMove = useCallback((assertionId: string, toSession: number) => {
    let movedTp: TPItem | undefined;

    setSessionTPs((prev) => {
      const next: Record<number, TPItem[]> = {};
      for (const [key, tps] of Object.entries(prev)) {
        const found = tps.find((tp) => tp.id === assertionId);
        if (found) movedTp = found;
        next[Number(key)] = tps.filter((tp) => tp.id !== assertionId);
      }
      return next;
    });

    setUnassignedTPs((prev) => {
      const found = prev.find((tp) => tp.id === assertionId);
      if (found) movedTp = found;
      return prev.filter((tp) => tp.id !== assertionId);
    });

    queueMicrotask(() => {
      if (!movedTp) return;
      const tp = movedTp;
      if (toSession === 0) {
        setUnassignedTPs((prev) => [...prev, tp]);
      } else {
        setSessionTPs((prev) => ({
          ...prev,
          [toSession]: [...(prev[toSession] || []), tp],
        }));
      }

      if (sessions?.curriculumId && sessions?.plan?.entries) {
        const updatedEntries = sessions.plan.entries.map((e, i) => {
          const session = i + 1;
          const currentIds = (e.assertionIds || []).filter((id) => id !== assertionId);
          if (session === toSession) currentIds.push(assertionId);
          return { ...e, assertionIds: currentIds.length > 0 ? currentIds : undefined };
        });
        setSessions((prev) => prev ? {
          ...prev,
          plan: prev.plan ? { ...prev.plan, entries: updatedEntries } : null,
        } : null);
        fetch(`/api/curricula/${sessions.curriculumId}/lesson-plan`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entries: updatedEntries }),
        }).catch(() => {});
      }
    });
  }, [sessions]);

  // ── Session media handlers (add/remove images from sessions) ──

  const handleRemoveSessionImage = useCallback((sessionNum: number, mediaId: string) => {
    if (!sessions?.curriculumId || !sessions?.plan?.entries) return;
    // Optimistic: move image from session → unassigned in local state
    setSessionMediaMap((prev) => {
      if (!prev) return prev;
      let removedImage: MediaRef | undefined;
      const updatedSessions = prev.sessions.map((s) => {
        if (s.session === sessionNum) {
          removedImage = s.images.find((img) => img.mediaId === mediaId);
          return { ...s, images: s.images.filter((img) => img.mediaId !== mediaId) };
        }
        return s;
      });
      return {
        ...prev,
        sessions: updatedSessions,
        unassigned: removedImage ? [...prev.unassigned, removedImage] : prev.unassigned,
        stats: {
          ...prev.stats,
          assigned: prev.stats.assigned - (removedImage ? 1 : 0),
          unassigned: prev.stats.unassigned + (removedImage ? 1 : 0),
        },
      };
    });
    // Persist: update lesson plan entries with media[] changes
    const updatedEntries = sessions.plan.entries.map((e) => {
      if (e.session === sessionNum) {
        const existingMedia = sessionMediaMap?.sessions?.find((s) => s.session === sessionNum)?.images || [];
        return { ...e, media: existingMedia.filter((m) => m.mediaId !== mediaId) };
      }
      return e;
    });
    fetch(`/api/curricula/${sessions.curriculumId}/lesson-plan`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: updatedEntries }),
    }).catch(() => {});
  }, [sessions, sessionMediaMap]);

  const handleAssignImageToSession = useCallback((mediaId: string, sessionNum: number) => {
    if (!sessions?.curriculumId || !sessions?.plan?.entries) return;
    // Optimistic: move image from unassigned → session
    setSessionMediaMap((prev) => {
      if (!prev) return prev;
      const img = prev.unassigned.find((u) => u.mediaId === mediaId);
      if (!img) return prev;
      return {
        ...prev,
        sessions: prev.sessions.map((s) =>
          s.session === sessionNum ? { ...s, images: [...s.images, img] } : s,
        ),
        unassigned: prev.unassigned.filter((u) => u.mediaId !== mediaId),
        stats: {
          ...prev.stats,
          assigned: prev.stats.assigned + 1,
          unassigned: prev.stats.unassigned - 1,
        },
      };
    });
    // Persist
    const updatedEntries = sessions.plan.entries.map((e) => {
      if (e.session === sessionNum) {
        const existingMedia = sessionMediaMap?.sessions?.find((s) => s.session === sessionNum)?.images || [];
        const img = sessionMediaMap?.unassigned.find((u) => u.mediaId === mediaId);
        const newMedia = img ? [...existingMedia, img] : existingMedia;
        return { ...e, media: newMedia };
      }
      return e;
    });
    fetch(`/api/curricula/${sessions.curriculumId}/lesson-plan`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: updatedEntries }),
    }).catch(() => {});
  }, [sessions, sessionMediaMap]);

  const handleReorderSessionImages = useCallback((sessionNum: number, fromIdx: number, toIdx: number) => {
    if (!sessions?.curriculumId || !sessions?.plan?.entries) return;
    setSessionMediaMap((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        sessions: prev.sessions.map((s) => {
          if (s.session !== sessionNum) return s;
          const imgs = [...s.images];
          const [moved] = imgs.splice(fromIdx, 1);
          imgs.splice(toIdx, 0, moved);
          return { ...s, images: imgs };
        }),
      };
    });
    // Persist reordered media
    const sm = sessionMediaMap?.sessions?.find((s) => s.session === sessionNum);
    if (sm) {
      const imgs = [...sm.images];
      const [moved] = imgs.splice(fromIdx, 1);
      imgs.splice(toIdx, 0, moved);
      const updatedEntries = sessions.plan.entries.map((e) =>
        e.session === sessionNum ? { ...e, media: imgs } : e,
      );
      fetch(`/api/curricula/${sessions.curriculumId}/lesson-plan`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: updatedEntries }),
      }).catch(() => {});
    }
  }, [sessions, sessionMediaMap]);

  const handleDropOnSession = useCallback((sessionNum: number) => {
    if (!dragMediaId) return;
    handleAssignImageToSession(dragMediaId, sessionNum);
    setDragMediaId(null);
  }, [dragMediaId, handleAssignImageToSession]);

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
        <div className="hf-banner hf-banner-error">
          {error || 'Course not found'}
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────
  return (
    <div className="hf-page-container hf-page-scroll">
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
        <div className="hf-flex hf-gap-sm">
          <button
            className="hf-btn hf-btn-secondary hf-nowrap"
            onClick={() => setShowSimModal(true)}
          >
            <PlayCircle size={14} />
            Try It
          </button>
          <Link
            href={`/x/playbooks/${detail.id}`}
            className="hf-btn hf-btn-secondary hf-nowrap"
          >
            <ExternalLink size={14} />
            Open Editor
          </Link>
        </div>
      </div>

      {/* Editable description */}
      {editingDescription ? (
        <div className="hf-mb-lg">
          <textarea
            className="hf-textarea hf-w-full hf-mb-sm"
            rows={3}
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') handleCancelDescription(); }}
            autoFocus
          />
          <div className="hf-flex hf-gap-xs">
            <button onClick={handleSaveDescription} disabled={savingDescription} className="hf-btn-sm hf-btn-primary">
              {savingDescription ? 'Saving...' : 'Save'}
            </button>
            <button onClick={handleCancelDescription} className="hf-btn-sm hf-btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      ) : detail.description ? (
        <button onClick={isOperator ? handleEditDescription : undefined} className={`hf-text-sm hf-text-muted hf-mb-lg hf-text-left${isOperator ? ' hf-btn-ghost' : ''}`}>
          {detail.description}
          {isOperator && <Pencil size={12} className="hf-ml-sm hf-text-placeholder" />}
        </button>
      ) : isOperator ? (
        <button onClick={handleEditDescription} className="hf-btn-ghost hf-text-xs hf-text-placeholder hf-mb-lg">
          + Add description
        </button>
      ) : null}

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
        onTabChange={handleTabChange}
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

          {/* Teaching Approach summary — shows subject profiles */}
          {subjects.some((s) => s.teachingProfile) && (
            <div className="hf-card-compact hf-mb-lg">
              <div className="hf-flex hf-gap-sm hf-items-center hf-mb-sm">
                <Sparkles size={15} className="hf-text-accent" />
                <span className="hf-text-xs hf-text-bold hf-text-muted hf-uppercase">Teaching Approach</span>
              </div>
              {subjects.filter((s) => s.teachingProfile).map((sub) => {
                const profile = getTeachingProfile(sub.teachingProfile);
                if (!profile) return null;
                const modeLabel = TEACHING_MODE_LABELS[profile.teachingMode as TeachingMode]?.label ?? profile.teachingMode;
                const patternLabel = INTERACTION_PATTERN_LABELS[profile.interactionPattern as InteractionPattern]?.label ?? profile.interactionPattern;
                return (
                  <div key={sub.id} className="hf-mb-sm">
                    <div className="hf-flex hf-gap-sm hf-items-center hf-text-sm">
                      <strong>{sub.name}</strong>
                      <span className="hf-badge hf-badge-sm hf-badge-accent">{profile.key}</span>
                    </div>
                    <p className="hf-text-xs hf-text-muted hf-mt-xs hf-mb-0">
                      {profile.description}
                    </p>
                    <div className="hf-flex hf-gap-md hf-text-xs hf-text-muted hf-mt-xs">
                      <span>Teaching mode: {modeLabel}</span>
                      <span>Interaction: {patternLabel}</span>
                    </div>
                    <div className="hf-text-xs hf-text-muted hf-mt-xs">
                      Best for: {profile.bestFor}
                    </div>
                  </div>
                );
              })}
              {/* Editable teaching focus (course-level override) */}
              {isOperator && (
                <div className="hf-mt-md" style={{ padding: 12, border: '1px solid var(--border-default)', borderRadius: 8 }}>
                  <label className="hf-label hf-text-xs">Teaching Focus (course-level)</label>
                  <textarea
                    value={teachingFocusDraft}
                    onChange={(e) => { setTeachingFocusDraft(e.target.value); setTeachingFocusSaved(false); }}
                    placeholder={(() => {
                      const sub = subjects.find((s) => s.teachingProfile);
                      if (!sub) return 'Describe what students should take away...';
                      const resolved = resolveTeachingProfile(sub);
                      return resolved?.teachingFocus || 'Describe what students should take away...';
                    })()}
                    className="hf-input hf-text-sm"
                    rows={3}
                    style={{ width: '100%', resize: 'vertical' }}
                  />
                  <div className="hf-flex hf-gap-sm hf-items-center hf-mt-xs">
                    <button
                      onClick={async () => {
                        if (!detail) return;
                        setTeachingFocusSaving(true);
                        try {
                          await fetch(`/api/playbooks/${detail.id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ config: { ...(detail.config || {}), teachingFocus: teachingFocusDraft.trim() || null } }),
                          });
                          setTeachingFocusSaved(true);
                          setDetail((prev) => prev ? { ...prev, config: { ...(prev.config || {}), teachingFocus: teachingFocusDraft.trim() || null } } : prev);
                        } finally {
                          setTeachingFocusSaving(false);
                        }
                      }}
                      disabled={teachingFocusSaving}
                      className="hf-btn hf-btn-primary hf-btn-xs"
                    >
                      {teachingFocusSaving ? 'Saving...' : 'Save'}
                    </button>
                    {teachingFocusSaved && <span className="hf-text-xs hf-text-success">Saved</span>}
                    {!teachingFocusDraft && subjects.some((s) => s.teachingProfile) && (
                      <span className="hf-text-xs hf-text-muted">
                        Inherited from subject profile
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Show course reference docs if any exist */}
              {subjects.some((s) => s.sourceCount > 0) && (
                <div className="hf-text-xs hf-text-muted hf-mt-xs">
                  Course-level overrides and uploaded reference docs take priority.
                </div>
              )}
            </div>
          )}

          {/* What You're Teaching */}
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
              {subjects.map((sub) => (
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

        </>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* JOURNEY TAB                                    */}
      {/* ═══════════════════════════════════════════════ */}
      {activeTab === 'journey' && detail && (
        <StudentJourneyTab
          courseId={courseId}
          domainId={detail.domain.id}
          domainName={detail.domain.name}
          isOperator={isOperator}
        />
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
              <p className="hf-text-xs hf-text-muted hf-mb-md">
                Teaching points will appear here once you upload content and run extraction.
              </p>
              {isOperator && subjects.length > 0 && (
                <div className="hf-flex hf-gap-sm hf-flex-wrap">
                  {subjects.map((sub) => (
                    <Link
                      key={sub.id}
                      href={`/x/courses/${courseId}/subjects/${sub.id}`}
                      className="hf-btn-sm hf-btn-primary"
                    >
                      <Upload size={13} />
                      Upload to {sub.name}
                    </Link>
                  ))}
                </div>
              )}
              {isOperator && subjects.length === 0 && (
                <Link href={`/x/courses/new?domainId=${detail.domain.id}`} className="hf-btn hf-btn-primary">
                  <Plus size={14} />
                  Set Up Subjects First
                </Link>
              )}
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

              {/* Upload content CTA */}
              {isOperator && subjects.length > 0 && (
                <div className="hf-card-compact hf-mt-lg">
                  <div className="hf-flex hf-gap-sm hf-items-center hf-mb-sm">
                    <Upload size={15} className="hf-text-muted" />
                    <span className="hf-text-xs hf-text-bold hf-text-muted hf-uppercase">
                      Upload more content
                    </span>
                  </div>
                  <p className="hf-text-xs hf-text-muted hf-mb-sm">
                    Add files to your subjects to generate more teaching points.
                  </p>
                  <div className="hf-flex hf-gap-sm hf-flex-wrap">
                    {subjects.map((sub) => (
                      <Link
                        key={sub.id}
                        href={`/x/courses/${courseId}/subjects/${sub.id}`}
                        className="hf-btn-sm hf-btn-secondary"
                      >
                        <Upload size={13} />
                        {sub.name}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* CLASSROOMS TAB                                 */}
      {/* ═══════════════════════════════════════════════ */}
      {activeTab === 'classrooms' && (
        <div className="hf-mt-lg">
          {classroomsLoading ? (
            <div className="hf-empty-compact">
              <div className="hf-spinner" />
            </div>
          ) : classrooms === null ? null : classrooms.length === 0 ? (
            <div className="hf-empty-compact">
              <School size={36} className="hf-text-tertiary hf-mb-sm" />
              <div className="hf-heading-sm hf-text-secondary hf-mb-sm">No classrooms yet</div>
              <p className="hf-text-xs hf-text-muted hf-mb-md">
                Classrooms using this course will appear here once cohorts are assigned.
              </p>
              {isOperator && (
                <Link href="/x/educator/classrooms/new" className="hf-btn hf-btn-primary">
                  <Plus size={14} />
                  Create Classroom
                </Link>
              )}
            </div>
          ) : (
            <>
              <div className="hf-flex hf-flex-between hf-items-center hf-mb-md">
                <span className="hf-text-xs hf-text-bold hf-text-muted hf-uppercase">
                  {classrooms.length} classroom{classrooms.length !== 1 ? 's' : ''}
                </span>
                {isOperator && (
                  <Link href="/x/educator/classrooms/new" className="hf-btn-sm hf-btn-secondary">
                    <Plus size={13} />
                    Create Classroom
                  </Link>
                )}
              </div>
              <div className="hf-flex hf-flex-col hf-gap-xs">
                {classrooms.map((cl) => {
                  const fillPct = cl.maxMembers ? Math.min(100, Math.round((cl.memberCount / cl.maxMembers) * 100)) : 0;
                  return (
                    <Link key={cl.id} href={`/x/cohorts/${cl.id}`} className="hf-list-row hf-list-row-link">
                      <div className="hf-icon-box hf-flex-shrink-0">
                        <School size={16} className="hf-text-muted" />
                      </div>
                      <div className="hf-flex-1 hf-min-w-0">
                        <div className="hf-text-sm hf-text-bold hf-text-ellipsis">{cl.name}</div>
                        {cl.institutionName && (
                          <div className="hf-text-xs hf-text-muted">{cl.institutionName}</div>
                        )}
                      </div>
                      <div className="hf-flex hf-gap-sm hf-items-center hf-flex-shrink-0">
                        {cl.maxMembers ? (
                          <>
                            <div className="cd-fill-bar">
                              <div className="cd-fill-bar-fill" style={{ width: `${fillPct}%` }} />
                            </div>
                            <span className="hf-text-xs hf-text-muted">{cl.memberCount}/{cl.maxMembers}</span>
                          </>
                        ) : (
                          <span className="hf-text-xs hf-text-muted">
                            <Users2 size={12} className="hf-icon-inline" /> {cl.memberCount}
                          </span>
                        )}
                        <ChevronRight size={14} className="hf-text-placeholder" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* STUDENTS TAB                                   */}
      {/* ═══════════════════════════════════════════════ */}
      {activeTab === 'students' && (
        <div className="hf-mt-lg">
          {studentsLoading ? (
            <div className="hf-empty-compact">
              <div className="hf-spinner" />
            </div>
          ) : students === null ? null : students.length === 0 ? (
            <div className="hf-empty-compact">
              <GraduationCap size={36} className="hf-text-tertiary hf-mb-sm" />
              <div className="hf-heading-sm hf-text-secondary hf-mb-sm">No students enrolled</div>
              <p className="hf-text-xs hf-text-muted">
                Students enrolled in classrooms using this course will appear here.
              </p>
            </div>
          ) : (
            <>
              <div className="hf-flex hf-flex-between hf-items-center hf-mb-md">
                <span className="hf-text-xs hf-text-bold hf-text-muted hf-uppercase">
                  {students.length} student{students.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="hf-flex hf-flex-col hf-gap-xs">
                {students.map((st) => (
                  <Link key={st.id} href={`/x/callers/${st.id}`} className="hf-list-row hf-list-row-link">
                    <div className="hf-icon-box hf-flex-shrink-0">
                      <GraduationCap size={16} className="hf-text-muted" />
                    </div>
                    <div className="hf-flex-1 hf-min-w-0">
                      <div className="hf-text-sm hf-text-bold hf-text-ellipsis">
                        {st.name || st.email}
                      </div>
                      {st.name && (
                        <div className="hf-text-xs hf-text-muted">{st.email}</div>
                      )}
                    </div>
                    <div className="hf-flex hf-gap-sm hf-items-center hf-flex-shrink-0 hf-text-xs hf-text-muted">
                      {st.callCount > 0 && (
                        <span>{st.callCount} call{st.callCount !== 1 ? 's' : ''}</span>
                      )}
                      {st.lastCallAt && (
                        <span>Last: {new Date(st.lastCallAt).toLocaleDateString()}</span>
                      )}
                      <ChevronRight size={14} className="hf-text-placeholder" />
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* LESSON PLAN TAB                                */}
      {/* ═══════════════════════════════════════════════ */}
      {activeTab === 'lessons' && (
        <div className="hf-mt-lg">
          {sessionsLoading ? (
            /* Loading state */
            <div className="hf-empty-compact">
              <div className="hf-spinner" />
            </div>
          ) : sessionsError ? (
            /* Error state */
            <div className="hf-flex-col hf-items-center hf-gap-sm hf-py-xl">
              <div className="hf-banner hf-banner-error">
                <AlertTriangle size={14} />
                <span>{sessionsError}</span>
              </div>
              <button onClick={handleRetrySessionsLoad} className="hf-btn hf-btn-secondary hf-btn-sm">
                Retry
              </button>
            </div>
          ) : sessions?.plan && sessions.plan.entries.length > 0 ? (
            /* Populated: plan header + session cards */
            <>
              {/* ── Plan Header Card ──────────────────── */}
              <div className="cd-plan-header hf-card hf-mb-lg">
                <div className="hf-flex hf-flex-between hf-items-center hf-mb-sm">
                  <div className="hf-flex hf-items-center hf-gap-sm">
                    <Sparkles size={18} className="hf-text-accent" />
                    <span className="hf-section-title hf-mb-0">Your Lesson Plan</span>
                  </div>
                  {isOperator && sessions.curriculumId && (
                    <button onClick={handleRegenerate} disabled={regenerating} className="hf-btn hf-btn-secondary hf-btn-sm">
                      {regenerating ? (
                        <><div className="hf-spinner hf-spinner-xs" /> Regenerating...</>
                      ) : (
                        <><RefreshCw size={13} /> Regenerate Plan</>
                      )}
                    </button>
                  )}
                </div>
                <div className="hf-flex hf-items-center hf-gap-md hf-mb-sm">
                  <span className="hf-text-sm hf-text-primary">
                    {sessions.plan.entries.length} session{sessions.plan.entries.length !== 1 ? 's' : ''}
                  </span>
                  {sessions.plan.model && (
                    <span className="hf-chip hf-chip-sm">{getLessonPlanModel(sessions.plan.model).label}</span>
                  )}
                  {totalTPs > 0 && (
                    <span className="hf-text-xs hf-text-muted">{totalTPs} teaching points</span>
                  )}
                  {totalSessionDuration > 0 && (
                    <span className="hf-text-xs hf-text-muted">~{totalSessionDuration} min total</span>
                  )}
                </div>
                <PlanSummary
                  state={regenerating ? "generating" : "ready"}
                  sessions={sessions.plan.entries.map((e) => ({ type: e.type, label: e.label }))}
                />
                {sessions.plan.generatedAt && (
                  <div className="hf-text-xs hf-text-muted hf-mt-sm">
                    Generated {new Date(sessions.plan.generatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                )}
              </div>

              {/* ── Sessions heading ──────────────────── */}
              <div className="hf-flex hf-items-center hf-gap-sm hf-mb-md">
                <span className="hf-section-title hf-mb-0">Sessions</span>
                <span className="hf-text-xs hf-text-muted">
                  {SESSION_TYPES.map((t) => {
                    const count = sessions.plan!.entries.filter((e) => e.type === t.value).length;
                    return count > 0 ? `${count} ${t.label.toLowerCase()}` : null;
                  }).filter(Boolean).join(' \u00b7 ')}
                </span>
              </div>
              <div className="hf-card-compact">
                {sessions.plan.entries.map((entry, i) => {
                  const typeColor = getSessionTypeColor(entry.type);
                  const typeLabel = getSessionTypeLabel(entry.type);
                  const TypeIcon = SESSION_TYPE_ICONS[entry.type];
                  const allMethods = [...new Set((entry.phases ?? []).flatMap((p) => p.teachMethods ?? []))];

                  return (
                    <div key={`sess-${i}`}>
                      <div
                        className="hf-session-row cd-session-row-clickable"
                        style={{ '--session-color': typeColor } as React.CSSProperties}
                        onClick={() => router.push(`/x/courses/${courseId}/sessions/${entry.session}`)}
                        role="link"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/x/courses/${courseId}/sessions/${entry.session}`); }}
                      >
                        <span className="hf-session-num">{i + 1}</span>
                        {TypeIcon && <TypeIcon size={12} className="cd-session-icon" style={{ color: 'var(--session-color)' }} />}
                        <span className="hf-session-type cd-session-type">
                          {typeLabel}
                        </span>
                        <span className="hf-session-label">{entry.label}</span>
                        {(sessionTPs[i + 1]?.length || entry.assertionCount) ? (
                          <span className="hf-session-tp-badge" title="Teaching points">
                            <BookOpen size={10} />
                            {sessionTPs[i + 1]?.length || entry.assertionCount} TPs
                          </span>
                        ) : null}
                        {(() => {
                          const sm = sessionMediaMap?.sessions?.find((s) => s.session === entry.session);
                          return sm && sm.images.length > 0 ? (
                            <span className="hf-session-media-badge" title={`${sm.images.length} image${sm.images.length > 1 ? 's' : ''}`}>
                              🖼 {sm.images.length}
                            </span>
                          ) : null;
                        })()}
                        {entry.learningOutcomeRefs?.length ? (
                          <span className="hf-session-lo-badges">
                            {entry.learningOutcomeRefs.map((lo) => (
                              <span key={lo} className="hf-session-lo-chip">{lo}</span>
                            ))}
                          </span>
                        ) : null}
                        {entry.estimatedDurationMins ? (
                          <span className="hf-session-meta">{entry.estimatedDurationMins}m</span>
                        ) : null}
                        {(entry.phases?.length || (sessionTPs[i + 1]?.length ?? 0) > 0) ? (
                          <button
                            className="hf-session-expand-btn"
                            onClick={(e) => { e.stopPropagation(); setExpandedSession(expandedSession === i ? null : i); }}
                            title={expandedSession === i ? 'Collapse details' : 'Show details'}
                          >
                            <span className={`hf-chevron--sm${expandedSession === i ? ' hf-chevron--open' : ''}`} />
                          </button>
                        ) : null}
                      </div>
                      {allMethods.length > 0 && (
                        <div className="hf-session-methods-bar">
                          <Zap size={10} className="hf-session-methods-icon" />
                          {allMethods.map((m) => (
                            <span key={m} className="hf-chip hf-chip-sm">{m}</span>
                          ))}
                        </div>
                      )}
                      {expandedSession === i && entry.phases?.length ? (
                        <div className="hf-session-phases">
                          {entry.phases.map((phase, pi) => (
                            <div key={phase.id + pi} className="hf-session-phase">
                              <div className="hf-session-phase-header">
                                <span className="hf-session-phase-label">{phase.label}</span>
                                {phase.durationMins && (
                                  <span className="hf-session-phase-dur">{phase.durationMins}m</span>
                                )}
                              </div>
                              {phase.teachMethods?.length ? (
                                <div className="hf-session-phase-methods">
                                  <Zap size={9} className="hf-session-methods-icon" />
                                  {phase.teachMethods.map((m) => (
                                    <span key={m} className="hf-chip hf-chip-sm">{m}</span>
                                  ))}
                                </div>
                              ) : null}
                              {phase.guidance && (
                                <div className="hf-session-phase-guidance">{phase.guidance}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {/* Teaching Points per session */}
                      {expandedSession === i && tpLoaded && (
                        <SessionTPList
                          sessionNumber={i + 1}
                          assertions={sessionTPs[i + 1] || []}
                          sessions={sessionTPOptions}
                          onMove={handleTPMove}
                          readonly={!isOperator}
                        />
                      )}
                      {/* Session images — editable strip with drag reorder + drop zone */}
                      {expandedSession === i && (() => {
                        const sm = sessionMediaMap?.sessions?.find((s) => s.session === entry.session);
                        const hasImages = sm && sm.images.length > 0;
                        const hasUnassigned = (sessionMediaMap?.unassigned?.length ?? 0) > 0;
                        return (
                          <div
                            className={`hf-session-media-strip cd-session-media-editable${dragMediaId ? ' cd-drop-target' : ''}`}
                            onDragOver={(e) => { if (dragMediaId) { e.preventDefault(); e.currentTarget.classList.add('cd-drop-hover'); } }}
                            onDragLeave={(e) => e.currentTarget.classList.remove('cd-drop-hover')}
                            onDrop={(e) => { e.currentTarget.classList.remove('cd-drop-hover'); handleDropOnSession(entry.session); }}
                          >
                            {hasImages ? sm.images.map((img, imgIdx) => (
                              <div
                                key={img.mediaId}
                                className="hf-session-media-thumb"
                                title={img.captionText || img.figureRef || img.fileName}
                                draggable={isOperator}
                                onDragStart={(e) => { e.dataTransfer.setData('text/plain', `reorder:${imgIdx}`); e.dataTransfer.effectAllowed = 'move'; }}
                                onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('cd-img-drag-over'); }}
                                onDragLeave={(e) => e.currentTarget.classList.remove('cd-img-drag-over')}
                                onDrop={(e) => {
                                  e.stopPropagation();
                                  e.currentTarget.classList.remove('cd-img-drag-over');
                                  const data = e.dataTransfer.getData('text/plain');
                                  if (data.startsWith('reorder:')) {
                                    const fromIdx = parseInt(data.split(':')[1], 10);
                                    if (!isNaN(fromIdx) && fromIdx !== imgIdx) handleReorderSessionImages(entry.session, fromIdx, imgIdx);
                                  }
                                }}
                              >
                                {img.mimeType.startsWith('image/') ? (
                                  <img
                                    src={`/api/media/${img.mediaId}`}
                                    alt={img.captionText || img.figureRef || ''}
                                    onClick={() => setLightboxImage(img)}
                                    style={{ cursor: 'pointer' }}
                                  />
                                ) : (
                                  <span className="hf-session-media-icon" onClick={() => setLightboxImage(img)} style={{ cursor: 'pointer' }}>{img.figureRef || 'File'}</span>
                                )}
                                {isOperator && (
                                  <button
                                    className="hf-session-media-remove"
                                    onClick={(e) => { e.stopPropagation(); handleRemoveSessionImage(entry.session, img.mediaId); }}
                                    title="Remove from session"
                                  >✕</button>
                                )}
                              </div>
                            )) : isOperator && hasUnassigned ? (
                              <span className="hf-text-xs hf-text-muted cd-no-images-hint">
                                <Image size={12} /> No images — drag from unassigned below or use the dropdown
                              </span>
                            ) : null}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
              {/* Unassigned Teaching Points */}
              {tpLoaded && unassignedTPs.length > 0 && (
                <UnassignedTPList
                  assertions={unassignedTPs}
                  sessions={sessionTPOptions}
                  onMove={handleTPMove}
                />
              )}
              {/* Unassigned Images */}
              {sessionMediaMap && sessionMediaMap.unassigned.length > 0 && (() => {
                const filtered = unassignedSearch
                  ? sessionMediaMap.unassigned.filter((img) => {
                      const q = unassignedSearch.toLowerCase();
                      return (img.fileName?.toLowerCase().includes(q)) ||
                        (img.captionText?.toLowerCase().includes(q)) ||
                        (img.figureRef?.toLowerCase().includes(q));
                    })
                  : sessionMediaMap.unassigned;
                const PAGE_SIZE = 12;
                const shown = filtered.slice(0, PAGE_SIZE);
                const remaining = filtered.length - PAGE_SIZE;
                return (
                  <div className="hf-card-compact hf-mt-md cd-unassigned-images">
                    <div className="hf-flex hf-flex-between hf-items-center hf-mb-sm">
                      <span className="hf-section-title hf-text-sm">
                        <Image size={14} /> Unassigned Images ({sessionMediaMap.unassigned.length})
                      </span>
                      <div className="hf-flex hf-gap-sm hf-items-center">
                        {sessionMediaMap.unassigned.length > 6 && (
                          <input
                            type="text"
                            className="hf-input hf-input-xs"
                            placeholder="Filter images…"
                            value={unassignedSearch}
                            onChange={(e) => setUnassignedSearch(e.target.value)}
                            style={{ width: 140 }}
                          />
                        )}
                        <span className="hf-text-xs hf-text-muted">
                          {sessionMediaMap.stats.assigned} of {sessionMediaMap.stats.total} assigned
                        </span>
                      </div>
                    </div>
                    <div className="hf-session-media-grid">
                      {shown.map((img) => (
                        <div
                          key={img.mediaId}
                          className="hf-session-media-card"
                          draggable={isOperator}
                          onDragStart={(e) => { setDragMediaId(img.mediaId); e.dataTransfer.setData('text/plain', `assign:${img.mediaId}`); e.dataTransfer.effectAllowed = 'move'; }}
                          onDragEnd={() => setDragMediaId(null)}
                        >
                          <div className="hf-session-media-card-thumb" onClick={() => setLightboxImage(img)} style={{ cursor: 'pointer' }}>
                            {img.mimeType.startsWith('image/') ? (
                              <img src={`/api/media/${img.mediaId}`} alt={img.captionText || img.figureRef || ''} />
                            ) : (
                              <span className="hf-session-media-icon">{img.figureRef || 'File'}</span>
                            )}
                          </div>
                          <div className="hf-session-media-card-label">
                            {img.figureRef || img.captionText || img.fileName}
                          </div>
                          {isOperator && sessions?.plan?.entries && (
                            <select
                              className="hf-input hf-input-xs"
                              defaultValue=""
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                if (val > 0) handleAssignImageToSession(img.mediaId, val);
                                e.target.value = '';
                              }}
                            >
                              <option value="" disabled>Assign to session…</option>
                              {sessions.plan.entries.map((se) => (
                                <option key={se.session} value={se.session}>
                                  S{se.session}: {se.label}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      ))}
                    </div>
                    {remaining > 0 && (
                      <p className="hf-text-xs hf-text-muted hf-mt-sm">
                        +{remaining} more — use the filter to find specific images
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* ── Class Progress ─────────────────── */}
              {sessions.studentProgress && sessions.studentProgress.length > 0 && (
                <div className="hf-mt-xl">
                  <div className="hf-flex hf-flex-between hf-items-center hf-mb-md">
                    <div className="hf-flex hf-items-center hf-gap-sm">
                      <Users2 size={16} className="hf-text-muted" />
                      <span className="hf-section-title hf-mb-0">Class Progress</span>
                    </div>
                    <span className="hf-text-xs hf-text-muted">{sessions.studentProgress.length} enrolled</span>
                  </div>
                  <div className="hf-card-compact cd-progress-section">
                    {sessions.plan!.entries.map((entry) => {
                      const sp = sessions.studentProgress!;
                      const total = sp.length;
                      const completed = sp.filter((s) => s.currentSession !== null && s.currentSession > entry.session);
                      const active = sp.filter((s) => s.currentSession === entry.session);
                      const reached = completed.length + active.length;
                      const pct = total > 0 ? Math.round((reached / total) * 100) : 0;
                      const allDone = total > 0 && completed.length === total;
                      const hasActive = active.length > 0;
                      const typeColor = getSessionTypeColor(entry.type);

                      return (
                        <div key={entry.session} className="cd-progress-row">
                          <span className="cd-progress-num hf-text-xs hf-text-muted">{entry.session}</span>
                          <span
                            className="cd-session-type hf-text-xs"
                            style={{ '--session-color': typeColor } as React.CSSProperties}
                          >
                            {getSessionTypeLabel(entry.type)}
                          </span>
                          <div className="cd-progress-bar">
                            <div
                              className="cd-progress-fill"
                              style={{
                                width: `${pct}%`,
                                background: allDone
                                  ? 'var(--status-success-text)'
                                  : hasActive
                                    ? 'var(--status-info-text)'
                                    : 'var(--border-default)',
                              }}
                            />
                          </div>
                          <span className="cd-progress-count hf-text-xs">
                            {allDone ? (
                              <span style={{ color: 'var(--status-success-text)' }}>&#10003; {total}</span>
                            ) : hasActive ? (
                              <span style={{ color: 'var(--status-info-text)' }}>&#9654; {active.length}/{total}</span>
                            ) : (
                              <span className="hf-text-muted">{reached}/{total}</span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Active + not-started summary */}
                  {(() => {
                    const sp = sessions.studentProgress!;
                    const active = sp.filter((s) => s.currentSession !== null && s.currentSession > 0);
                    const notStarted = sp.filter((s) => s.currentSession === null);
                    if (active.length === 0 && notStarted.length === 0) return null;
                    return (
                      <div className="hf-mt-sm">
                        {active.length > 0 && (
                          <div className="hf-text-xs hf-text-muted">
                            <span className="hf-text-bold">Active: </span>
                            {active.map((s) => {
                              const se = sessions.plan!.entries.find((e) => e.session === s.currentSession);
                              return `${s.name} \u2192 Session ${s.currentSession}${se ? ` (${getSessionTypeLabel(se.type)})` : ''}`;
                            }).join(' \u00b7 ')}
                          </div>
                        )}
                        {notStarted.length > 0 && (
                          <div className="hf-text-xs hf-text-muted hf-mt-xs">
                            <span className="hf-text-bold">Not started: </span>
                            {notStarted.map((s) => s.name).join(', ')}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* No students enrolled nudge */}
              {sessions.studentProgress && sessions.studentProgress.length === 0 && (
                <div className="hf-mt-xl">
                  <div className="hf-flex hf-items-center hf-gap-sm hf-mb-sm">
                    <Users2 size={16} className="hf-text-muted" />
                    <span className="hf-section-title hf-mb-0">Class Progress</span>
                  </div>
                  <p className="hf-text-sm hf-text-muted">
                    No students enrolled yet. Enrol students in the Students tab.
                  </p>
                </div>
              )}
            </>
          ) : sessions?.modules && sessions.modules.length > 0 ? (
            /* Fallback: modules exist but no plan */
            <div className="hf-empty-compact">
              <ListOrdered size={36} className="hf-text-tertiary hf-mb-sm" />
              <div className="hf-heading-sm hf-text-secondary hf-mb-sm">Lesson plan not yet generated</div>
              <p className="hf-text-xs hf-text-muted hf-mb-md">
                Your curriculum has {sessions.modules.length} module{sessions.modules.length !== 1 ? 's' : ''}. Generate a lesson plan to organise them into sessions.
              </p>
              <div className="hf-card-compact hf-w-full hf-mb-md">
                {sessions.modules.map((mod) => (
                  <div key={mod.id} className="hf-list-row">
                    <span className="hf-text-xs hf-text-bold hf-text-muted">{mod.slug}</span>
                    <span className="hf-text-sm hf-flex-1">{mod.title}</span>
                    {mod.estimatedDurationMinutes ? (
                      <span className="hf-text-xs hf-text-muted">{mod.estimatedDurationMinutes}m</span>
                    ) : null}
                    <span className="hf-text-xs hf-text-muted">{mod.learningObjectiveCount} LOs</span>
                  </div>
                ))}
              </div>
              {isOperator && sessions.curriculumId && (
                <button onClick={handleRegenerate} disabled={regenerating} className="hf-btn hf-btn-primary">
                  {regenerating ? (
                    <><div className="hf-spinner hf-spinner-xs" /> Generating...</>
                  ) : (
                    <><Sparkles size={14} /> Generate Lesson Plan</>
                  )}
                </button>
              )}
            </div>
          ) : (
            /* Empty: no subjects or curriculum */
            <div className="hf-empty-compact">
              <ListOrdered size={36} className="hf-text-tertiary hf-mb-sm" />
              <div className="hf-heading-sm hf-text-secondary hf-mb-sm">No lesson plan yet</div>
              <p className="hf-text-xs hf-text-muted hf-mb-md">
                A lesson plan is created automatically when you set up your course content.
              </p>
              {isOperator && detail && (
                <Link href={`/x/courses/new?domainId=${detail.domain.id}`} className="hf-btn hf-btn-primary">
                  <Plus size={14} />
                  Set Up Course
                </Link>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* MEDIA TAB                                      */}
      {/* ═══════════════════════════════════════════════ */}
      {activeTab === 'media' && (
        <div className="hf-mt-lg">
          {/* Type filter chips */}
          <div className="hf-flex hf-flex-between hf-items-center hf-mb-md">
            <div className="hf-flex hf-gap-sm hf-items-center">
              {['all', 'image', 'pdf', 'audio'].map((f) => (
                <button
                  key={f}
                  onClick={() => setMediaTypeFilter(f)}
                  className={mediaTypeFilter === f ? 'hf-chip hf-chip-selected' : 'hf-chip'}
                >
                  {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            {mediaTotal > 0 && (
              <span className="hf-text-xs hf-text-muted">
                {mediaTotal} file{mediaTotal !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {mediaLoading && !mediaAssets?.length ? (
            <div className="hf-empty-compact">
              <div className="hf-spinner" />
            </div>
          ) : !mediaAssets?.length ? (
            <div className="hf-empty-compact">
              <Image size={36} className="hf-text-tertiary hf-mb-sm" />
              <div className="hf-heading-sm hf-text-secondary hf-mb-sm">No media yet</div>
              <p className="hf-text-xs hf-text-muted">
                Images and figures are automatically extracted when you upload PDFs or DOCX files.
              </p>
            </div>
          ) : (
            <div className="hf-media-grid">
              {mediaAssets.map((m) => {
                const isImage = m.mimeType.startsWith('image/');
                const isPdf = m.mimeType === 'application/pdf';
                const isAudio = m.mimeType.startsWith('audio/');
                const sizeKB = Math.round(m.fileSize / 1024);
                const sizeLabel = sizeKB > 1024 ? `${(sizeKB / 1024).toFixed(1)} MB` : `${sizeKB} KB`;

                return (
                  <div key={m.id} className="hf-media-card">
                    <div className="hf-media-card-preview">
                      {isImage ? (
                        <img
                          src={`/api/media/${m.id}`}
                          alt={m.title || m.fileName}
                          className="hf-media-card-img"
                          loading="lazy"
                        />
                      ) : isPdf ? (
                        <div className="hf-text-center hf-text-muted">
                          <FileText size={32} />
                          <div className="hf-text-xs hf-mt-xs">{sizeLabel}</div>
                        </div>
                      ) : isAudio ? (
                        <div className="hf-text-center hf-text-muted">
                          <div className="hf-text-xl">AUD</div>
                          <div className="hf-text-xs">{sizeLabel}</div>
                        </div>
                      ) : (
                        <div className="hf-text-center hf-text-muted">
                          <FileText size={32} />
                          <div className="hf-text-xs hf-mt-xs">{sizeLabel}</div>
                        </div>
                      )}
                    </div>
                    <div className="hf-media-card-info">
                      <div className="hf-text-xs hf-text-bold hf-truncate" title={m.title || m.fileName}>
                        {m.title || m.fileName}
                      </div>
                      {m.captionText && (
                        <div className="hf-text-xs hf-text-muted hf-line-clamp-2 hf-mt-xs" title={m.captionText}>
                          {m.captionText}
                        </div>
                      )}
                      <div className="hf-flex hf-gap-xs hf-items-center hf-mt-xs hf-flex-wrap">
                        <TrustBadge level={m.trustLevel} />
                        {m.pageNumber != null && (
                          <span className="hf-tag-pill hf-text-xs">p.{m.pageNumber}</span>
                        )}
                        {m.figureRef && (
                          <span className="hf-tag-pill hf-text-xs">{m.figureRef}</span>
                        )}
                      </div>
                      {(m.sourceName || m.subjectName) && (
                        <div className="hf-text-xs hf-text-placeholder hf-mt-xs hf-truncate">
                          {[m.subjectName, m.sourceName].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* SETTINGS TAB                                   */}
      {/* ═══════════════════════════════════════════════ */}
      {activeTab === 'settings' && (
        <div className="hf-mt-lg">
          {isOperator ? (
            <>
              <SectionHeader title="Status" icon={SettingsIcon} />
              <div className="hf-card hf-mb-lg">
                <div className="hf-text-xs hf-text-muted hf-mb-md">
                  Current status: <span className="hf-text-bold">{detail.status}</span>
                </div>
                <div className="hf-flex hf-gap-sm hf-flex-wrap">
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
                </div>
              </div>

              {detail.status === 'DRAFT' && (
                <>
                  <SectionHeader title="Danger Zone" icon={Trash2} />
                  <div className="hf-card hf-mb-lg">
                    {!showDeleteConfirm ? (
                      <button onClick={() => setShowDeleteConfirm(true)} className="hf-btn hf-btn-destructive">
                        Delete Course
                      </button>
                    ) : (
                      <div className="hf-flex hf-gap-xs hf-items-center">
                        <span className="hf-text-xs hf-text-error">Delete permanently?</span>
                        <button onClick={handleDelete} disabled={deleting} className="hf-btn-sm hf-btn-destructive">
                          {deleting ? '...' : 'Yes, delete'}
                        </button>
                        <button onClick={() => setShowDeleteConfirm(false)} className="hf-btn-sm hf-btn-secondary">
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}

              <SectionHeader title="Metadata" icon={FileText} />
              <div className="hf-card">
                <div className="hf-flex hf-gap-lg hf-text-xs hf-text-muted hf-flex-wrap">
                  <span>ID: <span className="hf-mono">{detail.id.slice(0, 8)}...</span></span>
                  <span>Created: {new Date(detail.createdAt).toLocaleDateString()}</span>
                  <span>Updated: {new Date(detail.updatedAt).toLocaleDateString()}</span>
                  {detail.publishedAt && (
                    <span>Published: {new Date(detail.publishedAt).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="hf-banner hf-banner-info">
              You do not have permission to manage course settings.
            </div>
          )}
        </div>
      )}

      {/* Image Lightbox */}
      {lightboxImage && (
        <div className="hf-modal-overlay" onClick={() => setLightboxImage(null)}>
          <div className="cd-lightbox" onClick={(e) => e.stopPropagation()}>
            <button className="cd-lightbox-close" onClick={() => setLightboxImage(null)}>✕</button>
            {lightboxImage.mimeType.startsWith('image/') ? (
              <img
                src={`/api/media/${lightboxImage.mediaId}`}
                alt={lightboxImage.captionText || lightboxImage.figureRef || ''}
                className="cd-lightbox-img"
              />
            ) : (
              <div className="cd-lightbox-fallback">{lightboxImage.fileName}</div>
            )}
            <div className="cd-lightbox-meta">
              {lightboxImage.figureRef && <span className="hf-chip hf-chip-sm">{lightboxImage.figureRef}</span>}
              {lightboxImage.captionText && <p className="hf-text-sm">{lightboxImage.captionText}</p>}
              <p className="hf-text-xs hf-text-muted">{lightboxImage.fileName}</p>
            </div>
          </div>
        </div>
      )}

      {showSimModal && detail && (
        <SimLaunchModal
          playbookId={detail.id}
          domainId={detail.domain.id}
          domainName={detail.domain.name}
          onClose={() => setShowSimModal(false)}
        />
      )}
    </div>
  );
}
