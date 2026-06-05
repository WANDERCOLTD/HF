"use client";

import { useEffect, useState, useCallback } from "react";
import { useStudentCallerId } from "@/hooks/useStudentCallerId";
import type { MasteryTier } from "@/lib/curriculum/mastery-tiers";

/**
 * Client-side hook for the qualification dashboard data (#1098 Slice B).
 *
 * Wraps GET /api/student/qualification-progress with the same callerId scoping
 * convention as `useStudentCallerId`:
 *   - STUDENT sessions: callerId is omitted (server resolves from session)
 *   - Admin sessions: callerId comes from the URL `?callerId=` param
 *
 * Returned `data.qualification === null` is the documented signal that the
 * learner's active Curriculum has no qualificationAnchor — callers render the
 * existing generic progress surface and skip the qualification card.
 */

export interface QualificationProgressUnit {
  moduleSlug: string;
  displayName: string;
  tier: MasteryTier | null;
  losCovered: number;
  losTotal: number;
  weakestLoRef: string | null;
  learningObjectives: Array<{
    ref: string;
    displayName: string;
    learnerStatement: string;
    tier: MasteryTier | null;
    score: number;
  }>;
}

export interface QualificationProgressSkill {
  ref: string;
  name: string;
  tier: MasteryTier | null;
}

export interface QualificationProgressNextBestStep {
  courseType: string;
  moduleSlug: string;
  loRef: string | null;
  reason: string;
}

export interface QualificationProgressData {
  qualification: {
    anchor: string | null;
    displayName: string;
    qualificationBody: string | null;
    qualificationNumber: string | null;
    qualificationLevel: string | null;
    tier: MasteryTier | null;
    unitsCovered: number;
    unitsTotal: number;
    weakestUnitSlug: string | null;
    losAtTierOrAbove: number;
    losTotal: number;
  } | null;
  units: QualificationProgressUnit[];
  skills: QualificationProgressSkill[];
  recentActivity: unknown[];
  nextBestStep: QualificationProgressNextBestStep | null;
}

export interface UseQualificationProgressResult {
  data: QualificationProgressData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useQualificationProgress(): UseQualificationProgressResult {
  const { isAdmin, hasSelection, buildUrl } = useStudentCallerId();
  const [data, setData] = useState<QualificationProgressData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (isAdmin && !hasSelection) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(buildUrl("/api/student/qualification-progress"))
      .then((r) => r.json())
      .then((payload) => {
        if (cancelled) return;
        if (payload?.ok) {
          setData({
            qualification: payload.qualification ?? null,
            units: Array.isArray(payload.units) ? payload.units : [],
            skills: Array.isArray(payload.skills) ? payload.skills : [],
            recentActivity: Array.isArray(payload.recentActivity) ? payload.recentActivity : [],
            nextBestStep: payload.nextBestStep ?? null,
          });
        } else {
          setError(typeof payload?.error === "string" ? payload.error : "failed to load");
          setData(null);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, hasSelection, buildUrl, tick]);

  return { data, loading, error, refetch };
}
