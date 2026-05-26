"use client";

import { useState, useCallback } from "react";
import { useTaskPoll, type PollableTask } from "@/hooks/useTaskPoll";
import { useStableCallback } from "@/hooks/useStableCallback";

// ── useAsyncStep ──────────────────────────────────────
//
// Wraps useTaskPoll with a standard phase machine for wizard steps
// that kick off server-side work. Handles:
//
// - Phase transitions: idle → submitting → polling → [skeleton →] done | error
// - TaskId persistence in data bag (survives page refresh)
// - Skeleton-first rendering (optional)
// - Retry after error
// - Cancel/cleanup
//
// This is the composition layer. useTaskPoll remains the low-level primitive.

export type AsyncStepPhase =
  | "idle"
  | "submitting"
  | "polling"
  | "skeleton"
  | "done"
  | "error";

export interface UseAsyncStepOptions<TResult = unknown> {
  /** Key in data bag to persist taskId (survives refresh) */
  taskIdKey: string;
  /** Start the async work — must return a taskId */
  start: () => Promise<string>;
  /** Extract result from completed task */
  onComplete: (task: PollableTask) => TResult;
  /** Optional: react to progress updates */
  onProgress?: (task: PollableTask) => void;
  /** Optional: detect skeleton data before full completion. Return true if skeleton was consumed. */
  onSkeleton?: (task: PollableTask) => boolean;
  /** getData from StepRenderProps */
  getData: <T = unknown>(key: string) => T | undefined;
  /** setData from StepRenderProps */
  setData: (key: string, value: unknown) => void;
  /** Override poll timeout (default 3min) */
  timeoutMs?: number;
  /** Optional: report caught errors to ErrorCaptureContext (status bar + bug reporter) */
  reportError?: (err: Error | string, context?: { source?: string; step?: string }) => void;
}

export interface UseAsyncStepReturn<TResult = unknown> {
  /** Current phase */
  phase: AsyncStepPhase;
  /** Result from onComplete (null until done) */
  result: TResult | null;
  /** Error message (null unless error phase) */
  error: string | null;
  /** Latest progress task (for reading context.message etc.) */
  progress: PollableTask | null;
  /** Kick off the async work */
  execute: () => Promise<void>;
  /** Retry after error — resets then executes */
  retry: () => Promise<void>;
  /** Cancel polling and reset to idle */
  cancel: () => void;
  /** True during submitting, polling, or skeleton phases */
  isWorking: boolean;
}

export function useAsyncStep<TResult = unknown>({
  taskIdKey,
  start,
  onComplete,
  onProgress,
  onSkeleton,
  getData,
  setData,
  timeoutMs,
  reportError,
}: UseAsyncStepOptions<TResult>): UseAsyncStepReturn<TResult> {
  // Restore taskId from data bag (refresh survival)
  const restoredTaskId = getData<string>(taskIdKey) || null;

  const [phase, setPhase] = useState<AsyncStepPhase>(
    restoredTaskId ? "polling" : "idle",
  );
  const [taskId, setTaskId] = useState<string | null>(restoredTaskId);
  const [result, setResult] = useState<TResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<PollableTask | null>(null);

  // Stable wrappers around prop callbacks — avoid stale closures inside
  // useTaskPoll without forcing re-registration on every prop change.
  // See hooks/useStableCallback.ts (useEvent RFC).
  const stableOnComplete = useStableCallback(onComplete);
  const stableOnProgress = useStableCallback(
    onProgress ?? (() => undefined),
  );
  const stableOnSkeleton = useStableCallback(
    onSkeleton ?? (() => false),
  );
  const stableReportError = useStableCallback(
    reportError ?? (() => undefined),
  );
  const hasOnProgress = onProgress !== undefined;
  const hasOnSkeleton = onSkeleton !== undefined;

  // Latest-phase reader — stable identity, always returns current phase.
  // Replaces the manual `phaseRef.current = phase` write-during-render.
  const getPhase = useStableCallback(() => phase);

  // Wire useTaskPoll — only active when taskId is non-null
  useTaskPoll({
    taskId,
    timeoutMs,
    onProgress: useCallback(
      (task: PollableTask) => {
        setProgress(task);
        setError(null);
        if (hasOnProgress) stableOnProgress(task);

        // Skeleton detection
        if (hasOnSkeleton) {
          const currentPhase = getPhase();
          if (currentPhase === "polling" || currentPhase === "submitting") {
            const consumed = stableOnSkeleton(task);
            if (consumed) {
              setPhase("skeleton");
            }
          }
        }
      },
      [hasOnProgress, hasOnSkeleton, stableOnProgress, stableOnSkeleton, getPhase],
    ),
    onComplete: useCallback(
      (task: PollableTask) => {
        try {
          const r = stableOnComplete(task);
          setResult(r as TResult);
          setPhase("done");
        } catch (err: unknown) {
          const msg =
            err instanceof Error ? err.message : "Failed to process result";
          setError(msg);
          setPhase("error");
          stableReportError(err instanceof Error ? err : msg, {
            source: "useAsyncStep:complete",
            step: taskIdKey,
          });
        }
        setTaskId(null);
        setData(taskIdKey, null);
      },
      [setData, taskIdKey, stableOnComplete, stableReportError],
    ),
    onError: useCallback(
      (msg: string) => {
        // If we have skeleton data, keep showing it — degrade gracefully
        if (getPhase() === "skeleton") {
          setPhase("done");
          setTaskId(null);
          setData(taskIdKey, null);
          return;
        }
        setError(msg);
        setPhase("error");
        setTaskId(null);
        setData(taskIdKey, null);
        stableReportError(msg, { source: "useAsyncStep", step: taskIdKey });
      },
      [setData, taskIdKey, getPhase, stableReportError],
    ),
  });

  const execute = useCallback(async () => {
    setPhase("submitting");
    setError(null);
    setResult(null);
    setProgress(null);
    try {
      const id = await start();
      setTaskId(id);
      setData(taskIdKey, id); // Persist for refresh survival
      setPhase("polling");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to start";
      setError(msg);
      setPhase("error");
      stableReportError(err instanceof Error ? err : msg, {
        source: "useAsyncStep:start",
        step: taskIdKey,
      });
    }
  }, [start, setData, taskIdKey, stableReportError]);

  const cancel = useCallback(() => {
    setTaskId(null);
    setData(taskIdKey, null);
    setPhase("idle");
    setError(null);
    setResult(null);
    setProgress(null);
  }, [setData, taskIdKey]);

  const retry = useCallback(async () => {
    cancel();
    // Allow state to settle before re-executing
    await new Promise((r) => setTimeout(r, 0));
    await execute();
  }, [cancel, execute]);

  return {
    phase,
    result,
    error,
    progress,
    execute,
    retry,
    cancel,
    isWorking:
      phase === "submitting" || phase === "polling" || phase === "skeleton",
  };
}
