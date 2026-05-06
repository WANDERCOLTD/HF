'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  BookMarked, FileText, ExternalLink, Plus, Pencil, Trash2,
  Sparkles, AlertTriangle, RefreshCw,
  Settings as SettingsIcon, Users2,
  Zap, Target, BarChart3,
  PlayCircle, Copy, Link2, GraduationCap, Wand2,
} from 'lucide-react';
import { useTerminology } from '@/contexts/TerminologyContext';
import { INTERACTION_PATTERN_LABELS, TEACHING_MODE_LABELS } from '@/lib/content-trust/resolve-config';
import { CourseOverviewTab } from './CourseOverviewTab';
import { OnboardingEditor } from '@/components/shared/OnboardingEditor';
import { CourseIntelligenceTab } from './CourseIntelligenceTab';
import { CourseWhoTab } from './CourseWhoTab';
import { CourseGoalsTab } from './CourseGoalsTab';
import { CourseDesignTab } from './CourseDesignTab';
import { SessionFlowEditor } from '@/components/session-flow/SessionFlowEditor';
import { CourseLearnersTab } from './CourseLearnersTab';
import { CourseProofTab } from './CourseProofTab';
import { SessionDetailPanel } from '@/components/shared/SessionDetailPanel';
import { SurveyStopDetail } from '@/components/shared/SurveyStopDetail';
import type { PlaybookConfig, SurveyStepConfig } from '@/lib/types/json-fields';
import { isPreSurveyEnabled } from '@/lib/learner/survey-config';
import { isFormStop } from '@/lib/lesson-plan/session-ui';
import { useSession } from 'next-auth/react';
import { useEntityContext } from '@/contexts/EntityContext';
import { EditableTitle } from '@/components/shared/EditableTitle';
import { StatusBadge, DomainPill } from '@/src/components/shared/EntityPill';
import { DraggableTabs, type TabDefinition } from '@/components/shared/DraggableTabs';
import { type TPItem, type SessionOption } from '@/components/shared/SessionTPList';
import {
  groupSpecs,
  type PlaybookItem,
  type SystemSpec,
  type SpecDetail,
  type SpecGroup,
} from '@/lib/course/group-specs';
import { SimLaunchModal } from '@/components/shared/SimLaunchModal';
import { CourseCurriculumTab } from './CourseCurriculumTab';
import { JourneyRail } from '@/components/shared/JourneyRail';
import { ContinuousProgrammeView } from '@/components/shared/ContinuousProgrammeView';
import { PlanHeaderCard } from '@/components/shared/PlanHeaderCard';
import { CollapsibleCard } from '@/components/shared/CollapsibleCard';
import { SessionFlowPipeline, type InstructionItem } from './CourseHowTab';
import { FullRegenerateModal } from './FullRegenerateModal';
import { reorderItems } from '@/lib/sortable/reorder';
import type { SessionEntry, SessionMediaRef as SessionMediaRefType, SessionMediaMap, StudentProgress } from '@/lib/lesson-plan/types';
import './course-detail.css';
import './course-learners.css';

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

type SubjectSourceDetail = {
  id: string;
  name: string;
  documentType: string;
  extractorVersion: number | null;
  assertionCount: number;
  linkedSourceId: string | null;
  linkedSourceName: string | null;
};

/** Flat source item from /api/courses/:courseId/content-sources (PlaybookSource) */
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
  sources?: SubjectSourceDetail[];
};

type MethodBreakdown = {
  teachMethod: string;
  count: number;
  reviewed: number;
};


// ── Sessions Tab Types ────────────────────────────────
// SessionEntry, SessionMediaRef, StudentProgress imported from @/lib/lesson-plan/types

type ModuleSummary = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  estimatedDurationMinutes: number | null;
  sortOrder: number;
  learningObjectiveCount: number;
};

type SessionTabData = {
  plan: { entries: SessionEntry[]; estimatedSessions: number; generatedAt?: string | null; model?: string | null } | null;
  modules: ModuleSummary[];
  curriculumId: string | null;
  subjectCount: number;
  studentProgress?: StudentProgress[];
};


import { SectionHeader } from './SectionHeader';

const VALID_TABS = ['intelligence', 'design', 'curriculum', 'content', 'learners', 'proof', 'goals', 'session-flow', 'settings',
  // Legacy tab IDs — redirected in handleTabChange
  'overview', 'journey', 'genome', 'audience',
];

const statusMap: Record<string, 'draft' | 'active' | 'archived'> = {
  draft: 'draft',
  published: 'active',
  archived: 'archived',
};

// ── Main Component ─────────────────────────────────────

export default function CourseDetailPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const isOperator = ['OPERATOR', 'EDUCATOR', 'ADMIN', 'SUPERADMIN'].includes((session?.user?.role as string) || '');
  const { pushEntity } = useEntityContext();
  const { plural } = useTerminology();

  // ── State ──────────────────────────────────────────
  const [detail, setDetail] = useState<PlaybookDetail | null>(null);
  const [subjects, setSubjects] = useState<SubjectSummary[]>([]); // Legacy — kept for admin tabs
  const [courseSources, setCourseSources] = useState<SourceItem[]>([]);
  const [courseTeachingProfile, setCourseTeachingProfile] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSimModal, setShowSimModal] = useState(false);
  const [showFullRegen, setShowFullRegen] = useState(false);
  const [joinToken, setJoinToken] = useState<string | null>(null);
  const [joinCopied, setJoinCopied] = useState(false);

  // Content breakdown
  const [contentMethods, setContentMethods] = useState<MethodBreakdown[]>([]);
  const [contentTotal, setContentTotal] = useState(0);
  const [instructionTotal, setInstructionTotal] = useState(0);
  const [unassignedContentCount, setUnassignedContentCount] = useState(0);
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});
  const [categoryItems, setCategoryItems] = useState<Record<string, string[]> | undefined>(undefined);

  // Tabs — synced to ?tab= URL param for browser back/forward
  const tabFromUrl = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<string>(
    tabFromUrl && VALID_TABS.includes(tabFromUrl) ? tabFromUrl : 'design'
  );

  // Sessions tab
  const [sessions, setSessions] = useState<SessionTabData | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [expandedSession, setExpandedSession] = useState<number | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [regenSessionCount, setRegenSessionCount] = useState<number | null>(null);

  // Session flow (every-session pipeline, from course instructions)
  const [sessionFlowItems, setSessionFlowItems] = useState<InstructionItem[]>([]);
  const [sessionFlowLoaded, setSessionFlowLoaded] = useState(false);

  // Session Teaching Points
  const [sessionTPs, setSessionTPs] = useState<Record<number, TPItem[]>>({});
  const [unassignedTPs, setUnassignedTPs] = useState<TPItem[]>([]);
  const [tpLoaded, setTpLoaded] = useState(false);

  // Assessment MCQ previews
  type McqPreviewState = { questions: SurveyStepConfig[]; skipped: boolean; skipReason?: string; sourceId?: string } | null;
  const [mcqPreview, setMcqPreview] = useState<McqPreviewState>(null);
  const [postTestMcqPreview, setPostTestMcqPreview] = useState<McqPreviewState>(null);

  // Derived: is this a comprehension-led course?
  const isComprehension = courseTeachingProfile === 'comprehension-led'
    || subjects[0]?.teachingProfile === 'comprehension-led';

  // Session media map (SessionMediaMap imported from @/lib/lesson-plan/types)
  type MediaRef = SessionMediaRefType & { mimeType: string };
  const [sessionMediaMap, setSessionMediaMap] = useState<SessionMediaMap | null>(null);
  const [mediaMapLoading, setMediaMapLoading] = useState(false);
  const [editingSessionMedia, setEditingSessionMedia] = useState<number | null>(null);
  const [lightboxImage, setLightboxImage] = useState<MediaRef | null>(null);
  const [unassignedSearch, setUnassignedSearch] = useState('');
  const [dragMediaId, setDragMediaId] = useState<string | null>(null);

  // Course setup readiness (reported from CourseSetupTracker via Design tab)
  const [setupReadiness, setSetupReadiness] = useState<{ completedCount: number; allComplete: boolean } | null>(null);
  const handleReadinessChange = useCallback((count: number, all: boolean) => {
    setSetupReadiness(prev => (prev?.completedCount === count && prev?.allComplete === all) ? prev : { completedCount: count, allComplete: all });
  }, []);

  // Settings actions
  const [publishing, setPublishing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Description editing
  const [editingDescription, setEditingDescription] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const [savingDescription, setSavingDescription] = useState(false);

  // Course config defaults (Settings tab)
  type ConfigWithSource = Record<string, { value: any; source: 'system' | 'domain' | 'course' }>;
  const [configDefaults, setConfigDefaults] = useState<ConfigWithSource | null>(null);
  const [configLoading, setConfigLoading] = useState(false);

  // ── Data Loading ─────────────────────────────────────
  useEffect(() => {
    if (!courseId) return;
    setLoading(true);

    Promise.all([
      fetch(`/api/playbooks/${courseId}`).then((r) => r.json()),
      fetch(`/api/courses/${courseId}/subjects`).then((r) => r.json()),
      fetch(`/api/courses/${courseId}/content-breakdown?bySubject=true`).then((r) => r.json()),
      fetch(`/api/courses/${courseId}/content-sources`).then((r) => r.json()).catch(() => null),
    ])
      .then(([pbData, subData, breakdownData, contentSourcesData]) => {
        if (pbData.ok) {
          setDetail(pbData.playbook);
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
          setContentTotal(breakdownData.total || 0);
          setInstructionTotal(breakdownData.instructionCount || 0);
          setUnassignedContentCount(breakdownData.unassignedContentCount || 0);
          setCategoryCounts(breakdownData.categoryCounts || {});
          setCategoryItems(breakdownData.categoryItems ?? undefined);
        }
        if (contentSourcesData?.ok) {
          setCourseSources(contentSourcesData.sources || []);
          setCourseTeachingProfile(contentSourcesData.course?.teachingProfile || null);
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [courseId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Lazy-load session flow when Journey tab is active ──
  useEffect(() => {
    if (!courseId || activeTab !== 'journey' || sessionFlowLoaded) return;
    fetch(`/api/courses/${courseId}/course-instructions`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setSessionFlowItems(data.categories?.session_flow || []);
      })
      .catch(() => {})
      .finally(() => setSessionFlowLoaded(true));
  }, [courseId, activeTab, sessionFlowLoaded]);

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

  // Prefer PlaybookSource-based counts (no double-counting)
  const totalTPs = courseSources.length > 0
    ? courseSources.reduce((sum, s) => sum + s.assertionCount, 0)
    : subjects.reduce((sum, s) => sum + s.assertionCount, 0);
  const totalSources = courseSources.length > 0
    ? courseSources.length
    : (() => {
        const seen = new Set<string>();
        for (const s of subjects) { for (const src of (s.sources ?? [])) seen.add(src.id); }
        return seen.size || subjects.reduce((sum, s) => sum + s.sourceCount, 0);
      })();
  const contentOnlyCount = contentTotal - instructionTotal;

  const totalSessionDuration = useMemo(() => {
    if (!sessions?.plan?.entries) return 0;
    return sessions.plan.entries.reduce((sum, e) => sum + (e.estimatedDurationMins || 0), 0);
  }, [sessions]);

  const tabs: TabDefinition[] = useMemo(() => [
    { id: 'intelligence', label: 'Content', icon: <BookMarked size={14} />, count: totalSources || null },
    { id: 'design', label: 'Design', icon: <Wand2 size={14} /> },
    { id: 'curriculum', label: 'Curriculum', icon: <GraduationCap size={14} /> },
    { id: 'session-flow', label: 'Session Flow', icon: <SettingsIcon size={14} /> },
    { id: 'learners', label: 'Learners', icon: <Users2 size={14} /> },
    { id: 'proof', label: 'Proof Points', icon: <BarChart3 size={14} /> },
    { id: 'goals', label: 'Goals', icon: <Target size={14} /> },
    ...(isOperator ? [{ id: 'settings', label: 'Settings', icon: <SettingsIcon size={14} /> }] : []),
  ], [totalSources, isOperator, sessions]);

  // Sync active tab from URL on popstate (browser back/forward)
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam && VALID_TABS.includes(tabParam) && tabParam !== activeTab) {
      setActiveTab(tabParam);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // ── Tab change: lazy load lesson plan data ──
  const handleTabChange = useCallback((tab: string) => {
    // URL compat: redirect retired tab IDs to their new homes
    const TAB_REDIRECTS: Record<string, string> = {
      sessions: 'design', onboarding: 'design', overview: 'design',
      journey: 'design', genome: 'intelligence', audience: 'design',
      content: 'intelligence',
    };
    const resolvedTab = TAB_REDIRECTS[tab] ?? tab;
    setActiveTab(resolvedTab);
    // Sync tab to URL for browser back/forward
    const params = new URLSearchParams(window.location.search);
    params.set('tab', resolvedTab);
    router.replace(`?${params.toString()}`, { scroll: false });
    // Load sessions data when Design or Learners tab needs it (was: Journey tab)
    if ((resolvedTab === 'design' || resolvedTab === 'learners' || resolvedTab === 'curriculum') && sessions === null && !sessionsLoading) {
      setSessionsLoading(true);
      setSessionsError(null);
      fetch(`/api/courses/${courseId}/sessions?includeProgress=true`)
        .then((r) => r.json())
        .then((data) => {
          if (data.ok) {
            setSessions(data);
            // Initialize regenerate session count from loaded plan
            if (data.plan?.estimatedSessions && regenSessionCount === null) {
              setRegenSessionCount(data.plan.estimatedSessions);
            }
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
              // Fetch assessment MCQ previews (pre + post in parallel)
              const previewBase = `/api/curricula/${data.curriculumId}/assessment-preview?playbookId=${courseId}`;
              fetch(previewBase)
                .then((r) => r.json())
                .then((ap) => { if (ap.ok) setMcqPreview(ap); })
                .catch(() => {});
              fetch(`${previewBase}&type=post_test`)
                .then((r) => r.json())
                .then((ap) => { if (ap.ok) setPostTestMcqPreview(ap); })
                .catch(() => {});
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
    // Lazy load course config defaults for Settings tab
    if (tab === 'settings' && configDefaults === null && !configLoading && detail) {
      setConfigLoading(true);
      fetch(`/api/lesson-plan-defaults?playbookId=${detail.id}&domainId=${detail.domain.id}`)
        .then((r) => r.json())
        .then((data) => { if (data.ok && data.withSource) setConfigDefaults(data.defaults); })
        .catch(() => {})
        .finally(() => setConfigLoading(false));
    }
  }, [courseId, sessions, sessionsLoading, regenSessionCount, configDefaults, configLoading, detail]);

  // ── Load session data when landing on a tab that needs it via URL ──
  useEffect(() => {
    if (!courseId || sessions !== null || sessionsLoading) return;
    if (!['design', 'learners', 'curriculum'].includes(activeTab)) return;
    handleTabChange(activeTab);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, activeTab, handleTabChange]);

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

  // ── MCQ regenerate handler ──
  const [mcqRegenerating, setMcqRegenerating] = useState(false);
  const handleRegenerateMcqs = useCallback(async () => {
    if (!detail) return;
    setMcqRegenerating(true);
    try {
      const res = await fetch(`/api/playbooks/${detail.id}/reset-mcqs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: false }),
      });
      const data = await res.json();
      // Helper to refresh all MCQ previews after regeneration
      const refreshAllPreviews = async () => {
        if (!sessions?.curriculumId) return;
        const base = `/api/curricula/${sessions.curriculumId}/assessment-preview?playbookId=${courseId}`;
        const [pre, post] = await Promise.all([
          fetch(base).then(r => r.json()).catch(() => null),
          fetch(`${base}&type=post_test`).then(r => r.json()).catch(() => null),
        ]);
        if (pre?.ok) setMcqPreview(pre);
        if (post?.ok) setPostTestMcqPreview(post);
      };

      if (data.hasResults) {
        // Warn user about affected callers
        if (confirm(`${data.message}\n\nRegenerate anyway?`)) {
          const forceRes = await fetch(`/api/playbooks/${detail.id}/reset-mcqs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ force: true }),
          });
          const forceData = await forceRes.json();
          if (forceData.ok) await refreshAllPreviews();
        }
      } else if (data.ok) {
        if (data.skipped) {
          const skipPreview = { questions: [] as SurveyStepConfig[], skipped: true, skipReason: data.skipReason ?? "generation_skipped" };
          setMcqPreview(skipPreview);
          setMidTestMcqPreview(skipPreview);
          setPostTestMcqPreview(skipPreview);
        } else {
          await refreshAllPreviews();
        }
      }
    } catch {
      // silent
    } finally {
      setMcqRegenerating(false);
    }
  }, [detail, sessions?.curriculumId]);

  // ── Survey question save handler ──
  const [surveySaving, setSurveySaving] = useState(false);
  const handleSurveyQuestions = useCallback(async (sectionKey: string, questions: SurveyStepConfig[]) => {
    if (!detail) return;
    setSurveySaving(true);
    try {
      const cfg = (detail.config ?? {}) as Record<string, any>;
      let newConfig: Record<string, any>;

      if (sectionKey === 'personality') {
        newConfig = {
          ...cfg,
          assessment: { ...cfg.assessment, personality: { ...cfg.assessment?.personality, questions } },
        };
      } else if (sectionKey === 'mid') {
        newConfig = {
          ...cfg,
          surveys: { ...cfg.surveys, mid: { ...cfg.surveys?.mid, questions } },
        };
      } else if (sectionKey === 'post') {
        newConfig = {
          ...cfg,
          surveys: { ...cfg.surveys, post: { ...cfg.surveys?.post, questions } },
        };
      } else {
        return;
      }

      const res = await fetch(`/api/playbooks/${detail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: newConfig }),
      });
      const data = await res.json();
      if (data.ok) {
        setDetail((prev) => prev ? { ...prev, config: newConfig } : prev);
      }
    } catch {
      // silent — optimistic UI already shows updated questions
    } finally {
      setSurveySaving(false);
    }
  }, [detail]);

  // ── Assessment config change handler (questionCount, excludedQuestionIds, enabled) ──
  const handleAssessmentConfigChange = useCallback(async (patch: Record<string, unknown>, testType: string = 'preTest') => {
    if (!detail) return;
    const cfg = (detail.config ?? {}) as Record<string, any>;
    const newConfig = {
      ...cfg,
      assessment: {
        ...cfg.assessment,
        [testType]: { ...cfg.assessment?.[testType], ...patch },
      },
    };
    setDetail((prev) => prev ? { ...prev, config: newConfig } : prev);

    try {
      await fetch(`/api/playbooks/${detail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: newConfig }),
      });
    } catch {
      // silent
    }
  }, [detail]);

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
        body: JSON.stringify({
          ...(regenSessionCount ? { totalSessionTarget: regenSessionCount } : {}),
        }),
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
            if (refreshData.ok) {
              setSessions(refreshData);
              if (refreshData.plan?.estimatedSessions) setRegenSessionCount(refreshData.plan.estimatedSessions);
            }
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
  }, [courseId, sessions, regenerating, regenSessionCount]);

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
    <div className="hf-page-container hf-page-scroll hf-page-left">
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
            {setupReadiness && (
              <span className={`cd-readiness-pip ${setupReadiness.allComplete ? 'cd-readiness-pip--ready' : 'cd-readiness-pip--progress'}`}
                title={setupReadiness.allComplete ? 'Ready to teach' : `Setup: ${setupReadiness.completedCount} of 6`}
              >
                {setupReadiness.allComplete ? 'Ready' : `${setupReadiness.completedCount}/6`}
              </span>
            )}
            <ProgressionModePill
              modulesAuthored={(detail.config as Record<string, unknown> | null | undefined)?.modulesAuthored as boolean | null | undefined}
              onClickWhenUnset={() => router.push(`/x/courses/${detail.id}?tab=curriculum`)}
            />
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
          {isOperator && (
            <button
              className="hf-btn hf-btn-destructive hf-nowrap"
              onClick={() => setShowFullRegen(true)}
            >
              <RefreshCw size={14} />
              Rebuild Course
            </button>
          )}
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

      {/* Enrol link */}
      {joinToken && (
        <div className="hf-banner hf-banner-success hf-mb-md hf-flex hf-items-center hf-gap-sm">
          <Link2 size={14} />
          <code className="hf-text-xs" style={{ flex: 1 }}>{`${typeof window !== 'undefined' ? window.location.origin : ''}/join/${joinToken}`}</code>
          <button
            className="hf-btn hf-btn-xs"
            onClick={() => {
              navigator.clipboard.writeText(`${window.location.origin}/join/${joinToken}`);
              setJoinCopied(true);
              setTimeout(() => setJoinCopied(false), 2000);
            }}
          >
            <Copy size={12} />
            {joinCopied ? 'Copied!' : 'Copy enrol link'}
          </button>
        </div>
      )}

      {/* ── Tabs ──────────────────────────────────────── */}
      <DraggableTabs
        storageKey="course-detail-tabs-v8"
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        showReset={false}
      />

      {/* ═══════════════════════════════════════════════ */}
      {/* OVERVIEW TAB                                   */}
      {/* ═══════════════════════════════════════════════ */}
      {activeTab === 'overview' && (
        <CourseOverviewTab
          courseId={courseId!}
          detail={detail}
          subjects={subjects}
          persona={persona}
          sessionPlan={sessions?.plan ? {
            estimatedSessions: sessions.plan.estimatedSessions,
            totalDurationMins: totalSessionDuration,
            generatedAt: sessions.plan.generatedAt,
          } : null}
          sessions={sessions}
          onSimCall={() => setShowSimModal(true)}
          instructionTotal={instructionTotal}
          categoryCounts={categoryCounts}
          contentMethods={contentMethods}
          onNavigate={handleTabChange}
        />
      )}

      {/* Journey tab removed — absorbed into Design + Learners (see #172) */}
      {activeTab === '__legacy_journey__' && (() => {
        const isContinuousMode = sessions?.plan?.entries?.length === 1 && sessions.plan.entries[0]?.type === 'continuous';

        if (isContinuousMode) {
          return (
            <ContinuousProgrammeView
              courseId={courseId!}
              curriculumId={sessions?.curriculumId ?? null}
              loading={sessionsLoading}
            />
          );
        }

        return (
        <>
          {/* Plan header — "Your Lesson Plan" summary card at top */}
          {sessions?.plan?.entries && sessions.plan.entries.length > 0 && (
            <PlanHeaderCard
              entries={sessions.plan.entries}
              model={sessions.plan.model}
              generatedAt={sessions.plan.generatedAt}
              estimatedSessions={sessions.plan.estimatedSessions}
              regenerating={regenerating}
              regenSessionCount={regenSessionCount}
              onRegenSessionCountChange={setRegenSessionCount}
              onRegenerate={isOperator ? handleRegenerate : undefined}
              curriculumId={sessions.curriculumId}
            />
          )}

          {/* Collapsible session rail */}
          <CollapsibleCard title="Sessions" variant="embedded" defaultOpen>
          <JourneyRail
            sessions={sessions?.plan?.entries ?? []}
            callers={sessions?.studentProgress}
            courseId={courseId!}
            loading={sessionsLoading}
            error={sessionsError}
            onRetry={handleRetrySessionsLoad}
            hideClassOverview
            renderSessionDetail={(entry) => {
              if (entry.type === 'onboarding') {
                return (
                  <OnboardingEditor
                    courseId={courseId!}
                    domainId={detail.domain.id}
                    domainName={detail.domain.name}
                    isOperator={isOperator}
                    mode="onboarding"
                  />
                );
              }
              if (entry.type === 'offboarding') {
                return (
                  <OnboardingEditor
                    courseId={courseId!}
                    domainId={detail.domain.id}
                    domainName={detail.domain.name}
                    isOperator={isOperator}
                    mode="offboarding"
                  />
                );
              }
              if (isFormStop(entry.type)) {
                return (
                  <SurveyStopDetail
                    type={entry.type}
                    playbookConfig={detail.config as Record<string, unknown>}
                    onSave={isOperator ? handleSurveyQuestions : undefined}
                    saving={surveySaving}
                    mcqPreview={mcqPreview}
                    postTestMcqPreview={postTestMcqPreview}
                    isComprehension={isComprehension}
                    onRegenerate={isOperator ? handleRegenerateMcqs : undefined}
                    regenerating={mcqRegenerating}
                    onAssessmentConfigChange={isOperator ? handleAssessmentConfigChange : undefined}
                  />
                );
              }
              return (
                <SessionDetailPanel
                  entry={entry}
                  courseId={courseId!}
                  tps={sessionTPs[entry.session]}
                  showEditLink={isOperator}
                />
              );
            }}
            // Admin rail controls
            onAddSession={isOperator && sessions?.curriculumId ? (afterSession, type) => {
              if (!sessions?.plan?.entries) return;
              const newEntry = {
                session: 0, type, moduleId: null, moduleLabel: '',
                label: `New ${type.charAt(0).toUpperCase() + type.slice(1)}`,
                estimatedDurationMins: type.includes('survey') ? 2 : 15,
                isOptional: true,
              };
              const idx = sessions.plan.entries.findIndex((e) => e.session === afterSession);
              const updated = [...sessions.plan.entries];
              updated.splice(idx + 1, 0, newEntry);
              updated.forEach((e, i) => { e.session = i + 1; });
              setSessions(prev => prev ? { ...prev, plan: prev.plan ? { ...prev.plan, entries: updated } : null } : null);
              fetch(`/api/curricula/${sessions.curriculumId}/lesson-plan`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entries: updated }),
              }).catch(() => {});
            } : undefined}
            onRemoveSession={isOperator && sessions?.curriculumId ? (sessionNum) => {
              if (!sessions?.plan?.entries) return;
              const updated = sessions.plan.entries.filter((e) => e.session !== sessionNum);
              updated.forEach((e, i) => { e.session = i + 1; });
              setSessions(prev => prev ? { ...prev, plan: prev.plan ? { ...prev.plan, entries: updated } : null } : null);
              fetch(`/api/curricula/${sessions.curriculumId}/lesson-plan`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entries: updated }),
              }).catch(() => {});
            } : undefined}
            onRetypeSession={isOperator && sessions?.curriculumId ? (sessionNum, newType) => {
              if (!sessions?.plan?.entries) return;
              const updated = sessions.plan.entries.map((e) =>
                e.session === sessionNum ? { ...e, type: newType } : e
              );
              setSessions(prev => prev ? { ...prev, plan: prev.plan ? { ...prev.plan, entries: updated } : null } : null);
              fetch(`/api/curricula/${sessions.curriculumId}/lesson-plan`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entries: updated }),
              }).catch(() => {});
            } : undefined}
            onToggleOptional={isOperator && sessions?.curriculumId ? (sessionNum, isOptional) => {
              if (!sessions?.plan?.entries) return;
              const updated = sessions.plan.entries.map((e) =>
                e.session === sessionNum ? { ...e, isOptional } : e
              );
              setSessions(prev => prev ? { ...prev, plan: prev.plan ? { ...prev.plan, entries: updated } : null } : null);
              fetch(`/api/curricula/${sessions.curriculumId}/lesson-plan`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entries: updated }),
              }).catch(() => {});
            } : undefined}
            onReorderSession={isOperator && sessions?.curriculumId ? (from, to) => {
              if (!sessions?.plan?.entries) return;
              const updated = [...sessions.plan.entries];
              const [moved] = updated.splice(from, 1);
              updated.splice(to, 0, moved);
              updated.forEach((e, i) => { e.session = i + 1; });
              setSessions(prev => prev ? { ...prev, plan: prev.plan ? { ...prev.plan, entries: updated } : null } : null);
              fetch(`/api/curricula/${sessions.curriculumId}/lesson-plan`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entries: updated }),
              }).catch(() => {});
            } : undefined}
            assessmentsEnabled={isPreSurveyEnabled((detail.config ?? {}) as PlaybookConfig)}
            onToggleAssessments={isOperator ? (enabled) => {
              // Master toggle: pre-survey is derived from welcome.* (set all
              // three welcome phases together); post-survey still uses the
              // legacy surveys.post.enabled field (no welcome-side mirror).
              const cfg = (detail.config ?? {}) as Record<string, any>;
              const newConfig = {
                ...cfg,
                welcome: {
                  ...cfg.welcome,
                  goals: { ...cfg.welcome?.goals, enabled },
                  aboutYou: { ...cfg.welcome?.aboutYou, enabled },
                  knowledgeCheck: { ...cfg.welcome?.knowledgeCheck, enabled },
                },
                surveys: {
                  ...cfg.surveys,
                  post: { ...cfg.surveys?.post, enabled },
                },
              };
              setDetail((prev) => prev ? { ...prev, config: newConfig } : prev);

              fetch(`/api/playbooks/${detail.id}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ config: newConfig }),
              }).then(() => {
                if (sessions?.curriculumId && sessions?.plan?.entries) {
                  // Body just needs to flag "config changed, re-apply stops" — the
                  // route fetches the playbook from DB to gate the stops.
                  fetch(`/api/curricula/${sessions.curriculumId}/lesson-plan`, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ entries: sessions.plan.entries, surveys: true }),
                  }).then((r) => r.json()).then((data) => {
                    if (data.ok && data.entries) {
                      setSessions((prev) => prev ? { ...prev, plan: prev.plan ? { ...prev.plan, entries: data.entries } : null } : null);
                    }
                  }).catch(() => {});
                }
              }).catch(() => {});
            } : undefined}
            // Sub-component toggles
            personalityEnabled={(detail.config as any)?.assessment?.personality?.enabled ?? true}
            onTogglePersonality={isOperator ? (enabled) => handleAssessmentConfigChange({ enabled }, 'personality') : undefined}
            preTestEnabled={(detail.config as any)?.assessment?.preTest?.enabled ?? true}
            onTogglePreTest={isOperator ? (enabled) => handleAssessmentConfigChange({ enabled }, 'preTest') : undefined}
            postTestEnabled={(detail.config as any)?.assessment?.postTest?.enabled ?? true}
            onTogglePostTest={isOperator ? (enabled) => handleAssessmentConfigChange({ enabled }, 'postTest') : undefined}
            personalityQuestionCount={((detail.config as any)?.assessment?.personality?.questions ?? []).length || 3}
            preTestQuestionCount={mcqPreview && !mcqPreview.skipped ? mcqPreview.questions.length : (detail.config as any)?.assessment?.preTest?.questionCount ?? 5}
            postTestQuestionCount={postTestMcqPreview && !postTestMcqPreview.skipped ? postTestMcqPreview.questions.length : undefined}
            postSurveyQuestionCount={5}
            // Merged SPV props — media/TP features
            sessionTPs={sessionTPs}
            unassignedTPs={unassignedTPs}
            mediaMap={sessionMediaMap}
            availableMedia={sessionMediaMap?.unassigned.map(u => ({
              id: u.mediaId,
              fileName: u.fileName || u.mediaId,
              title: u.captionText || null,
            })) ?? []}
            onTPMove={isOperator ? handleTPMove : undefined}
            onSessionMediaAssign={isOperator ? handleAssignImageToSession : undefined}
            onSessionMediaRemove={isOperator ? handleRemoveSessionImage : undefined}
            onMediaReorder={isOperator ? handleReorderSessionImages : undefined}
          />
          </CollapsibleCard>

          {/* ── Every Session Flow (from course reference) ── */}
          {sessionFlowItems.length > 0 && (
            <div className="hf-mt-lg">
              <SectionHeader
                title="Every Session"
                icon={Sparkles}
                subtitle="How sessions 2+ are structured (from your course reference)"
              />
              <div className="hf-card-compact hf-mb-lg">
                <SessionFlowPipeline items={sessionFlowItems} />
              </div>
            </div>
          )}
        </>
        );
      })()}

      {/* ═══════════════════════════════════════════════ */}
      {/* CURRICULUM TAB — modules, LOs, scorecard, regen */}
      {/* ═══════════════════════════════════════════════ */}
      {activeTab === 'curriculum' && (
        <CourseCurriculumTab
          courseId={courseId!}
          playbookId={courseId!}
          curriculumId={sessions?.curriculumId ?? null}
          isOperator={isOperator}
          onSwitchTab={(tab) => {
            setActiveTab(tab);
            router.replace(`?tab=${tab}`, { scroll: false });
          }}
        />
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* CONTENT INTELLIGENCE TAB                       */}
      {/* ═══════════════════════════════════════════════ */}
      {activeTab === 'intelligence' && (
        <CourseIntelligenceTab
          courseId={courseId!}
          detail={detail}
          subjects={subjects}
          courseSources={courseSources}
          courseTeachingProfile={courseTeachingProfile}
          contentMethods={contentMethods}
          contentTotal={contentTotal}
          instructionCount={instructionTotal}
          unassignedContentCount={unassignedContentCount}
          categoryCounts={categoryCounts}
          categoryItems={categoryItems}
          isOperator={isOperator}
          onContentRefresh={(methods, total, instrCount, unassignedContent) => {
            setContentMethods(methods);
            setContentTotal(total);
            if (instrCount !== undefined) setInstructionTotal(instrCount);
            if (unassignedContent !== undefined) setUnassignedContentCount(unassignedContent);
          }}
        />
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* LEARNERS TAB                                   */}
      {/* ═══════════════════════════════════════════════ */}
      {activeTab === 'learners' && (
        <CourseLearnersTab
          courseId={courseId!}
          initialJoinToken={joinToken}
          studentProgress={sessions?.studentProgress}
        />
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* PROOF POINTS TAB                               */}
      {/* ═══════════════════════════════════════════════ */}
      {activeTab === 'proof' && (
        <CourseProofTab courseId={courseId!} />
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* GOALS TAB                                      */}
      {/* ═══════════════════════════════════════════════ */}
      {activeTab === 'goals' && (
        <CourseGoalsTab
          courseId={courseId!}
          playbookConfig={detail?.config as Record<string, unknown> | null | undefined}
        />
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* DESIGN TAB                                     */}
      {/* ═══════════════════════════════════════════════ */}
      {activeTab === 'design' && (
        <CourseDesignTab
          courseId={courseId!}
          playbookConfig={detail?.config as Record<string, unknown> | null | undefined}
          detail={detail ? { id: detail.id, name: detail.name, status: detail.status, config: detail.config, domain: detail.domain, publishedAt: detail.publishedAt, version: parseInt(detail.version || '1', 10) } : null}
          subjects={subjects}
          persona={persona}
          sessionPlan={sessions?.plan ? { estimatedSessions: sessions.plan.estimatedSessions, totalDurationMins: totalSessionDuration, generatedAt: sessions.plan.generatedAt } : null}
          sessions={sessions}
          onSimCall={() => setShowSimModal(true)}
          instructionTotal={instructionTotal}
          categoryCounts={categoryCounts}
          contentMethods={contentMethods}
          onNavigate={handleTabChange}
          onReadinessChange={handleReadinessChange}
        />
      )}


      {/* ═══════════════════════════════════════════════ */}
      {/* SESSION FLOW TAB                                */}
      {/* ═══════════════════════════════════════════════ */}
      {activeTab === 'session-flow' && (
        <div className="hf-mt-lg">
          <SessionFlowEditor courseId={courseId} />
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

              {/* ── Course Configuration ─────────────────── */}
              <SectionHeader title="Course Configuration" icon={Zap} />
              <div className="hf-card hf-mb-lg">
                {configLoading ? (
                  <div className="hf-flex hf-items-center hf-gap-sm hf-text-xs hf-text-muted">
                    <div className="hf-spinner hf-spinner-xs" /> Loading configuration...
                  </div>
                ) : configDefaults ? (
                  <div className="hf-grid-2col hf-gap-sm">
                    {([
                      { key: 'sessionCount', label: 'Sessions' },
                      { key: 'durationMins', label: 'Duration (min)' },
                      { key: 'emphasis', label: 'Emphasis' },
                      { key: 'assessments', label: 'Assessments' },
                      { key: 'lessonPlanModel', label: 'Teaching Model' },
                      { key: 'audience', label: 'Audience' },
                    ] as const).map(({ key, label }) => {
                      const entry = configDefaults[key];
                      if (!entry) return null;
                      const sourceBadge = entry.source === 'course'
                        ? 'hf-chip hf-chip-xs hf-chip-success'
                        : entry.source === 'domain'
                          ? 'hf-chip hf-chip-xs hf-chip-info'
                          : 'hf-chip hf-chip-xs';
                      const sourceLabel = entry.source === 'course' ? 'Course' : entry.source === 'domain' ? 'Institution' : 'System default';
                      return (
                        <div key={key} className="hf-flex hf-flex-between hf-items-center hf-py-xs">
                          <span className="hf-text-xs hf-text-muted">{label}</span>
                          <div className="hf-flex hf-items-center hf-gap-xs">
                            <span className="hf-text-sm hf-text-primary">
                              {typeof entry.value === 'string' ? entry.value.replace(/_/g, ' ') : entry.value}
                            </span>
                            <span className={sourceBadge}>{sourceLabel}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="hf-text-xs hf-text-muted">Configuration not available</p>
                )}
              </div>

              {/* ── Teaching Identity ────────────────── */}
              <SectionHeader title="Teaching Identity" icon={Sparkles} />
              <div className="hf-card hf-mb-lg">
                <div className="hf-grid-2col hf-gap-sm">
                  {([
                    { key: 'interactionPattern', label: 'Interaction Style', labels: INTERACTION_PATTERN_LABELS },
                    { key: 'teachingMode', label: 'Teaching Mode', labels: TEACHING_MODE_LABELS },
                  ] as const).map(({ key, label, labels }) => {
                    const val = (detail.config as any)?.[key];
                    const displayVal = val ? (labels as any)[val]?.label || val.replace(/_/g, ' ') : 'Not configured';
                    return (
                      <div key={key} className="hf-flex hf-flex-between hf-items-center hf-py-xs">
                        <span className="hf-text-xs hf-text-muted">{label}</span>
                        <div className="hf-flex hf-items-center hf-gap-xs">
                          <span className="hf-text-sm hf-text-primary">{displayVal}</span>
                          <span className={val ? 'hf-chip hf-chip-xs hf-chip-success' : 'hf-chip hf-chip-xs'}>
                            {val ? 'Course' : 'System default'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  {(() => {
                    const subj = (detail.config as any)?.subjectDiscipline;
                    return (
                      <div className="hf-flex hf-flex-between hf-items-center hf-py-xs">
                        <span className="hf-text-xs hf-text-muted">Subject</span>
                        <div className="hf-flex hf-items-center hf-gap-xs">
                          <span className="hf-text-sm hf-text-primary">{subj || 'Not configured'}</span>
                          <span className={subj ? 'hf-chip hf-chip-xs hf-chip-success' : 'hf-chip hf-chip-xs'}>
                            {subj ? 'Course' : 'System default'}
                          </span>
                        </div>
                      </div>
                    );
                  })()}
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

      {showFullRegen && detail && (
        <FullRegenerateModal
          courseId={courseId}
          sources={courseSources.length > 0
            ? courseSources.map((s) => ({ id: s.id, name: s.name, documentType: s.documentType, extractorVersion: s.extractorVersion, assertionCount: s.assertionCount }))
            : subjects.flatMap((s) => (s.sources || []).map((src) => ({ id: src.id, name: src.name, documentType: src.documentType, extractorVersion: src.extractorVersion, assertionCount: src.assertionCount })))}
          onClose={() => setShowFullRegen(false)}
          onComplete={() => {
            // Force full page data refresh
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}

// ── Module progression mode badge (#253) ─────────────────────────────
//
// Surfaces the course's `modulesAuthored` choice next to the title so
// educators can see at a glance whether learners will be presented with a
// picker (true) or fall through to scheduler-led teaching (false). When
// unset, renders a clickable warning pill that routes to the Curriculum tab
// so the educator can resolve it via Re-import.
function ProgressionModePill({
  modulesAuthored,
  onClickWhenUnset,
}: {
  modulesAuthored: boolean | null | undefined;
  onClickWhenUnset: () => void;
}) {
  if (modulesAuthored === true) {
    return (
      <span
        className="cd-progression-pill cd-progression-pill--learner"
        title="Learners pick from a module menu before each session"
      >
        Learner picks
      </span>
    );
  }
  if (modulesAuthored === false) {
    return (
      <span
        className="cd-progression-pill cd-progression-pill--ai"
        title="AI scheduler decides which module to cover each call"
      >
        AI-led
      </span>
    );
  }
  // null / undefined — never set
  return (
    <button
      type="button"
      className="cd-progression-pill cd-progression-pill--unset"
      onClick={onClickWhenUnset}
      title="Click to choose how learners progress (AI-led or learner-picks)"
    >
      Mode not set
    </button>
  );
}
