'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { BookOpen, Users, Plus } from 'lucide-react';
import { useTerminology } from '@/contexts/TerminologyContext';
import { useStepFlow } from '@/contexts';
import { useWizardResume } from '@/hooks/useWizardResume';
import { WizardResumeBanner } from '@/components/shared/WizardResumeBanner';
import { CourseSetupWizard } from './_components/CourseSetupWizard';
import { StatusBadge, DomainPill } from '@/src/components/shared/EntityPill';
import { FancySelect } from '@/components/shared/FancySelect';
import { AdvancedBanner } from '@/components/shared/AdvancedBanner';

type Domain = { id: string; name: string };

type CourseListItem = {
  id: string;
  name: string;
  description: string | null;
  domain: Domain;
  studentCount: number;
  specCount: number;
  status: string;
  version: string;
  createdAt: string;
};

const STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;

const statusColors: Record<string, { bg: string; text: string; icon: string; desc: string }> = {
  DRAFT: { bg: 'var(--status-warning-bg)', text: 'var(--status-warning-text)', icon: '\u{1F4DD}', desc: 'Work in progress' },
  PUBLISHED: { bg: 'var(--status-success-bg)', text: 'var(--status-success-text)', icon: '\u2705', desc: 'Active and in use' },
  ARCHIVED: { bg: 'var(--status-neutral-bg)', text: 'var(--status-neutral-text)', icon: '\u{1F4E6}', desc: 'No longer active' },
};

const statusMap: Record<string, 'draft' | 'active' | 'archived'> = {
  draft: 'draft',
  published: 'active',
  archived: 'archived',
};

export default function CoursesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const isOperator = ['OPERATOR', 'EDUCATOR', 'ADMIN', 'SUPERADMIN'].includes((session?.user?.role as string) || '');
  const { terms, plural } = useTerminology();
  const { state, isActive: isSetupFlowActive, startFlow } = useStepFlow();
  const { pendingTask, isLoading: resumeLoading } = useWizardResume('course_setup');

  // Redirect ?id=xxx to /x/courses/xxx for backwards compat
  const legacyId = searchParams.get('id');
  const actionParam = searchParams.get('action');
  useEffect(() => {
    if (legacyId) {
      router.replace(`/x/courses/${legacyId}`);
    }
  }, [legacyId, router]);

  // List state
  const [courses, setCourses] = useState<CourseListItem[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set());
  const [selectedDomain, setSelectedDomain] = useState('');

  // Wizard
  const showWizard = isSetupFlowActive && state?.flowId === 'create-course';

  // Auto-launch wizard when arriving with ?action=setup (from detail page CTA)
  useEffect(() => {
    if (actionParam === 'setup' && !showWizard && !loading && !pendingTask && !resumeLoading) {
      handleNewCourse();
      router.replace('/x/courses');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionParam, loading, resumeLoading]);

  const loadCourses = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/courses');
      if (!res.ok) throw new Error('Failed to load courses');
      const data = await res.json();
      setCourses(data.courses || []);
      setDomains(data.domains || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!legacyId) loadCourses();
  }, [legacyId]);

  // Filter courses (client-side)
  const filteredCourses = useMemo(() => {
    return courses.filter((c) => {
      if (search) {
        const s = search.toLowerCase();
        const matchesSearch = c.name.toLowerCase().includes(s) || c.description?.toLowerCase().includes(s) || c.domain.name.toLowerCase().includes(s);
        if (!matchesSearch) return false;
      }
      if (selectedStatuses.size > 0 && !selectedStatuses.has(c.status.toUpperCase())) return false;
      if (selectedDomain && selectedDomain !== c.domain.id) return false;
      return true;
    });
  }, [courses, search, selectedStatuses, selectedDomain]);

  const toggleStatus = (status: string) => {
    setSelectedStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  // Wizard steps
  const COURSE_STEPS_FALLBACK = [
    { id: 'intent', label: 'Intent', activeLabel: 'Setting Intent' },
    { id: 'content', label: 'Content', activeLabel: 'Adding Content' },
    { id: 'lesson-plan', label: 'Lesson Plan', activeLabel: 'Planning Lessons' },
    { id: 'course-config', label: 'First Call', activeLabel: 'Setting Up First Call' },
    { id: 'students', label: 'Students', activeLabel: 'Adding Students' },
    { id: 'done', label: 'Launch', activeLabel: 'Creating Course' },
  ];

  const loadWizardSteps = async () => {
    try {
      const response = await fetch('/api/wizard-steps?wizard=course');
      const data = await response.json();
      if (data.ok && data.steps?.length > 0) {
        return data.steps.map((step: { id: string; label: string; activeLabel: string }) => ({
          id: step.id,
          label: step.label,
          activeLabel: step.activeLabel,
        }));
      }
    } catch (err) {
      console.warn('[CoursesPage] Failed to load spec steps, using defaults', err);
    }
    return COURSE_STEPS_FALLBACK;
  };

  const handleNewCourse = async () => {
    const stepsToUse = await loadWizardSteps();
    let taskId: string | undefined;
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskType: 'course_setup', currentStep: 0, context: { _wizardStep: 0 } }),
      });
      const data = await res.json();
      if (data.ok) taskId = data.taskId;
    } catch {
      // Continue without DB persistence
    }
    startFlow({
      flowId: 'create-course',
      steps: stepsToUse,
      returnPath: '/x/courses',
      taskType: 'course_setup',
      taskId,
    });
  };

  const handleResumeCourse = async () => {
    if (!pendingTask) return;
    const stepsToUse = await loadWizardSteps();
    const ctx = pendingTask.context || {};
    startFlow({
      flowId: 'create-course',
      steps: stepsToUse,
      returnPath: '/x/courses',
      taskType: 'course_setup',
      taskId: pendingTask.id,
      initialData: ctx,
      initialStep: ctx._wizardStep ?? 0,
    });
  };

  const handleDiscardResume = async () => {
    if (pendingTask) {
      try {
        await fetch(`/api/tasks?taskId=${pendingTask.id}`, { method: 'DELETE' });
      } catch { /* ignore */ }
    }
    await handleNewCourse();
  };

  // Redirect in progress
  if (legacyId) return (
    <div className="hf-empty-compact">
      <div className="hf-spinner" />
    </div>
  );

  // Resume banner (shown before wizard or list)
  if (!showWizard && !resumeLoading && pendingTask) {
    return (
      <div className="hf-page-container">
        <div className="hf-mt-md">
          <WizardResumeBanner
            task={pendingTask}
            onResume={handleResumeCourse}
            onDiscard={handleDiscardResume}
            label="Course Setup"
          />
        </div>
      </div>
    );
  }

  // Wizard mode
  if (showWizard) {
    return (
      <CourseSetupWizard
        onComplete={async () => {
          await loadCourses();
        }}
      />
    );
  }

  const FilterPill = ({
    label, isActive, colors, onClick, icon, tooltip,
  }: {
    label: string; isActive: boolean; colors: { bg: string; text: string }; onClick: () => void; icon?: string; tooltip?: string;
  }) => (
    <button
      onClick={onClick}
      title={tooltip}
      className="hf-filter-pill"
      style={isActive ? {
        border: `1px solid color-mix(in srgb, ${colors.text} 25%, transparent)`,
        background: colors.bg,
        color: colors.text,
      } : undefined}
    >
      {icon && <span>{icon}</span>}
      {label}
    </button>
  );

  return (
    <div className="hf-page-container hf-page-wide hf-page-scroll hf-flex-col">
      <AdvancedBanner />

      {/* Header + Filters */}
      <div className="hf-flex hf-flex-between hf-mb-lg hf-items-start">
        <div>
          <h1 className="hf-page-title hf-mb-xs">Courses</h1>
          <p className="hf-page-subtitle">Manage your courses and track student progress</p>
        </div>
        {isOperator && (
          <button onClick={handleNewCourse} className="hf-btn hf-btn-primary">
            <Plus size={16} />
            New Course
          </button>
        )}
      </div>

      <div className="hf-card-compact hf-mb-lg">
        <div className="hf-flex hf-flex-wrap hf-gap-lg hf-items-center">
          {/* Search */}
          <input
            type="text"
            placeholder="Search courses..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="hf-input hf-input-sm"
          />

          <div className="hf-divider-v" />

          {/* Status Pills */}
          <div className="hf-flex hf-gap-sm hf-items-center">
            <span className="hf-text-xs hf-text-muted hf-text-bold">Status</span>
            {selectedStatuses.size > 0 && (
              <button onClick={() => setSelectedStatuses(new Set())} className="hf-clear-btn" title="Clear filter">&times;</button>
            )}
            <div className="hf-flex hf-gap-xs">
              {STATUSES.map((status) => {
                const config = statusColors[status];
                return (
                  <FilterPill
                    key={status}
                    label={status}
                    icon={config.icon}
                    tooltip={config.desc}
                    isActive={selectedStatuses.has(status)}
                    colors={config}
                    onClick={() => toggleStatus(status)}
                  />
                );
              })}
            </div>
          </div>

          {/* Domain Filter */}
          {domains.length > 1 && (
            <>
              <div className="hf-divider-v" />
              <div className="hf-flex hf-gap-sm hf-items-center">
                <span className="hf-text-xs hf-text-muted hf-text-bold">{terms.domain}</span>
                <FancySelect
                  value={selectedDomain}
                  onChange={setSelectedDomain}
                  placeholder={`All ${plural('domain').toLowerCase()}`}
                  clearable
                  options={domains.map((d) => ({ value: d.id, label: d.name }))}
                  style={{ width: 180 }}
                />
              </div>
            </>
          )}

          {/* Results count */}
          <span className="hf-text-xs hf-text-muted hf-text-bold">
            {filteredCourses.length} of {courses.length}
          </span>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="hf-banner hf-banner-error hf-mb-md">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="hf-text-xs hf-ml-auto hf-link-subtle">Dismiss</button>
        </div>
      )}

      {/* Course Cards Grid */}
      {loading ? (
        <div className="hf-empty-compact">
          <div className="hf-spinner" />
        </div>
      ) : filteredCourses.length === 0 ? (
        <div className="hf-empty-compact">
          <div className="hf-mb-md">
            <BookOpen size={48} className="hf-text-tertiary" />
          </div>
          <div className="hf-heading-lg hf-text-secondary hf-mb-md">
            {search || selectedStatuses.size > 0 || selectedDomain
              ? 'No courses match filters'
              : 'No courses yet'}
          </div>
          {isOperator && !search && selectedStatuses.size === 0 && !selectedDomain && (
            <button onClick={handleNewCourse} className="hf-btn hf-btn-primary">
              <Plus size={14} />
              Create First Course
            </button>
          )}
        </div>
      ) : (
        <div className="hf-card-grid-lg">
          {filteredCourses.map((course) => (
            <Link
              key={course.id}
              href={`/x/courses/${course.id}`}
              className={`hf-card-compact hf-card-link${course.status === 'archived' ? ' hf-faded' : ''}`}
            >
              <div className="hf-flex hf-flex-between hf-items-start hf-mb-sm">
                <h3 className="hf-heading-sm hf-mb-0 hf-flex-1">{course.name}</h3>
                <StatusBadge status={statusMap[course.status] || 'draft'} size="compact" />
              </div>
              <div className="hf-mb-sm">
                <DomainPill label={course.domain.name} size="compact" />
              </div>
              {course.description && (
                <p className="hf-text-xs hf-text-muted hf-mb-sm hf-line-clamp-2">{course.description}</p>
              )}
              <div className="hf-flex hf-gap-md hf-text-xs hf-text-muted hf-items-center">
                <span><Users size={12} className="hf-icon-inline" /><strong>{course.studentCount}</strong> {plural('caller').toLowerCase()}</span>
                <span><strong>{course.specCount}</strong> content</span>
                <span className="hf-text-placeholder">v{course.version}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
