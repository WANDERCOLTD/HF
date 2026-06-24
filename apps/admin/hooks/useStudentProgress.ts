'use client';

import { useState, useEffect, useCallback } from 'react';

export interface StudentGoal {
  id: string;
  name: string;
  type: string;
  progress: number;
  description: string | null;
}

/**
 * #493 Slice 5.1 — per-module progress for the SimProgressPanel Modules section.
 * Status is API-mapped: DB "COMPLETED" surfaces as presentational "MASTERED".
 * LOCKED is computed on the client by E4's picker logic from prereqs +
 * strictPrerequisites flag — NOT included here.
 */
export interface StudentModuleProgress {
  id: string;
  slug: string;
  title: string;
  status: "MASTERED" | "IN_PROGRESS" | "NOT_STARTED";
  callCount: number;
  mastery: number;
  masteryThreshold: number;
  completedAt: string | null;
}

/**
 * #493 Slice 5.3 — populated by E2 ADAPT after a Mock call. Null until then.
 * Module IDs from the writer are resolved at the API boundary into
 * `{id, slug, title}` triples so the panel can render titles directly.
 */
export interface StudentModuleRef {
  id: string;
  slug: string;
  title: string;
}

export interface StudentDiagnosticFromMock {
  focusModules: StudentModuleRef[];
  strengthModule: StudentModuleRef | null;
  weakSkill: string | null;
  summary: string;
  fromCallId: string;
  generatedAt: string;
}

/**
 * #493 Slice 5.4 — populated by E2 once isCourseComplete() lands.
 */
export interface StudentCourseComplete {
  complete: boolean;
  mode: "all-modules" | "terminal-only" | "any";
  completedAt: string | null;
}

/**
 * #2277 Item #7 (D6) — `Session.metadata.lessonPlan` from the latest
 * COMPLETED Session, written by `pickNextRecommendedModule` at AGGREGATE.
 * `nextRecommended.moduleSlug` is what the FOH home highlights. Null
 * until a session whose module opted into `generateLessonPlan` completes.
 */
export interface StudentLessonPlan {
  focusCriterion: string;
  focusLabel: string;
  focusScore: number;
  reason: string;
  nextRecommendedModuleSlug?: string;
  emittedAt: string;
}

export interface StudentNextRecommended {
  moduleSlug: string;
  fromSessionId: string | null;
}

export interface StudentProgress {
  goals: StudentGoal[];
  totalCalls: number;
  topicCount: number;
  keyFactCount: number;
  topTopics: { topic: string; lastMentioned: string }[];
  testScores: {
    preTest: number | null;
    postTest: number | null;
    uplift: { absolute: number; normalised: number | null } | null;
  };
  classroom: string | null;
  domain: string | null;
  teacherName: string | null;
  institutionName: string | null;
  // #493 Slice 5.1 — per-module progress
  modules: StudentModuleProgress[];
  // #493 Slice 5.3 — null until E2 lands diagnosticFromMock writer
  diagnosticFromMock: StudentDiagnosticFromMock | null;
  // #493 Slice 5.4 — null until E2 lands isCourseComplete()
  courseComplete: StudentCourseComplete | null;
  // #2277 Item #7 (D6) — latest lesson plan + next-recommended module slug
  lessonPlan: StudentLessonPlan | null;
  nextRecommended: StudentNextRecommended | null;
}

interface UseStudentProgressResult {
  data: StudentProgress | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useStudentProgress(callerId: string): UseStudentProgressResult {
  const [data, setData] = useState<StudentProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProgress = useCallback(async () => {
    if (!callerId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/student/progress?callerId=${encodeURIComponent(callerId)}`);
      if (!res.ok) {
        setError(`Failed to load progress (${res.status})`);
        return;
      }
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? 'Unknown error');
        return;
      }
      setData({
        goals: json.goals ?? [],
        totalCalls: json.totalCalls ?? 0,
        topicCount: json.topicCount ?? 0,
        keyFactCount: json.keyFactCount ?? 0,
        topTopics: json.topTopics ?? [],
        testScores: json.testScores ?? { preTest: null, postTest: null, uplift: null },
        classroom: json.classroom ?? null,
        domain: json.domain ?? null,
        teacherName: json.teacherName ?? null,
        institutionName: json.institutionName ?? null,
        modules: json.modules ?? [],
        diagnosticFromMock: json.diagnosticFromMock ?? null,
        courseComplete: json.courseComplete ?? null,
        lessonPlan: json.lessonPlan ?? null,
        nextRecommended: json.nextRecommended ?? null,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [callerId]);

  useEffect(() => { fetchProgress(); }, [fetchProgress]);

  return { data, loading, error, refresh: fetchProgress };
}
