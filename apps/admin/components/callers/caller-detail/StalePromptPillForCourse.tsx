"use client";

/**
 * StalePromptPillForCourse — #1429.
 *
 * Course-level sibling of `<StalePromptPill />`. Surfaces compose-input
 * staleness aggregated across the playbook's DEMO callers in the
 * `CourseDesignConsole` header — above the lens nav, mounted once.
 *
 * Self-hides when `staleCount === 0`. Otherwise renders the same
 * `hf-banner hf-banner-warning` visual treatment as the per-caller pill
 * + a `[Reprompt all]` button that fans out POSTs to
 * `/api/callers/:id/compose-prompt` (one per stale demo caller). While
 * the fan-out runs, the button shows a `hf-spinner` and per-caller
 * progress ("Reprompting 1 of 3…"). On completion the aggregate is
 * refetched (`?nocache=1`) and, if zero stale callers remain, the
 * banner self-hides.
 *
 * Data source: `GET /api/courses/:courseId/staleness-aggregate`.
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface StaleCallerEntry {
  callerId: string;
  name: string;
  lastComposedAt: string | null;
}

interface AggregateResponse {
  ok: boolean;
  totalDemoCallers?: number;
  staleCount?: number;
  staleCallers?: StaleCallerEntry[];
  error?: string;
}

interface StalePromptPillForCourseProps {
  courseId: string;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "recently";
  const diffSec = Math.floor((Date.now() - then) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export function StalePromptPillForCourse({
  courseId,
}: StalePromptPillForCourseProps) {
  const [data, setData] = useState<AggregateResponse | null>(null);
  const [reprompting, setReprompting] = useState(false);
  const [progressDone, setProgressDone] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchAggregate = useCallback(async (bypassCache: boolean) => {
    try {
      const url = bypassCache
        ? `/api/courses/${courseId}/staleness-aggregate?nocache=1`
        : `/api/courses/${courseId}/staleness-aggregate`;
      const res = await fetch(url);
      const json = (await res.json()) as AggregateResponse;
      if (!mountedRef.current) return;
      setData(json);
    } catch {
      // Silent — banner just doesn't render until next mount/refetch.
      if (mountedRef.current) setData(null);
    }
  }, [courseId]);

  useEffect(() => {
    mountedRef.current = true;
    // Defer the fetch to the next microtask so we don't call setState
    // synchronously inside the effect body (react-hooks/set-state-in-effect).
    queueMicrotask(() => {
      if (mountedRef.current) void fetchAggregate(false);
    });
    return () => {
      mountedRef.current = false;
    };
  }, [fetchAggregate]);

  const onRepromptAll = useCallback(async () => {
    const callers = data?.staleCallers ?? [];
    if (callers.length === 0) return;
    setReprompting(true);
    setError(null);
    setProgressDone(0);
    setProgressTotal(callers.length);

    let failures = 0;
    // Sequential POSTs keep the progress counter accurate and bound
    // Anthropic concurrency at the client tier (the server-side fan-out
    // already uses `p-limit(3)`; chaining here means we don't double up).
    for (const caller of callers) {
      try {
        const res = await fetch(`/api/callers/${caller.callerId}/compose-prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ triggerType: "manual" }),
        });
        if (!res.ok) failures += 1;
      } catch {
        failures += 1;
      }
      if (!mountedRef.current) return;
      setProgressDone((n) => n + 1);
    }

    if (!mountedRef.current) return;
    if (failures > 0) {
      setError(
        `${failures} of ${callers.length} caller${callers.length === 1 ? "" : "s"} failed to recompose. Check logs.`,
      );
    }
    // Refetch with cache bypass — the aggregate's 30s TTL would otherwise
    // serve the pre-fanout snapshot back.
    await fetchAggregate(true);
    if (mountedRef.current) setReprompting(false);
  }, [data, fetchAggregate]);

  if (!data?.ok || !data.staleCount || data.staleCount === 0) {
    return null;
  }

  const staleCount = data.staleCount;
  const totalDemoCallers = data.totalDemoCallers ?? 0;
  const callers = data.staleCallers ?? [];

  const headline = `${staleCount} of ${totalDemoCallers} demo caller${totalDemoCallers === 1 ? "" : "s"} have stale prompts`;

  return (
    <div
      className="hf-banner hf-banner-warning hf-flex-between hf-mb-md"
      role="status"
    >
      <div>
        <strong>⚠ {headline}</strong>
        {callers.length > 0 && (
          <ul className="hf-text-sm hf-mt-xs">
            {callers.slice(0, 5).map((c) => (
              <li key={c.callerId}>
                {c.name} — last composed {relativeTime(c.lastComposedAt)}
              </li>
            ))}
            {callers.length > 5 && (
              <li>+{callers.length - 5} more</li>
            )}
          </ul>
        )}
        {reprompting && (
          <div className="hf-text-sm hf-mt-xs">
            <span className="hf-spinner" aria-hidden="true" />
            {` Reprompting ${progressDone + 1} of ${progressTotal}…`}
          </div>
        )}
        {error && (
          <div className="hf-text-sm hf-text-error hf-mt-xs">{error}</div>
        )}
      </div>
      <button
        type="button"
        className="hf-btn hf-btn-secondary"
        onClick={onRepromptAll}
        disabled={reprompting}
      >
        {reprompting ? "Reprompting…" : "Reprompt all"}
      </button>
    </div>
  );
}
