'use client';

import { useRouter } from 'next/navigation';
import { PlayCircle, BookOpen, Users, GraduationCap, Building2 } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { useTaskPoll, type PollableTask } from '@/hooks/useTaskPoll';
import { useBackgroundTaskQueue } from '@/components/shared/ContentJobQueue';
import { useTerminology } from '@/contexts/TerminologyContext';
import { WizardSummary } from '@/components/shared/WizardSummary';
import type { AgentTunerPill } from '@/lib/agent-tuner/types';
import { useStepFlow } from '@/contexts/StepFlowContext';
import type { StepProps } from '../CourseSetupWizard';

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

  // Read all flow bag keys
  const courseName = getData<string>('courseName');
  const teachingStyle = getData<string>('teachingStyle');
  const personaName = getData<string>('personaName');
  const learningOutcomes = getData<string[]>('learningOutcomes') || [];

  // Lesson plan keys
  const lessonPlanMode = getData<string>('lessonPlanMode') || 'skipped';
  const planIntents = getData<{ sessionCount: number; durationMins: number; emphasis: string; assessments: string }>('planIntents');
  const sessionCount = getData<number>('sessionCount') || planIntents?.sessionCount || 12;
  const durationMins = getData<number>('durationMins') || planIntents?.durationMins || 30;
  const emphasis = getData<string>('emphasis') || planIntents?.emphasis || 'balanced';

  // Student keys
  const studentEmails = getData<string[]>('studentEmails') || [];
  const cohortGroupIds = getData<string[]>('cohortGroupIds') || [];
  const selectedCallerIds = getData<string[]>('selectedCallerIds') || [];
  const totalStudents = studentEmails.length + cohortGroupIds.length + selectedCallerIds.length;

  // Config keys (AgentTuner behavior targets + pills)
  const behaviorTargets = getData<Record<string, number>>('behaviorTargets');
  const tunerPills = getData<AgentTunerPill[]>('tunerPills') || [];

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

    try {
      const res = await fetch('/api/courses/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseName,
          learningOutcomes,
          teachingStyle,
          sessionCount,
          durationMins,
          emphasis,
          welcomeMessage: getData<string>('welcomeMessage') || '',
          studentEmails,
          subjectId: getData<string>('subjectId') || undefined,
          curriculumId: getData<string>('curriculumId') || undefined,
          sourceId: getData<string>('sourceId') || undefined,
          planIntents: planIntents || undefined,
          lessonPlanMode,
          cohortGroupIds: cohortGroupIds.length > 0 ? cohortGroupIds : undefined,
          selectedCallerIds: selectedCallerIds.length > 0 ? selectedCallerIds : undefined,
          behaviorTargets: behaviorTargets && Object.keys(behaviorTargets).length > 0 ? behaviorTargets : undefined,
          wizardTaskId: wizardTaskId || undefined,
        }),
      });

      const data = await res.json();

      if (!data.ok) {
        throw new Error(data.error || 'Failed to start course setup');
      }

      setData('taskId', data.taskId);
      setTaskId(data.taskId);
      addCourseSetupJob(data.taskId, courseName || 'Course Setup');
    } catch (err: any) {
      setError(err.message || 'Failed to launch course setup');
      setLoading(false);
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

    // Build tuning traits from pills
    const tuningTraits = tunerPills
      .map(p => p.label)
      .filter(Boolean);
    const paramCount = behaviorTargets ? Object.keys(behaviorTargets).length : 0;

    return (
      <div className="min-h-screen flex flex-col">
        <div className="flex-1 p-8 max-w-2xl mx-auto w-full">
          <WizardSummary
            title="Course Created Successfully!"
            subtitle={taskSummary?.invitationCount
              ? `Your AI tutor is ready. ${taskSummary.invitationCount} student${taskSummary.invitationCount !== 1 ? 's' : ''} enrolled and ready to learn.`
              : "Your AI tutor is ready. Students can now join and start learning."
            }
            intent={{
              items: [
                { icon: <BookOpen className="w-4 h-4" />, label: 'Course', value: courseName || '—' },
                { icon: <GraduationCap className="w-4 h-4" />, label: 'Sessions', value: `${sessionCount} × ${durationMins} min` },
                { icon: <Users className="w-4 h-4" />, label: 'Style', value: personaName || teachingStyle || '—' },
                ...(learningOutcomes.length > 0
                  ? [{ label: 'Goals', value: `${learningOutcomes.length} learning outcome${learningOutcomes.length !== 1 ? 's' : ''}` }]
                  : []),
              ],
            }}
            created={{
              entities: [
                ...(domainId ? [{
                  icon: <Building2 className="w-5 h-5" />,
                  label: terms.domain,
                  name: domainName,
                  href: `/x/domains?id=${domainId}`,
                }] : []),
                ...(taskSummary?.playbook ? [{
                  icon: <BookOpen className="w-5 h-5" />,
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
              label: 'Start Teaching',
              icon: <PlayCircle className="w-5 h-5" />,
              onClick: () => {
                endFlow();
                router.push(domainId ? `/x/teach?domainId=${domainId}` : '/x/courses');
              },
            }}
            secondaryActions={[
              { label: 'Back to Courses', onClick: handleGoToCourses },
            ]}
          />
        </div>
      </div>
    );
  }

  // ── Loading / Error State ──────────────────────────
  if (loading || taskId) {
    return (
      <div className="min-h-screen flex flex-col">
        <div className="flex-1 p-8 max-w-2xl mx-auto w-full flex flex-col items-center justify-center">
          <div className="text-center">
            {taskProgress?.error || error ? (
              <>
                <div className="text-5xl mb-4">&#x274C;</div>
                <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--status-error-text)" }}>
                  Course Setup Failed
                </h1>
                <p className="text-[var(--text-secondary)] mb-6">
                  {error || taskProgress?.error || 'An error occurred while creating the course'}
                </p>
              </>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
                  <div className="hf-spinner" style={{ width: 48, height: 48, borderWidth: 3 }} />
                </div>
                <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">
                  Creating Your Course
                </h1>
                <p className="text-[var(--text-secondary)] mb-4">
                  {taskProgress?.message || 'Setting up...'}
                </p>
                {taskProgress?.totalSteps && (
                  <div className="w-full max-w-xs mx-auto bg-[var(--surface-secondary)] rounded-full h-2">
                    <div
                      className="bg-[var(--accent)] h-2 rounded-full transition-all duration-300"
                      style={{
                        width: `${
                          ((taskProgress.stepIndex || 0) + 1) /
                          (taskProgress.totalSteps || 1) *
                          100
                        }%`,
                      }}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Error Actions */}
        {(error || taskProgress?.error) && (
          <div className="p-6 border-t border-[var(--border-default)] bg-[var(--surface-secondary)]">
            <div className="max-w-2xl mx-auto flex gap-3">
              <button
                onClick={() => {
                  setLoading(false);
                  setTaskId(null);
                  setTaskProgress(null);
                  setError(null);
                  setData('taskId', undefined);
                  // Use rAF to ensure state clears before re-launching
                  requestAnimationFrame(() => handleLaunch());
                }}
                className="hf-btn hf-btn-primary"
                style={{ flex: 1 }}
              >
                Retry
              </button>
              <button
                onClick={handleGoToCourses}
                className="hf-btn hf-btn-secondary"
                style={{ flex: 1 }}
              >
                Back to Courses
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Pre-launch Review State ────────────────────────
  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 p-8 max-w-2xl mx-auto w-full">
        <WizardSummary
          title="Ready to Launch"
          subtitle="Review your course and launch when ready"
          intent={{
            items: [
              { icon: <BookOpen className="w-4 h-4" />, label: 'Course', value: courseName || '—' },
              { icon: <GraduationCap className="w-4 h-4" />, label: 'Sessions', value: `${sessionCount} × ${durationMins} min` },
              { icon: <Users className="w-4 h-4" />, label: 'Students', value: totalStudents > 0 ? `${totalStudents} to enroll` : 'None yet' },
              { label: 'Plan', value: lessonPlanMode === 'reviewed' ? 'Custom plan' : lessonPlanMode === 'accept' ? 'Auto-generated' : 'Defaults' },
              { label: 'Style', value: personaName || teachingStyle || '—' },
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
            icon: <PlayCircle className="w-5 h-5" />,
            onClick: handleLaunch,
            disabled: loading,
          }}
          secondaryActions={[
            {
              label: 'Cancel',
              onClick: handleGoToCourses,
            },
          ]}
          onBack={onPrev}
        />
      </div>
    </div>
  );
}
