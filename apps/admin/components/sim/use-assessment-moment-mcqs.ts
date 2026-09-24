"use client";

/**
 * W4 of `memory/handoff_lattice_all_settings_to_ui_2026_06_21.md` —
 * client hook that fetches the `MCQRoundsShell` data feed.
 *
 * Wraps `GET /api/callers/[callerId]/assessment-moment-mcqs?moduleSlug=…`
 * (the HTTP boundary of the canonical sampling engine at
 * `lib/assessment/sample-questions.ts`). The hook is intentionally
 * thin — fetch + abort + null-result handling. The route + engine own
 * the AppLog signalling on miss; this hook surfaces the typed
 * `reason` to the caller so the shell can render an honest empty
 * state.
 *
 * **No fake fallbacks** (operator-pinned, per
 * `feedback_no_hardcoded_score_backfill.md`):
 * - Engine miss → `mcqs: []`, `reason` populated, shell empty-state.
 * - Fetch / network error → `mcqs: []`, `error` populated.
 */

import { useEffect, useState } from "react";
import type {
  AssessmentMomentMCQsPayload,
  AssessmentMomentNullReason,
} from "@/app/api/callers/[callerId]/assessment-moment-mcqs/route";

export interface UseAssessmentMomentMCQsResult {
  /** Sampled MCQs (empty when result null or fetch error). */
  mcqs: AssessmentMomentMCQsPayload["mcqs"];
  /** The kind of moment that resolved (null when no moment). */
  momentKind: AssessmentMomentMCQsPayload["momentKind"] | null;
  /** Per-question feedback timing — drives shell behaviour. */
  feedbackMode: AssessmentMomentMCQsPayload["feedbackMode"];
  /** Typed reason when MCQs are empty by design (route's `reason`). */
  reason: AssessmentMomentNullReason | null;
  /** Transient fetch error message (null on success or while loading). */
  error: string | null;
  /** Loading flag — true while the fetch is in flight. */
  loading: boolean;
}

const EMPTY: UseAssessmentMomentMCQsResult = {
  mcqs: [],
  momentKind: null,
  feedbackMode: "immediate",
  reason: null,
  error: null,
  loading: false,
};

interface RouteResponse {
  ok?: boolean;
  result?: AssessmentMomentMCQsPayload | null;
  reason?: AssessmentMomentNullReason;
  error?: string;
}

/**
 * Fetch the MCQ feed for the supplied caller + module slug.
 *
 * Pass `{ enabled: false }` to skip the fetch (e.g. when the shell
 * mount precondition isn't met). The hook returns `EMPTY` until
 * enabled flips true.
 */
export function useAssessmentMomentMCQs({
  callerId,
  moduleSlug,
  enabled = true,
}: {
  callerId: string;
  moduleSlug: string | null | undefined;
  enabled?: boolean;
}): UseAssessmentMomentMCQsResult {
  const [state, setState] = useState<UseAssessmentMomentMCQsResult>(EMPTY);

  useEffect(() => {
    if (!enabled || !moduleSlug || !callerId) {
      // Reset to EMPTY only when our current state differs — avoids the
      // cascading-render lint warning when nothing has changed.
      setState((prev) =>
        prev.mcqs.length === 0 &&
        !prev.loading &&
        !prev.error &&
        !prev.momentKind &&
        !prev.reason
          ? prev
          : EMPTY,
      );
      return;
    }
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));
    fetch(
      `/api/callers/${encodeURIComponent(callerId)}/assessment-moment-mcqs?moduleSlug=${encodeURIComponent(
        moduleSlug,
      )}`,
      { signal: controller.signal, credentials: "same-origin" },
    )
      .then((res) =>
        res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)),
      )
      .then((body: RouteResponse | null) => {
        if (!body?.ok) {
          setState({
            ...EMPTY,
            error: body?.error ?? "Could not load MCQs.",
          });
          return;
        }
        if (!body.result) {
          setState({
            ...EMPTY,
            reason: body.reason ?? null,
          });
          return;
        }
        setState({
          mcqs: body.result.mcqs,
          momentKind: body.result.momentKind,
          feedbackMode: body.result.feedbackMode,
          reason: null,
          error: null,
          loading: false,
        });
      })
      .catch((err: unknown) => {
        if ((err as { name?: string } | null)?.name === "AbortError") return;
        setState({
          ...EMPTY,
          error: "Could not load MCQs.",
        });
      });
    return () => controller.abort();
  }, [callerId, moduleSlug, enabled]);

  return state;
}
