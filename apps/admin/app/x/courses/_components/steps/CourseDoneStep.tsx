'use client';

import { useRouter } from 'next/navigation';
import { PlayCircle, BookOpen, Users, GraduationCap, Building2, FileText, Sparkles, ChevronRight, ChevronDown, MessageCircle } from 'lucide-react';
import { OnboardingPreview } from '@/components/shared/OnboardingPreview';
import { ClipboardList } from 'lucide-react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { TeachMethodStats } from '@/components/shared/TeachMethodStats';
import { useTaskPoll, type PollableTask } from '@/hooks/useTaskPoll';
import { useBackgroundTaskQueue } from '@/components/shared/ContentJobQueue';
import { useTerminology } from '@/contexts/TerminologyContext';
import { WizardSummary } from '@/components/shared/WizardSummary';
import type { AgentTunerPill } from '@/lib/agent-tuner/types';
import { useStepFlow } from '@/contexts/StepFlowContext';
import type { StepProps } from '../CourseSetupWizard';

/** @system-constant course-setup — Launch API timeout in ms (2 minutes) */
const LAUNCH_TIMEOUT_MS = 120_000;

interface TaskSummary {
  domain?: { id: string; name: string; slug: string; institutionId?: string };
  playbook?: { id: string; name: string };
  contentSpecId?: string | null;
  curriculumId?: string | null;
  invitationCount?: number;
  warnings?: string[];
}

export function CourseDoneStep({ getData, setData, onPrev, endFlow }: StepProps) {
  const { addCourseSetupJob } = useBackgroundTaskQueue();
  const { terms } = useTerminology();
  const { taskId: wizardTaskId } = useStepFlow();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskProgress, setTaskProgress] = useState<{
    message: string;
    phase: string;
    stepIndex?: number;
    totalSteps?: number;
    error?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [taskSummary, setTaskSummary] = useState<TaskSummary | null>(null);
  const [contentMethods, setContentMethods] = useState<{ teachMethod: string; count: number }[]>([]);
  const [contentTotal, setContentTotal] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const launchAbortRef = useRef<AbortController | null>(null);

  // Read all flow bag keys
  const courseName = getData<string>('courseName');
  const teachingStyle = getData<string>('teachingStyle');
  const personaName = getData<string>('personaName');
  const teachingStyleLabel = personaName || (teachingStyle ? teachingStyle.charAt(0).toUpperCase() + teachingStyle.slice(1) : null);
  const interactionPattern = getData<string>('interactionPattern');
  const interactionPatternName = getData<string>('interactionPatternName') || interactionPattern || '—';
  const learningOutcomes = getData<string[]>('learningOutcomes') || [];
  const lessonPlanMode = getData<string>('lessonPlanMode') || 'skipped';
  const lessonPlanModel = getData<string>('lessonPlanModel') || 'direct_instruction';
  const teachingMode = getData<string>('teachingMode');
  const subjectDiscipline = getData<string>('subjectDiscipline');
  const audience = getData<string>('audience');
  const planIntents = getData<{ sessionCount: number; durationMins: number; emphasis: string; assessments: string }>('planIntents');
  const sessionCount = getData<number>('sessionCount') || planIntents?.sessionCount || 6;
  const durationMins = getData<number>('durationMins') || planIntents?.durationMins || 15;
  const emphasis = getData<string>('emphasis') || planIntents?.emphasis || 'balanced';
  const studentEmails = getData<string[]>('studentEmails') || [];
  const cohortGroupIds = getData<string[]>('cohortGroupIds') || [];
  const selectedCallerIds = getData<string[]>('selectedCallerIds') || [];
  const totalStudents = studentEmails.length + cohortGroupIds.length + selectedCallerIds.length;
  const behaviorTargets = getData<Record<string, number>>('behaviorTargets');
  const tunerPills = getData<AgentTunerPill[]>('tunerPills') || [];
  const lessonPlan = getData<{ session: number; type: string; label: string }[]>('lessonPlan') || [];
  const flowPhases = getData<Array<{ phase: string; duration: string; goals: string[] }>>('flowPhases') || [];
  const welcomeMsg = getData<string>('welcomeMessage') || '';
  const packSubjects = getData<Array<{ id: string; name: string }>>('packSubjects') || [];
  const packSubjectIds = packSubjects.map((s) => s.id).filter(Boolean);

  // Survey selections — default pre+post ON, mid OFF
  const [surveyPre, setSurveyPre] = useState(true);
  const [surveyMid, setSurveyMid] = useState(false);
  const [surveyPost, setSurveyPost] = useState(true);

  // Build plan summary from actual lesson plan entries
  const planSummaryValue = (() => {
    if (lessonPlan.length === 0) {
      return lessonPlanMode === 'reviewed' ? 'Custom plan' : 'Defaults';
    }
    const typeCounts: Record<string, number> = {};
    for (const entry of lessonPlan) {
      typeCounts[entry.type] = (typeCounts[entry.type] || 0) + 1;
    }
    const parts: string[] = [];
    const order = ['onboarding', 'introduce', 'deepen', 'review', 'assess', 'consolidate'];
    for (const t of order) {
      if (typeCounts[t]) parts.push(`${typeCounts[t]} ${t}`);
    }
    return `${lessonPlan.length} sessions (${parts.join(', ')})`;
  })();

  // On mount: resume if taskId already in flow bag (page refresh during setup)
  useEffect(() => {
    const existingTaskId = getData<string>('taskId');
    if (existingTaskId) {
      setTaskId(existingTaskId);
      setLoading(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll task via gold-standard hook (3s interval, 3min timeout, orphan detection)
  useTaskPoll({
    taskId,
    onProgress: useCallback((task: PollableTask) => {
      const ctx = task.context || {};
      setTaskProgress({
        message: ctx.message || ctx.phase || '',
        phase: ctx.phase || '',
        stepIndex: ctx.stepIndex,
        totalSteps: ctx.totalSteps,
        error: ctx.error,
      });
    }, []),
    onComplete: useCallback((task: PollableTask) => {
      setData('taskId', undefined);
      const summary = task.context?.summary || null;
      setTaskSummary(summary);
      setCompleted(true);
      setLoading(false);

      // Fetch teach method breakdown if we have a playbook
      const pbId = summary?.playbook?.id;
      if (pbId) {
        fetch(`/api/courses/${pbId}/content-breakdown`)
          .then((r) => r.json())
          .then((data) => {
            if (data.ok && data.methods?.length > 0) {
              setContentMethods(data.methods);
              setContentTotal(data.total || 0);
            }
          })
          .catch(() => {});
      }
    }, [setData]),
    onError: useCallback((message: string, task?: PollableTask) => {
      setError(task?.context?.error || message);
      setLoading(false);
    }, []),
  });

  const handleLaunch = async () => {
    setLoading(true);
    setError(null);

    // Abort any previous in-flight launch
    launchAbortRef.current?.abort();
    const controller = new AbortController();
    launchAbortRef.current = controller;

    // Timeout guard
    const timeout = setTimeout(() => controller.abort(), LAUNCH_TIMEOUT_MS);

    try {
      const res = await fetch('/api/courses/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseName, learningOutcomes, teachingStyle, sessionCount, durationMins, emphasis, lessonPlanModel,
          domainId: getData<string>('domainId') || undefined,
          interactionPattern: interactionPattern || undefined,
          teachingMode: teachingMode || undefined,
          subjectDiscipline: subjectDiscipline || undefined,
          audience: audience || undefined,
          welcomeMessage: getData<string>('welcomeMessage') || '',
          studentEmails,
          subjectId: getData<string>('subjectId') || undefined,
          curriculumId: getData<string>('curriculumId') || undefined,
          planIntents: planIntents || undefined,
          lessonPlanMode,
          cohortGroupIds: cohortGroupIds.length > 0 ? cohortGroupIds : undefined,
          selectedCallerIds: selectedCallerIds.length > 0 ? selectedCallerIds : undefined,
          behaviorTargets: behaviorTargets && Object.keys(behaviorTargets).length > 0 ? behaviorTargets : undefined,
          wizardTaskId: wizardTaskId || undefined,
          groupId: getData<string>('groupId') || undefined,
          onboardingFlowPhases: flowPhases && flowPhases.length > 0 ? flowPhases : undefined,
          packSubjectIds: packSubjectIds.length > 0 ? packSubjectIds : undefined,
          surveySelections: { pre: surveyPre, mid: surveyMid, post: surveyPost },
        }),
        signal: controller.signal,
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Failed to start course setup');

      setData('taskId', data.taskId);
      setTaskId(data.taskId);
      addCourseSetupJob(data.taskId, courseName || 'Course Setup');
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setError('Request timed out. The server may be busy — please retry.');
      } else {
        setError(err.message || 'Failed to launch course setup');
      }
      setLoading(false);
    } finally {
      clearTimeout(timeout);
    }
  };

  const handleGoToCourses = () => {
    endFlow();
    const pbId = taskSummary?.playbook?.id;
    router.push(pbId ? `/x/courses/${pbId}` : '/x/courses');
  };

  // ── Success State ──────────────────────────────────
  if (completed && !loading) {
    const domainId = taskSummary?.domain?.id;
    const domainName = taskSummary?.domain?.name || courseName || 'Your Course';
    const tuningTraits = tunerPills.map(p => p.label).filter(Boolean);
    const paramCount = behaviorTargets ? Object.keys(behaviorTargets).length : 0;

    return (
      <div className="hf-wizard-page">
        <div className="hf-wizard-step">
          <WizardSummary
            title="Course Created Successfully!"
            subtitle={taskSummary?.invitationCount
              ? `Your AI tutor is ready. ${taskSummary.invitationCount} student${taskSummary.invitationCount !== 1 ? 's' : ''} enrolled and ready to learn.`
              : "Your AI tutor is ready. Students can now join and start learning."
            }
            intent={{
              items: [
                { icon: <BookOpen className="hf-icon-sm" />, label: 'Course', value: courseName || '—' },
                ...(teachingStyleLabel
                  ? [{ icon: <Sparkles className="hf-icon-sm" />, label: 'Teaching Style', value: teachingStyleLabel }]
                  : []),
                { icon: <GraduationCap className="hf-icon-sm" />, label: 'Sessions', value: `${sessionCount} × ${durationMins} min` },
                { icon: <Users className="hf-icon-sm" />, label: 'Pattern', value: interactionPatternName },
                ...(lessonPlan.length > 0
                  ? [{ icon: <FileText className="hf-icon-sm" />, label: 'Plan', value: planSummaryValue }]
                  : []),
                ...(learningOutcomes.length > 0
                  ? [{ label: 'Goals', value: `${learningOutcomes.length} learning outcome${learningOutcomes.length !== 1 ? 's' : ''}` }]
                  : []),
                ...([surveyPre && 'Pre', surveyMid && 'Mid', surveyPost && 'Post'].filter(Boolean).length > 0
                  ? [{ icon: <ClipboardList className="hf-icon-sm" />, label: 'Surveys', value: [surveyPre && 'Pre', surveyMid && 'Mid', surveyPost && 'Post'].filter(Boolean).join(' + ') }]
                  : [{ icon: <ClipboardList className="hf-icon-sm" />, label: 'Surveys', value: 'None' }]),
              ],
            }}
            created={{
              entities: [
                ...(domainId ? [{
                  icon: <Building2 className="hf-icon-md" />,
                  label: terms.domain,
                  name: domainName,
                  href: taskSummary?.domain?.institutionId
                    ? `/x/institutions/${taskSummary.domain.institutionId}`
                    : `/x/institutions`,
                }] : []),
                ...(taskSummary?.playbook ? [{
                  icon: <BookOpen className="hf-icon-md" />,
                  label: 'Course',
                  name: taskSummary.playbook.name || courseName || '—',
                  href: `/x/courses/${taskSummary.playbook.id}`,
                }] : []),
              ],
            }}
            stats={[
              { label: 'Sessions', value: sessionCount },
              { label: 'Duration', value: `${durationMins}m` },
              { label: 'Students', value: (taskSummary?.invitationCount ?? totalStudents) > 0 ? (taskSummary?.invitationCount ?? totalStudents) : '—' },
              ...(emphasis !== 'balanced' ? [{ label: 'Focus', value: emphasis }] : []),
            ]}
            tuning={tuningTraits.length > 0 ? { traits: tuningTraits, paramCount } : undefined}
            primaryAction={{
              label: 'View Your Course',
              icon: <BookOpen className="hf-icon-md" />,
              onClick: () => {
                endFlow();
                const pbId = taskSummary?.playbook?.id;
                router.push(pbId ? `/x/courses/${pbId}` : '/x/courses');
              },
            }}
            secondaryActions={[
              {
                label: 'Start Teaching',
                icon: <PlayCircle className="hf-icon-md" />,
                onClick: () => {
                  endFlow();
                  router.push(domainId ? `/x/teach?domainId=${domainId}` : '/x/courses');
                },
              },
            ]}
          >
            {contentMethods.length > 0 && (
              <div className="hf-mt-md">
                <div className="hf-text-xs hf-text-bold hf-text-muted hf-uppercase hf-mb-sm">
                  Teaching Methods
                </div>
                <TeachMethodStats methods={contentMethods} total={contentTotal} />
              </div>
            )}
          </WizardSummary>
        </div>
      </div>
    );
  }

  // ── Loading / Error State ──────────────────────────
  if (loading || taskId) {
    const hasError = !!(error || taskProgress?.error);
    return (
      <div className="hf-wizard-page">
        <div className="hf-wizard-step hf-flex hf-flex-col hf-items-center hf-justify-center">
          <div className="hf-text-center">
            {hasError ? (
              <>
                <div className="hf-text-xl hf-mb-md">&#x274C;</div>
                <h1 className="hf-page-title hf-mb-xs hf-text-error">
                  Course Setup Failed
                </h1>
                <p className="hf-page-subtitle hf-mb-lg">
                  {error || taskProgress?.error || 'An error occurred while creating the course'}
                </p>
              </>
            ) : (
              <>
                <div className="hf-flex hf-justify-center hf-mb-md">
                  <div className="hf-spinner hf-icon-xl hf-spinner-thick" />
                </div>
                <h1 className="hf-page-title hf-mb-xs">Creating Your Course</h1>
                <p className="hf-page-subtitle hf-mb-md">
                  {taskProgress?.message || 'Setting up...'}
                </p>
                {taskProgress?.totalSteps && (
                  <div className="hf-progress-bar">
                    <div
                      className="hf-progress-fill"
                      style={{
                        width: `${((taskProgress.stepIndex || 0) + 1) / (taskProgress.totalSteps || 1) * 100}%`,
                      }}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Always show footer — error gets Retry, polling gets Cancel */}
        <div className="hf-step-footer">
          <button onClick={handleGoToCourses} className="hf-btn hf-btn-secondary">
            {hasError ? 'Back to Courses' : 'Cancel'}
          </button>
          {hasError && (
            <button
              onClick={() => {
                setLoading(false);
                setTaskId(null);
                setTaskProgress(null);
                setError(null);
                setData('taskId', undefined);
                requestAnimationFrame(() => handleLaunch());
              }}
              className="hf-btn hf-btn-primary"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Pre-launch Review State ────────────────────────
  return (
    <div className="hf-wizard-page">
      <div className="hf-wizard-step">
        <WizardSummary
          title="Ready to Launch"
          subtitle="Review your course and launch when ready"
          intent={{
            items: [
              { icon: <BookOpen className="hf-icon-sm" />, label: 'Course', value: courseName || '—' },
              ...(teachingStyleLabel
                ? [{ icon: <Sparkles className="hf-icon-sm" />, label: 'Teaching Style', value: teachingStyleLabel }]
                : []),
              { icon: <GraduationCap className="hf-icon-sm" />, label: 'Sessions', value: `${sessionCount} × ${durationMins} min` },
              { icon: <Users className="hf-icon-sm" />, label: 'Students', value: totalStudents > 0 ? `${totalStudents} to enroll` : 'None yet' },
              { icon: <FileText className="hf-icon-sm" />, label: 'Plan', value: planSummaryValue },
              { label: 'Pattern', value: interactionPatternName },
            ],
          }}
          stats={[
            { label: 'Sessions', value: sessionCount },
            { label: 'Duration', value: `${durationMins}m` },
            { label: 'Students', value: totalStudents || '—' },
          ]}
          tuning={tunerPills.length > 0 ? {
            traits: tunerPills.map(p => p.label).filter(Boolean),
            paramCount: behaviorTargets ? Object.keys(behaviorTargets).length : 0,
          } : undefined}
          primaryAction={{
            label: 'Launch Course',
            icon: <PlayCircle className="hf-icon-md" />,
            onClick: handleLaunch,
            disabled: loading,
          }}
          secondaryActions={[
            { label: 'Cancel', onClick: handleGoToCourses },
          ]}
          onBack={onPrev}
        >
          {/* ── Learner Surveys ── */}
          <div className="hf-mt-md">
            <div className="hf-flex hf-items-center hf-gap-xs hf-mb-sm">
              <ClipboardList size={14} className="hf-text-muted" />
              <span className="hf-text-sm hf-text-bold">Learner Surveys</span>
            </div>
            <div className="hf-card-compact">
              <label className="hf-flex hf-items-center hf-gap-sm hf-mb-sm" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={surveyPre}
                  onChange={(e) => setSurveyPre(e.target.checked)}
                  className="hf-checkbox"
                />
                <span className="hf-text-sm">Pre-Survey</span>
                <span className="hf-text-xs hf-text-muted">— baseline confidence and goals</span>
              </label>
              <label className="hf-flex hf-items-center hf-gap-sm hf-mb-sm" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={surveyMid}
                  onChange={(e) => setSurveyMid(e.target.checked)}
                  className="hf-checkbox"
                />
                <span className="hf-text-sm">Mid-Survey</span>
                <span className="hf-text-xs hf-text-muted">— check in halfway through</span>
              </label>
              <label className="hf-flex hf-items-center hf-gap-sm" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={surveyPost}
                  onChange={(e) => setSurveyPost(e.target.checked)}
                  className="hf-checkbox"
                />
                <span className="hf-text-sm">Post-Survey</span>
                <span className="hf-text-xs hf-text-muted">— feedback and NPS</span>
              </label>
              <div className="hf-text-xs hf-text-muted hf-mt-sm">
                All surveys are optional for learners — they can skip if they prefer.
              </div>
            </div>
          </div>

          {/* ── First Call Preview (collapsible) ── */}
          {(flowPhases.length > 0 || welcomeMsg) && (
            <div className="hf-mt-md">
              <button
                className="hf-btn hf-btn-ghost"
                onClick={() => setPreviewOpen(!previewOpen)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0', width: '100%' }}
              >
                {previewOpen
                  ? <ChevronDown size={16} className="hf-text-muted" />
                  : <ChevronRight size={16} className="hf-text-muted" />
                }
                <MessageCircle size={14} className="hf-text-muted" />
                <span className="hf-text-sm hf-text-bold">First Call Preview</span>
                {flowPhases.length > 0 && (
                  <span className="hf-text-xs hf-text-muted" style={{ marginLeft: 'auto' }}>
                    {flowPhases.length} phase{flowPhases.length !== 1 ? 's' : ''}
                  </span>
                )}
              </button>

              {previewOpen && (
                <div style={{ paddingTop: 8 }}>
                  <OnboardingPreview
                    greeting={welcomeMsg}
                    personaName={personaName || undefined}
                    phases={flowPhases}
                    hint={`You can edit these in ${terms.domain} settings after launch.`}
                  />
                </div>
              )}
            </div>
          )}
        </WizardSummary>
      </div>
    </div>
  );
}
