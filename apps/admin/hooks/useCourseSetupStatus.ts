'use client';

import { useMemo } from 'react';
import type { SourceStatusData } from '@/components/shared/SourceStatusDots';

// ── Types ──────────────────────────────────────────────

export type StageStatus = 'done' | 'active' | 'pending' | 'error';

export interface SetupStage {
  /** 1-based stage number */
  number: number;
  /** Educator-friendly label */
  label: string;
  /** Status */
  status: StageStatus;
  /** Short detail text (e.g. "3 files uploaded", "Extracting...") */
  detail: string;
}

export interface CourseSetupStatus {
  stages: SetupStage[];
  /** Number of completed stages */
  completedCount: number;
  /** All 6 done? */
  allComplete: boolean;
  /** Index of the current in-progress or next pending stage (0-based) */
  currentStageIndex: number;
  /** Hint text for next action */
  nextHint: string;
}

// ── Input shapes (match what page.tsx already has) ─────

export interface SetupStatusInput {
  /** Playbook detail — null if not loaded yet */
  detail: {
    id: string;
    name: string;
    status: string;
    domain: { id: string; name: string };
    config?: Record<string, unknown> | null;
  } | null;

  /** Subjects summary */
  subjects: Array<{
    id: string;
    name: string;
    sourceCount: number;
    assertionCount: number;
    sources?: Array<{ id: string; name: string; documentType: string; assertionCount: number }>;
  }>;

  /** Source status map from useSourceStatus hook (sourceId → status) */
  sourceStatusMap: Record<string, SourceStatusData>;

  /** Sessions/lesson plan data */
  sessions: {
    plan: {
      estimatedSessions: number;
      entries: unknown[];
      generatedAt?: string | null;
    } | null;
  } | null;

  /** Readiness data from /api/courses/:id/setup-status or inline */
  readiness: {
    lessonPlanBuilt?: boolean;
    onboardingConfigured: boolean;
    promptComposable: boolean;
    allCriticalPass: boolean;
  } | null;
}

// ── Hook ──────────────────────────────────────────────

export function useCourseSetupStatus(input: SetupStatusInput): CourseSetupStatus {
  return useMemo(() => deriveStages(input), [
    input.detail?.id,
    input.detail?.status,
    input.subjects.length,
    JSON.stringify(Object.keys(input.sourceStatusMap)),
    input.sessions?.plan?.estimatedSessions,
    input.readiness?.lessonPlanBuilt,
    input.readiness?.allCriticalPass,
  ]);
}

// ── Pure derivation (testable) ────────────────────────

export function deriveStages(input: SetupStatusInput): CourseSetupStatus {
  const { detail, subjects, sourceStatusMap, sessions, readiness } = input;

  const stages: SetupStage[] = [];

  // ── Stage 1: Course Created ─────────────────────────
  const hasPlaybook = !!detail;
  const hasSubjects = subjects.length > 0;
  const stage1Done = hasPlaybook && hasSubjects;
  stages.push({
    number: 1,
    label: 'Course Created',
    status: stage1Done ? 'done' : hasPlaybook ? 'active' : 'pending',
    detail: stage1Done
      ? `${detail!.name}`
      : hasPlaybook
        ? 'Add a subject to continue'
        : 'Setting up...',
  });

  // ── Stage 2: Content Uploaded ───────────────────────
  const totalSourceCount = subjects.reduce((acc, s) => acc + s.sourceCount, 0);
  const stage2Done = totalSourceCount > 0;
  stages.push({
    number: 2,
    label: 'Content Uploaded',
    status: stage2Done ? 'done' : stage1Done ? 'active' : 'pending',
    detail: stage2Done
      ? `${totalSourceCount} file${totalSourceCount !== 1 ? 's' : ''} uploaded`
      : 'Upload teaching materials',
  });

  // ── Stage 3: Teaching Points Ready ──────────────────
  // Aggregate extraction status from all sources
  const sourceStatuses = Object.values(sourceStatusMap);
  const totalAssertions = sourceStatuses.reduce((acc, s) => acc + s.assertionCount, 0);
  const anyExtracting = sourceStatuses.some(
    (s) => s.jobStatus === 'extracting' || s.jobStatus === 'importing' || s.jobStatus === 'pending'
  );
  const anyError = sourceStatuses.some((s) => s.jobStatus === 'error');
  const allDone = sourceStatuses.length > 0 && sourceStatuses.every(
    (s) => s.jobStatus === 'done' || s.assertionCount > 0
  );

  let stage3Status: StageStatus = 'pending';
  let stage3Detail = 'Waiting for content upload';
  if (anyError && !anyExtracting) {
    stage3Status = 'error';
    stage3Detail = 'Extraction failed — try re-extracting';
  } else if (allDone && totalAssertions > 0) {
    stage3Status = 'done';
    stage3Detail = `${totalAssertions} teaching point${totalAssertions !== 1 ? 's' : ''} found`;
  } else if (anyExtracting) {
    stage3Status = 'active';
    stage3Detail = totalAssertions > 0
      ? `Extracting... ${totalAssertions} points so far`
      : 'Extracting teaching points...';
  } else if (stage2Done && totalAssertions === 0) {
    // Uploaded but no extraction started/completed
    stage3Status = 'active';
    stage3Detail = 'Processing your content...';
  } else if (totalAssertions > 0) {
    // Has assertions from subjects even without source status data
    stage3Status = 'done';
    stage3Detail = `${totalAssertions} teaching point${totalAssertions !== 1 ? 's' : ''} found`;
  }

  // Also check assertion counts from subjects directly (fallback when no source status)
  if (stage3Status === 'pending' && subjects.some((s) => s.assertionCount > 0)) {
    const subjectTotal = subjects.reduce((acc, s) => acc + s.assertionCount, 0);
    stage3Status = 'done';
    stage3Detail = `${subjectTotal} teaching point${subjectTotal !== 1 ? 's' : ''} found`;
  }

  stages.push({
    number: 3,
    label: 'Teaching Points Ready',
    status: stage3Status,
    detail: stage3Detail,
  });

  // ── Stage 4: Lesson Plan Built ──────────────────────
  // sessions?.plan is only loaded when the Sessions tab is opened,
  // so fall back to the readiness endpoint which checks DB directly
  const hasPlan = !!(sessions?.plan && sessions.plan.entries.length > 0)
    || (readiness?.lessonPlanBuilt ?? false);
  const planSessions = sessions?.plan?.estimatedSessions ?? 0;
  const suggestedCount = (detail?.config as Record<string, unknown> | undefined)?.suggestedSessionCount as number | undefined;
  const confirmedCount = (detail?.config as Record<string, unknown> | undefined)?.sessionCount as number | undefined;

  let stage4Detail = 'Generate a lesson plan';
  if (hasPlan) {
    const sessionLabel = `${planSessions} session${planSessions !== 1 ? 's' : ''} planned`;
    if (suggestedCount && suggestedCount !== planSessions) {
      stage4Detail = `${sessionLabel} (suggested ${suggestedCount})`;
    } else {
      stage4Detail = sessionLabel;
    }
  } else if (confirmedCount || suggestedCount) {
    stage4Detail = `Suggested: ${suggestedCount ?? confirmedCount} sessions`;
  }

  stages.push({
    number: 4,
    label: 'Lesson Plan Built',
    status: hasPlan ? 'done' : stage3Status === 'done' ? 'active' : 'pending',
    detail: stage4Detail,
  });

  // ── Stage 5: Tutor Configured (parallel with stage 4) ──
  // Unlocks after stage 3 (Foundation complete), NOT after stage 4
  const onboardingOk = readiness?.onboardingConfigured ?? false;
  stages.push({
    number: 5,
    label: 'Tutor Configured',
    status: onboardingOk ? 'done' : stage3Status === 'done' ? 'active' : 'pending',
    detail: onboardingOk ? 'Welcome experience ready' : 'Set up the welcome message',
  });

  // ── Stage 6: Ready to Teach (gates on BOTH 4 + 5) ────
  const allCritical = readiness?.allCriticalPass ?? false;
  const bothConfigured = hasPlan && onboardingOk;
  stages.push({
    number: 6,
    label: 'Ready to Teach',
    status: allCritical ? 'done' : bothConfigured ? 'active' : 'pending',
    detail: allCritical
      ? 'Ready for practice calls'
      : bothConfigured
        ? 'Running final checks...'
        : 'Complete steps 4 and 5',
  });

  // ── Summary ────────────────────────────────────────
  const completedCount = stages.filter((s) => s.status === 'done').length;
  const allComplete = completedCount === 6;

  // Parallel-aware: stages 4+5 can both be active simultaneously
  const activeStages = stages.filter((s) => s.status === 'active');
  const pendingStages = stages.filter((s) => s.status === 'pending');
  const currentStageIndex = activeStages.length > 0
    ? stages.indexOf(activeStages[0])
    : pendingStages.length > 0
      ? stages.indexOf(pendingStages[0])
      : 5;

  // Build next hint — parallel-aware
  let nextHint: string;
  if (allComplete) {
    nextHint = 'Course is ready — try a practice call!';
  } else if (activeStages.length > 1) {
    // Multiple active (stages 4+5 both in progress)
    nextHint = 'Build your lesson plan and configure the tutor — in any order';
  } else {
    const hints: Record<number, string> = {
      0: 'Add a subject to your course',
      1: 'Upload content files to begin',
      2: 'Teaching points are being extracted...',
      3: 'Build a lesson plan and configure the tutor',
      4: 'Configure the welcome message and tutor persona',
      5: 'All steps complete — try a practice call!',
    };
    nextHint = hints[currentStageIndex] ?? '';
  }

  return { stages, completedCount, allComplete, currentStageIndex, nextHint };
}
