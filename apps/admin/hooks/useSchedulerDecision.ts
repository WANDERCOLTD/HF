'use client';

import { useState, useEffect, useCallback } from 'react';
import type { SchedulerMode } from '@/lib/pipeline/scheduler-decision';

/**
 * #917 Slice 2 — public shape of a scheduler decision as returned by
 * `/api/student/scheduler-decision`. Internal fields (`outcomeId`,
 * `contentSourceId`, `workingSetAssertionIds`) are stripped at the route
 * boundary and never reach the learner.
 */
export interface SchedulerDecisionView {
  mode: SchedulerMode;
  reason: string | null;
  callsSinceAssess: number | null;
  writtenAt: string;
}

interface UseSchedulerDecisionResult {
  data: SchedulerDecisionView | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useSchedulerDecision(callerId: string): UseSchedulerDecisionResult {
  const [data, setData] = useState<SchedulerDecisionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDecision = useCallback(async () => {
    if (!callerId) return;
    setLoading(true);
    setError(null);
    try {
      // Both STUDENT (callerId from session) and OPERATOR+ (callerId from query)
      // paths are supported by /api/student/* routes via requireStudentOrAdmin.
      // The query param IS required for OPERATOR — see lib/student-access.ts:151.
      // (Previously stripped in #917 cleanup; restored in this fix.)
      const res = await fetch(
        `/api/student/scheduler-decision?callerId=${encodeURIComponent(callerId)}`,
      );
      if (!res.ok) {
        setError(`Failed to load scheduler decision (${res.status})`);
        return;
      }
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? 'Unknown error');
        return;
      }
      setData(json.decision ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [callerId]);

  useEffect(() => {
    fetchDecision();
  }, [fetchDecision]);

  return { data, loading, error, refresh: fetchDecision };
}
