"use client";

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { TASK_STATUS, isTerminal, POLL_INTERVAL_MS as DEFAULT_POLL_INTERVAL, POLL_TIMEOUT_MS } from "@/lib/tasks/constants";

// ── Types ──

type BackgroundTaskType = "extraction" | "curriculum_generation" | "curriculum_enrichment" | "course_setup" | "snapshot_take" | "snapshot_restore";

interface TaskProgress {
  status: string;            // "in_progress" | "completed" | "abandoned"
  currentStep: number;
  totalSteps: number;
  // Extraction fields (from context)
  currentChunk?: number;
  totalChunks?: number;
  extractedCount?: number;
  importedCount?: number;
  duplicatesSkipped?: number;
  // Curriculum fields (from context)
  phase?: string;
  assertionCount?: number;
  moduleCount?: number;
  // Course setup fields (from context)
  message?: string;
  // Snapshot fields (from context)
  snapshotName?: string;
  snapshotOperation?: "take" | "restore";
  currentTable?: string;
  totalTables?: number;
  progress?: number;         // 0-100
  totalRows?: number;
  // Common
  warnings?: string[];
  error?: string;
}

export interface QueuedTask {
  taskId: string;
  taskType: BackgroundTaskType;
  label: string;
  subjectId?: string;
  sourceId?: string;
  startedAt: number;
  progress: TaskProgress;
}

// ── Context ──

interface BackgroundTaskQueueContextValue {
  jobs: QueuedTask[];
  addExtractionJob: (taskId: string, sourceId: string, sourceName: string, fileName: string, subjectId?: string) => void;
  addCurriculumJob: (taskId: string, subjectId: string, subjectName: string) => void;
  addCurriculumEnrichmentJob: (taskId: string, subjectName: string) => void;
  addCourseSetupJob: (taskId: string, courseName: string) => void;
  addSnapshotJob: (taskId: string, snapshotName: string, operation: "take" | "restore") => void;
  /** @deprecated Use addExtractionJob */
  addJob: (taskId: string, sourceId: string, sourceName: string, fileName: string) => void;
  dismissJob: (taskId: string) => void;
  activeCount: number;
}

const BackgroundTaskQueueContext = createContext<BackgroundTaskQueueContextValue>({
  jobs: [],
  addExtractionJob: () => {},
  addCurriculumJob: () => {},
  addCourseSetupJob: () => {},
  addSnapshotJob: () => {},
  addJob: () => {},
  dismissJob: () => {},
  activeCount: 0,
});

/** @deprecated Use useBackgroundTaskQueue */
export function useContentJobQueue() {
  return useContext(BackgroundTaskQueueContext);
}

export function useBackgroundTaskQueue() {
  return useContext(BackgroundTaskQueueContext);
}

// ── localStorage ──

const STORAGE_KEY = "hf.background-tasks";
const OLD_STORAGE_KEY = "hf.extraction-jobs";
const POLL_INTERVAL_MS = DEFAULT_POLL_INTERVAL;
const MAX_STORED_JOBS = 50;

function loadJobs(): QueuedTask[] {
  try {
    // Migrate from old key if needed
    const oldRaw = localStorage.getItem(OLD_STORAGE_KEY);
    if (oldRaw) {
      localStorage.removeItem(OLD_STORAGE_KEY);
      const oldJobs = JSON.parse(oldRaw) as any[];
      // Convert old format to new
      const migrated: QueuedTask[] = oldJobs.map((j) => ({
        taskId: j.jobId || j.taskId,
        taskType: "extraction" as BackgroundTaskType,
        label: j.sourceName || j.fileName || "Extraction",
        sourceId: j.sourceId,
        startedAt: j.startedAt,
        progress: {
          status: j.progress?.status === "done" ? "completed"
            : j.progress?.status === "error" ? "abandoned"
            : "in_progress",
          currentStep: j.progress?.status === "importing" ? 2 : 1,
          totalSteps: 2,
          currentChunk: j.progress?.currentChunk,
          totalChunks: j.progress?.totalChunks,
          extractedCount: j.progress?.extractedCount,
          importedCount: j.progress?.importedCount,
          duplicatesSkipped: j.progress?.duplicatesSkipped,
          warnings: j.progress?.warnings,
          error: j.progress?.error,
        },
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }

    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedTask[];
    const cutoff = Date.now() - 60 * 60 * 1000;
    return parsed.filter((j) => j.startedAt > cutoff).slice(0, MAX_STORED_JOBS);
  } catch {
    return [];
  }
}

function saveJobs(jobs: QueuedTask[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs.slice(0, MAX_STORED_JOBS)));
  } catch {
    // localStorage full — silently fail
  }
}

// Map server UserTask to our TaskProgress
function serverTaskToProgress(task: any): TaskProgress {
  const ctx = task.context || {};
  return {
    status: task.status,
    currentStep: task.currentStep,
    totalSteps: task.totalSteps,
    currentChunk: ctx.currentChunk,
    totalChunks: ctx.totalChunks,
    extractedCount: ctx.extractedCount,
    importedCount: ctx.importedCount,
    duplicatesSkipped: ctx.duplicatesSkipped,
    phase: ctx.phase,
    message: ctx.message,
    assertionCount: ctx.assertionCount,
    moduleCount: ctx.moduleCount,
    snapshotName: ctx.snapshotName,
    snapshotOperation: ctx.snapshotOperation,
    currentTable: ctx.currentTable,
    totalTables: ctx.totalTables,
    progress: ctx.progress,
    totalRows: ctx.totalRows,
    warnings: ctx.warnings,
    error: ctx.error,
  };
}

// ── Provider ──

export function ContentJobQueueProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<QueuedTask[]>([]);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // Load from localStorage on mount
  useEffect(() => {
    setJobs(loadJobs());
  }, []);

  // Persist to localStorage on change
  useEffect(() => {
    if (jobs.length > 0 || localStorage.getItem(STORAGE_KEY)) {
      saveJobs(jobs);
    }
  }, [jobs]);

  // Poll active tasks from server
  useEffect(() => {
    async function pollTasks() {
      const current = jobsRef.current;
      const activeIds = current
        .filter((j) => j.progress.status === "in_progress")
        .map((j) => j.taskId);

      if (activeIds.length === 0) return;

      try {
        // Poll all in-progress tasks from the server
        const res = await fetch("/api/tasks?status=in_progress");
        if (!res.ok) return;
        const data = await res.json();
        if (!data.ok || !data.tasks) return;

        const serverTasks = data.tasks as any[];

        setJobs((prev) => {
          let changed = false;
          const next = prev.map((j) => {
            // Find matching server task
            const serverTask = serverTasks.find((st: any) => st.id === j.taskId);
            if (serverTask) {
              changed = true;
              return { ...j, progress: serverTaskToProgress(serverTask) };
            }
            // If task was active but not in server response, it may have completed
            if (j.progress.status === "in_progress") {
              // Mark as needing a direct check
              return j;
            }
            return j;
          });
          return changed ? next : prev;
        });

        // Client-side timeout: if a job has been active too long, mark it as timed out
        const now = Date.now();
        setJobs((prev) => {
          let changed = false;
          const next = prev.map((j) => {
            if (j.progress.status === TASK_STATUS.IN_PROGRESS && now - j.startedAt > POLL_TIMEOUT_MS) {
              changed = true;
              return {
                ...j,
                progress: { ...j.progress, status: TASK_STATUS.ABANDONED, error: "Timed out — task took too long" },
              };
            }
            return j;
          });
          return changed ? next : prev;
        });

        // Check for completed/abandoned tasks that were active
        for (const id of activeIds) {
          const serverTask = serverTasks.find((st: any) => st.id === id);
          if (!serverTask) {
            // Task not in in_progress list — check directly by taskId
            try {
              const taskRes = await fetch(`/api/tasks?taskId=${id}`);
              if (taskRes.ok) {
                const taskData = await taskRes.json();
                const directTask = taskData.guidance?.task || taskData.task;
                if (directTask && isTerminal(directTask.status)) {
                  setJobs((prev) =>
                    prev.map((j) =>
                      j.taskId === id
                        ? { ...j, progress: serverTaskToProgress(directTask) }
                        : j
                    )
                  );
                }
              }
            } catch {
              // Ignore — will retry next poll
            }
          }
        }

        // Check server for any auto-triggered tasks we don't know about yet
        const backgroundTypes: BackgroundTaskType[] = ["extraction", "curriculum_generation", "curriculum_enrichment", "course_setup", "snapshot_take", "snapshot_restore"];
        const knownIds = new Set(current.map((j) => j.taskId));
        for (const st of serverTasks) {
          if (backgroundTypes.includes(st.taskType) && !knownIds.has(st.id)) {
            const ctx = st.context || {};
            const newJob: QueuedTask = {
              taskId: st.id,
              taskType: st.taskType,
              label: st.taskType === "extraction"
                ? ctx.fileName || "Content Extraction"
                : st.taskType === "curriculum_generation"
                  ? ctx.subjectName || "Curriculum Generation"
                  : st.taskType === "curriculum_enrichment"
                    ? `${ctx.subjectName || "Curriculum"} (enriching)`
                    : st.taskType === "snapshot_take"
                      ? `Take: ${ctx.snapshotName || "Snapshot"}`
                      : st.taskType === "snapshot_restore"
                        ? `Restore: ${ctx.snapshotName || "Snapshot"}`
                        : ctx.courseName || "Course Setup",
              subjectId: ctx.subjectId,
              sourceId: ctx.sourceId,
              startedAt: new Date(st.startedAt).getTime(),
              progress: serverTaskToProgress(st),
            };
            setJobs((prev) => {
              if (prev.some((j) => j.taskId === st.id)) return prev;
              return [newJob, ...prev];
            });
          }
        }
      } catch {
        // Network error — skip this poll
      }
    }

    pollRef.current = setInterval(pollTasks, POLL_INTERVAL_MS);
    pollTasks();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const addExtractionJob = useCallback(
    (taskId: string, sourceId: string, sourceName: string, fileName: string, subjectId?: string) => {
      setJobs((prev) => {
        if (prev.some((j) => j.taskId === taskId)) return prev;
        return [
          {
            taskId,
            taskType: "extraction" as BackgroundTaskType,
            label: sourceName || fileName,
            sourceId,
            subjectId,
            startedAt: Date.now(),
            progress: {
              status: "in_progress",
              currentStep: 1,
              totalSteps: 2,
              currentChunk: 0,
              totalChunks: 0,
              extractedCount: 0,
              warnings: [],
            },
          },
          ...prev,
        ];
      });
    },
    []
  );

  const addCurriculumJob = useCallback(
    (taskId: string, subjectId: string, subjectName: string) => {
      setJobs((prev) => {
        if (prev.some((j) => j.taskId === taskId)) return prev;
        return [
          {
            taskId,
            taskType: "curriculum_generation" as BackgroundTaskType,
            label: subjectName,
            subjectId,
            startedAt: Date.now(),
            progress: {
              status: "in_progress",
              currentStep: 1,
              totalSteps: 3,
              warnings: [],
            },
          },
          ...prev,
        ];
      });
    },
    []
  );

  const addCurriculumEnrichmentJob = useCallback(
    (taskId: string, subjectName: string) => {
      setJobs((prev) => {
        if (prev.some((j) => j.taskId === taskId)) return prev;
        return [
          {
            taskId,
            taskType: "curriculum_enrichment" as BackgroundTaskType,
            label: `${subjectName} (enriching)`,
            startedAt: Date.now(),
            progress: {
              status: "in_progress",
              currentStep: 1,
              totalSteps: 3,
              warnings: [],
            },
          },
          ...prev,
        ];
      });
    },
    []
  );

  const addCourseSetupJob = useCallback(
    (taskId: string, courseName: string) => {
      setJobs((prev) => {
        if (prev.some((j) => j.taskId === taskId)) return prev;
        return [
          {
            taskId,
            taskType: "course_setup" as BackgroundTaskType,
            label: courseName,
            startedAt: Date.now(),
            progress: {
              status: "in_progress",
              currentStep: 1,
              totalSteps: 5,
              warnings: [],
            },
          },
          ...prev,
        ];
      });
    },
    []
  );

  const addSnapshotJob = useCallback(
    (taskId: string, snapshotName: string, operation: "take" | "restore") => {
      setJobs((prev) => {
        if (prev.some((j) => j.taskId === taskId)) return prev;
        const taskType = operation === "take" ? "snapshot_take" : "snapshot_restore";
        return [
          {
            taskId,
            taskType: taskType as BackgroundTaskType,
            label: `${operation === "take" ? "Take" : "Restore"}: ${snapshotName}`,
            startedAt: Date.now(),
            progress: {
              status: "in_progress",
              currentStep: 1,
              totalSteps: operation === "take" ? 2 : 4,
              snapshotName,
              snapshotOperation: operation,
              warnings: [],
            },
          },
          ...prev,
        ];
      });
    },
    []
  );

  // Backward-compat alias
  const addJob = useCallback(
    (taskId: string, sourceId: string, sourceName: string, fileName: string) => {
      addExtractionJob(taskId, sourceId, sourceName, fileName);
    },
    [addExtractionJob]
  );

  const dismissJob = useCallback((taskId: string) => {
    setJobs((prev) => prev.filter((j) => j.taskId !== taskId));
  }, []);

  const activeCount = jobs.filter((j) => j.progress.status === TASK_STATUS.IN_PROGRESS).length;

  return (
    <BackgroundTaskQueueContext.Provider
      value={{ jobs, addExtractionJob, addCurriculumJob, addCurriculumEnrichmentJob, addCourseSetupJob, addSnapshotJob, addJob, dismissJob, activeCount }}
    >
      {children}
    </BackgroundTaskQueueContext.Provider>
  );
}

// ── UI Component ──

export function ContentJobQueue() {
  const { jobs, dismissJob, activeCount } = useBackgroundTaskQueue();
  const [expanded, setExpanded] = useState(false);
  const router = useRouter();

  if (jobs.length === 0) return null;

  const elapsed = (startedAt: number) => {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
  };

  const isActive = (j: QueuedTask) => j.progress.status === TASK_STATUS.IN_PROGRESS;
  const isDone = (j: QueuedTask) => j.progress.status === TASK_STATUS.COMPLETED;
  const isError = (j: QueuedTask) => isTerminal(j.progress.status) && j.progress.status !== TASK_STATUS.COMPLETED;

  const statusColor = (j: QueuedTask) => {
    if (isDone(j)) return "var(--status-success-text)";
    if (isError(j)) return "var(--status-error-text)";
    return "var(--accent-primary)";
  };

  const statusLabel = (j: QueuedTask) => {
    const p = j.progress;
    if (j.taskType === "extraction") {
      if (isError(j)) return p.error || "Failed";
      if (isDone(j)) return `${p.importedCount ?? p.extractedCount ?? 0} imported`;
      if (p.currentStep >= 2) return "Saving...";
      return `Extracting${p.extractedCount ? ` (${p.extractedCount})` : ""}`;
    }
    if (j.taskType === "curriculum_generation") {
      if (isError(j)) return p.error || "Failed";
      if (isDone(j)) return `${p.moduleCount ?? 0} modules`;
      if (p.currentStep >= 2) return "Generating...";
      return "Loading assertions...";
    }
    if (j.taskType === "curriculum_enrichment") {
      if (isError(j)) return p.error || "Failed";
      if (isDone(j)) return `${p.moduleCount ?? 0} modules enriched`;
      if (p.currentStep >= 2) return "Updating spec...";
      return "Generating detail...";
    }
    if (j.taskType === "course_setup") {
      if (isError(j)) return p.error || "Failed";
      if (isDone(j)) return "Course ready";
      return p.message || `Step ${p.currentStep}/${p.totalSteps}`;
    }
    if (j.taskType === "snapshot_take") {
      if (isError(j)) return p.error || "Failed";
      if (isDone(j)) return `${p.totalRows?.toLocaleString() ?? 0} rows saved`;
      return p.currentTable ? `Exporting ${p.currentTable}` : "Starting...";
    }
    if (j.taskType === "snapshot_restore") {
      if (isError(j)) return p.error || "Failed";
      if (isDone(j)) return "Restored";
      if (p.phase === "clearing") return `Clearing ${p.currentTable || ""}`;
      if (p.phase === "inserting") return `Inserting ${p.currentTable || ""}`;
      return "Validating...";
    }
    return isActive(j) ? "Running..." : isDone(j) ? "Done" : "Failed";
  };

  const pct = (j: QueuedTask) => {
    if (j.taskType === "extraction") {
      const chunks = j.progress.totalChunks || 0;
      if (chunks > 0) return Math.round(((j.progress.currentChunk || 0) / chunks) * 100);
      return 0;
    }
    // Snapshot: use context progress field
    if (j.taskType === "snapshot_take" || j.taskType === "snapshot_restore") {
      return j.progress.progress ?? Math.round((j.progress.currentStep / j.progress.totalSteps) * 100);
    }
    // Curriculum + course setup: step-based
    return Math.round((j.progress.currentStep / j.progress.totalSteps) * 100);
  };

  const badgeText = () => {
    if (activeCount === 0) return `${jobs.length} job${jobs.length > 1 ? "s" : ""}`;
    const extractionCount = jobs.filter((j) => j.taskType === "extraction" && isActive(j)).length;
    const curriculumCount = jobs.filter((j) => j.taskType === "curriculum_generation" && isActive(j)).length;
    if (extractionCount > 0 && curriculumCount === 0) {
      return `${extractionCount} extraction${extractionCount > 1 ? "s" : ""} running`;
    }
    if (curriculumCount > 0 && extractionCount === 0) {
      return "Generating curriculum...";
    }
    return `${activeCount} job${activeCount > 1 ? "s" : ""} running`;
  };

  const handleClick = (j: QueuedTask) => {
    if (!isDone(j)) return;
    if (j.taskType === "extraction") {
      router.push("/x/content-sources");
    } else if (j.taskType === "curriculum_generation" && j.subjectId) {
      router.push(`/x/subjects?id=${j.subjectId}`);
    } else if (j.taskType === "course_setup") {
      router.push("/x/courses");
    } else if (j.taskType === "snapshot_take" || j.taskType === "snapshot_restore") {
      router.push("/x/snapshots");
    }
    setExpanded(false);
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 20,
        right: 20,
        zIndex: 9999,
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
      }}
    >
      {/* Collapsed badge */}
      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 16px",
            borderRadius: 12,
            border: "1px solid var(--border-default)",
            background: "var(--surface-primary)",
            boxShadow: "0 4px 24px color-mix(in srgb, var(--text-primary) 12%, transparent)",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-primary)",
          }}
        >
          {activeCount > 0 && (
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "var(--accent-primary)",
                animation: "cjq-pulse 1.5s ease-in-out infinite",
              }}
            />
          )}
          <span>{badgeText()}</span>
          <style>{`@keyframes cjq-pulse { 0%,100% { opacity:1 } 50% { opacity:0.3 } }`}</style>
        </button>
      )}

      {/* Expanded panel */}
      {expanded && (
        <div
          style={{
            width: 360,
            maxHeight: 400,
            borderRadius: 12,
            border: "1px solid var(--border-default)",
            background: "var(--surface-primary)",
            boxShadow: "0 8px 32px color-mix(in srgb, var(--text-primary) 16%, transparent)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 16px",
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
              Background Jobs
            </span>
            <button
              onClick={() => setExpanded(false)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 18,
                color: "var(--text-muted)",
                lineHeight: 1,
                padding: "2px 4px",
              }}
              aria-label="Minimize"
            >
              &minus;
            </button>
          </div>

          {/* Job list */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {jobs.map((job) => (
              <div
                key={job.taskId}
                style={{
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--border-subtle)",
                  cursor: isDone(job) ? "pointer" : "default",
                }}
                onClick={() => handleClick(job)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--text-primary)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {job.label}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {job.taskType === "extraction" ? "Content Extraction"
                        : job.taskType === "curriculum_generation" ? "Curriculum Generation"
                        : job.taskType === "curriculum_enrichment" ? "Curriculum Enrichment"
                        : job.taskType === "snapshot_take" ? "Snapshot Take"
                        : job.taskType === "snapshot_restore" ? "Snapshot Restore"
                        : "Course Setup"}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: statusColor(job), fontWeight: 600 }}>
                      {statusLabel(job)}
                    </span>
                    {(isDone(job) || isError(job)) && (
                      <button
                        onClick={(e) => { e.stopPropagation(); dismissJob(job.taskId); }}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          fontSize: 14,
                          color: "var(--text-muted)",
                          padding: "0 2px",
                          lineHeight: 1,
                        }}
                        aria-label="Dismiss"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress bar for active jobs */}
                {isActive(job) && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ height: 3, borderRadius: 2, background: "var(--surface-tertiary)", overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          borderRadius: 2,
                          background: "var(--accent-primary)",
                          width: job.taskType === "curriculum_generation" && job.progress.currentStep < 3
                            ? "100%"
                            : `${pct(job)}%`,
                          transition: "width 0.5s ease-out",
                          minWidth: pct(job) === 0 ? "30%" : undefined,
                          animation:
                            (job.taskType === "extraction" && (job.progress.totalChunks || 0) === 0) ||
                            (job.taskType === "curriculum_generation" && job.progress.currentStep === 2)
                              ? "cjq-indeterminate 1.5s ease-in-out infinite"
                              : undefined,
                        }}
                      />
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 10,
                        color: "var(--text-muted)",
                        marginTop: 2,
                      }}
                    >
                      <span>
                        {job.taskType === "extraction"
                          ? (job.progress.totalChunks || 0) > 0
                            ? `chunk ${job.progress.currentChunk || 0}/${job.progress.totalChunks}`
                            : "starting..."
                          : `step ${job.progress.currentStep}/${job.progress.totalSteps}`}
                      </span>
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>{elapsed(job.startedAt)}</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <style>{`@keyframes cjq-indeterminate { 0% { margin-left:0 } 50% { margin-left:70% } 100% { margin-left:0 } }`}</style>
        </div>
      )}
    </div>
  );
}
