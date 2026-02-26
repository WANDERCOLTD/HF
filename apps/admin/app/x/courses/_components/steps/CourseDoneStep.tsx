'use client';

import { useRouter } from 'next/navigation';
import { PlayCircle, BookOpen, Users, GraduationCap, Building2, FileText } from 'lucide-react';
import { useState, useEffect, useCallback, useRef } from 'react';
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
  domain?: { id: string; name: string; slug: string };
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
  const launchAbortRef = useRef<AbortController | null>(null);

  // Read all flow bag keys
  const courseName = getData<string>('courseName');
  const teachingStyle = getData<string>('teachingStyle');
  const interactionPattern = getData<string>('interactionPattern');
  const interactionPatternName = getData<string>('interactionPatternName') || interactionPattern || '—';
  const learningOutcomes = getData<string[]>('learningOutcomes') || [];
  const lessonPlanMode = getData<string>('lessonPlanMode') || 'skipped';
  const planIntents = getData<{ sessionCount: number; durationMins: number; emphasis: string; assessments: string }>('planIntents');
  const sessionCount = getData<number>('sessionCount') || planIntents?.sessionCount || 12;
  const durationMins = getData<number>('durationMins') || planIntents?.durationMins || 30;
  const emphasis = getData<string>('emphasis') || planIntents?.emphasis || 'balanced';
  const studentEmails = getData<string[]>('studentEmails') || [];
  const cohortGroupIds = getData<string[]>('cohortGroupIds') || [];
  const selectedCallerIds = getData<string[]>('selectedCallerIds') || [];
  const totalStudents = studentEmails.length + cohortGroupIds.length + selectedCallerIds.length;
  const behaviorTargets = getData<Record<string, number>>('behaviorTargets');
  const tunerPills = getData<AgentTunerPill[]>('tunerPills') || [];
  const lessonPlan = getData<{ session: number; type: string; label: string }[]>('lessonPlan') || [];

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
      setTaskSummary(task.context?.summary || null);
      setCompleted(true);
      setLoading(false);
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
          courseName, learningOutcomes, teachingStyle, sessionCount, durationMins, emphasis,
          interactionPattern: interactionPattern || undefined,
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
                { icon: <GraduationCap className="hf-icon-sm" />, label: 'Sessions', value: `${sessionCount} × ${durationMins} min` },
                { icon: <Users className="hf-icon-sm" />, label: 'Pattern', value: interactionPatternName },
                ...(lessonPlan.length > 0
                  ? [{ icon: <FileText className="hf-icon-sm" />, label: 'Plan', value: planSummaryValue }]
                  : []),
                ...(learningOutcomes.length > 0
                  ? [{ label: 'Goals', value: `${learningOutcomes.length} learning outcome${learningOutcomes.length !== 1 ? 's' : ''}` }]
                  : []),
              ],
            }}
            created={{
              entities: [
                ...(domainId ? [{
                  icon: <Building2 className="hf-icon-md" />,
                  label: terms.domain,
                  name: domainName,
                  href: `/x/domains?id=${domainId}`,
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
          />
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
        />
      </div>
    </div>
  );
}
