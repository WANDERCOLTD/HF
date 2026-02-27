"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const STORAGE_KEY = "hf.stepflow.state";
const SYNC_DEBOUNCE_MS = 3000;

export interface StepDefinition {
  id: string;
  label: string;        // "Select Domain & Caller"
  activeLabel: string;  // "Selecting Domain & Caller" (for banner)
  skipWhen?: string;    // Optional skip condition expression (evaluated by evaluateSkipCondition)
}

export interface StepFlowState {
  flowId: string;
  active: boolean;
  currentStep: number;  // 0-indexed into steps array
  steps: StepDefinition[];
  data: Record<string, unknown>;
  returnPath: string;   // Where "Back to flow" navigates
  taskId?: string;      // Linked UserTask ID (if DB sync enabled)
  taskType?: string;    // Task type for resume detection
}

export interface StartFlowConfig {
  flowId: string;
  steps: StepDefinition[];
  returnPath: string;
  taskType?: string;    // If set, enables DB sync via UserTask
  taskId?: string;      // If set, resumes from existing UserTask
  initialData?: Record<string, unknown>;  // Pre-populate data (for resume)
  initialStep?: number; // Pre-set step (for resume)
}

interface StepFlowContextValue {
  state: StepFlowState | null;
  isActive: boolean;
  isOnFlowPage: boolean;  // true when pathname === returnPath
  taskId: string | undefined;  // Linked UserTask ID (convenience accessor)
  startFlow: (config: StartFlowConfig) => void;
  setStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  setData: (key: string, value: unknown) => void;
  getData: <T = unknown>(key: string) => T | undefined;
  endFlow: () => void;
}

const StepFlowContext = createContext<StepFlowContextValue | null>(null);

function readStorage(): StepFlowState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.flowId || !parsed.steps || !parsed.active) return null;
    return parsed as StepFlowState;
  } catch {
    return null;
  }
}

function writeStorage(state: StepFlowState | null): void {
  if (typeof window === "undefined") return;
  try {
    if (state) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

// ── DB Sync helpers (best-effort, never block UI) ──

async function syncToDb(state: StepFlowState): Promise<void> {
  if (!state.taskId) return;
  try {
    await fetch("/api/tasks", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: state.taskId,
        updates: {
          context: { ...state.data, _wizardStep: state.currentStep },
        },
      }),
    });
  } catch {
    // Silent — sessionStorage is the fast cache, DB sync is best-effort
  }
}

function beaconSync(state: StepFlowState): void {
  if (!state.taskId || typeof navigator === "undefined" || !navigator.sendBeacon) return;
  try {
    const payload = JSON.stringify({
      taskId: state.taskId,
      updates: { context: { ...state.data, _wizardStep: state.currentStep } },
    });
    navigator.sendBeacon("/api/tasks/sync", payload);
  } catch {
    // Silent
  }
}

async function completeTaskIfNeeded(taskId: string | undefined): Promise<void> {
  if (!taskId) return;
  try {
    await fetch(`/api/tasks?taskId=${taskId}`, { method: "DELETE" });
  } catch {
    // Silent
  }
}

export function StepFlowProvider({ children }: { children: React.ReactNode }) {
  const [flowState, setFlowState] = useState<StepFlowState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const pathname = usePathname();
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flowStateRef = useRef<StepFlowState | null>(null);

  // Keep ref in sync for beforeunload handler
  useEffect(() => {
    flowStateRef.current = flowState;
  }, [flowState]);

  // Initialize from sessionStorage on mount — deferred to avoid hydration mismatch
  useEffect(() => {
    setFlowState(readStorage());
    setHydrated(true);
  }, []);

  // Persist to sessionStorage on every state change
  useEffect(() => {
    if (hydrated) {
      writeStorage(flowState);
    }
  }, [flowState, hydrated]);

  // ── beforeunload: flush pending DB sync via sendBeacon ──
  useEffect(() => {
    const flush = () => {
      const current = flowStateRef.current;
      if (current?.taskId && syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
        beaconSync(current);
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      // Component unmount: flush pending sync
      flush();
    };
  }, []);

  // ── Debounced DB sync ──
  const scheduleDebouncedSync = useCallback((state: StepFlowState) => {
    if (!state.taskId) return;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null;
      syncToDb(state);
    }, SYNC_DEBOUNCE_MS);
  }, []);

  const scheduleImmediateSync = useCallback((state: StepFlowState) => {
    if (!state.taskId) return;
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    syncToDb(state);
  }, []);

  const startFlow = useCallback((config: StartFlowConfig) => {
    // Auto-discard stale flow from a different wizard (DB-backed useWizardResume
    // handles persistent resume — sessionStorage is just a tab-level cache)
    if (flowState?.active && flowState.flowId !== config.flowId) {
      if (flowState.taskId) {
        completeTaskIfNeeded(flowState.taskId);
      }
    }
    setFlowState({
      flowId: config.flowId,
      active: true,
      currentStep: config.initialStep ?? 0,
      steps: config.steps,
      data: config.initialData ?? {},
      returnPath: config.returnPath,
      taskId: config.taskId,
      taskType: config.taskType,
    });
  }, [flowState]);

  const setStep = useCallback((step: number) => {
    setFlowState((prev) => {
      if (!prev || !prev.active) return prev;
      const clamped = Math.max(0, Math.min(step, prev.steps.length - 1));
      const next = { ...prev, currentStep: clamped };
      // Immediate sync on step change (significant user action)
      scheduleImmediateSync(next);
      return next;
    });
  }, [scheduleImmediateSync]);

  const nextStep = useCallback(() => {
    setFlowState((prev) => {
      if (!prev || !prev.active) return prev;
      const next = { ...prev, currentStep: Math.min(prev.currentStep + 1, prev.steps.length - 1) };
      scheduleImmediateSync(next);
      return next;
    });
  }, [scheduleImmediateSync]);

  const prevStep = useCallback(() => {
    setFlowState((prev) => {
      if (!prev || !prev.active) return prev;
      const next = { ...prev, currentStep: Math.max(prev.currentStep - 1, 0) };
      scheduleImmediateSync(next);
      return next;
    });
  }, [scheduleImmediateSync]);

  const setData = useCallback((key: string, value: unknown) => {
    setFlowState((prev) => {
      if (!prev || !prev.active) return prev;
      const next = { ...prev, data: { ...prev.data, [key]: value } };
      // Debounced sync on data change (frequent during typing)
      scheduleDebouncedSync(next);
      return next;
    });
  }, [scheduleDebouncedSync]);

  const getData = useCallback(<T = unknown,>(key: string): T | undefined => {
    return flowState?.data[key] as T | undefined;
  }, [flowState]);

  const endFlow = useCallback(() => {
    // Complete the linked UserTask if present
    const taskId = flowState?.taskId;
    if (taskId) {
      // Cancel pending sync
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
      completeTaskIfNeeded(taskId);
    }
    setFlowState(null);
  }, [flowState]);

  // Gate on hydration to prevent SSR mismatch
  const active = hydrated ? flowState : null;
  const isOnFlowPage = active?.active === true && pathname === active?.returnPath;

  const value: StepFlowContextValue = {
    state: active,
    isActive: active?.active === true,
    isOnFlowPage,
    taskId: active?.taskId,
    startFlow,
    setStep,
    nextStep,
    prevStep,
    setData,
    getData,
    endFlow,
  };

  return (
    <StepFlowContext.Provider value={value}>
      {children}
    </StepFlowContext.Provider>
  );
}

export function useStepFlow(): StepFlowContextValue {
  const ctx = useContext(StepFlowContext);
  if (!ctx) {
    throw new Error("useStepFlow must be used within a StepFlowProvider");
  }
  return ctx;
}
