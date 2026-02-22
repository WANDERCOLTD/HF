"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUpDown } from "lucide-react";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import "./jobs.css";

// ── Types ──────────────────────────────────────────

interface UserTask {
  id: string;
  taskType: string;
  status: "in_progress" | "completed" | "abandoned";
  currentStep: number;
  totalSteps: number;
  completedSteps: string[];
  blockers: string[];
  context: any;
  startedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
  updatedAt: string;
}

// ── Job Type Labels ────────────────────────────────

const JOB_TYPE_LABELS: Record<string, { label: string; icon: string; resumePath: string; isBackground?: boolean }> = {
  quick_launch: {
    label: "Community",
    icon: "Users",
    resumePath: "/x/quick-launch",
  },
  create_spec: {
    label: "Create Spec",
    icon: "ClipboardList",
    resumePath: "/x/specs",
  },
  configure_caller: {
    label: "Configure Caller",
    icon: "User",
    resumePath: "/x/callers",
  },
  extraction: {
    label: "Content Extraction",
    icon: "FileSearch",
    resumePath: "/x/content-sources",
    isBackground: true,
  },
  curriculum_generation: {
    label: "Curriculum Generation",
    icon: "BookOpen",
    resumePath: "/x/subjects",
    isBackground: true,
  },
  content_wizard: {
    label: "Content Wizard",
    icon: "BookPlus",
    resumePath: "/x/subjects",
  },
  course_setup: {
    label: "Course Setup",
    icon: "GraduationCap",
    resumePath: "/x/courses",
  },
  classroom_setup: {
    label: "Classroom Setup",
    icon: "Building2",
    resumePath: "/x/educator/classrooms/new",
  },
};

// ── Step Maps (display-only, mirrors task-guidance.ts) ──

const JOB_STEP_MAPS: Record<string, Record<number, { title: string; description: string; estimated?: string }>> = {
  create_spec: {
    1: { title: "Basic Information", description: "Define the core identity: ID, title, domain, and classification", estimated: "2 min" },
    2: { title: "User Story", description: "Explain what this spec does and why it's needed", estimated: "3 min" },
    3: { title: "Parameters", description: "Define what this spec measures or tracks", estimated: "5 min" },
    4: { title: "Review & Create", description: "Review your spec and activate it", estimated: "1 min" },
  },
  configure_caller: {
    1: { title: "Caller Profile", description: "Set up basic caller information", estimated: "2 min" },
    2: { title: "Personality Settings", description: "Configure personality parameters and targets", estimated: "5 min" },
    3: { title: "Goals & Learning", description: "Set up caller goals and learning paths", estimated: "5 min" },
  },
  quick_launch: {
    1: { title: "Form", description: "Enter subject, style, goals, and upload course material", estimated: "2 min" },
    2: { title: "Analysis", description: "AI is extracting content and generating your tutor identity", estimated: "1-3 min" },
    3: { title: "Review", description: "Review and edit what AI created before finalizing", estimated: "2 min" },
    4: { title: "Create", description: "Building your tutor domain, curriculum, and test caller", estimated: "30 sec" },
  },
  extraction: {
    1: { title: "Extracting", description: "AI is reading your document and extracting teaching points", estimated: "1-3 min" },
    2: { title: "Saving", description: "Importing extracted assertions to database", estimated: "30 sec" },
  },
  curriculum_generation: {
    1: { title: "Loading", description: "Loading assertions from all sources", estimated: "10 sec" },
    2: { title: "Generating", description: "AI is structuring your curriculum into modules and learning outcomes", estimated: "1-3 min" },
    3: { title: "Complete", description: "Curriculum ready for review" },
  },
  content_wizard: {
    1: { title: "Add Source", description: "Create or upload a content source document", estimated: "2 min" },
    2: { title: "Extract", description: "AI extracts teaching points from your documents", estimated: "1-3 min" },
    3: { title: "Review", description: "Review and approve extracted teaching points", estimated: "2 min" },
    4: { title: "Plan Sessions", description: "Set session count and generate a session plan", estimated: "2 min" },
    5: { title: "Onboard", description: "Configure domain and first-call onboarding", estimated: "2 min" },
    6: { title: "Preview", description: "Preview the AI's first prompt", estimated: "1 min" },
    7: { title: "Done", description: "Review summary and check readiness", estimated: "1 min" },
  },
  course_setup: {
    1: { title: "Setting up course", description: "Creating institution and subject", estimated: "30 sec" },
    2: { title: "Building curriculum", description: "Generating lesson structure", estimated: "1-2 min" },
    3: { title: "Configuring AI tutor", description: "Scaffolding identity and playbook", estimated: "30 sec" },
    4: { title: "Configuring onboarding", description: "Welcome message and flow phases", estimated: "10 sec" },
    5: { title: "Inviting students", description: "Sending student invitations", estimated: "30 sec" },
  },
  classroom_setup: {
    1: { title: "Name & Focus", description: "Set classroom name, description, and institution", estimated: "1 min" },
    2: { title: "Courses", description: "Select courses to include in the classroom", estimated: "1 min" },
    3: { title: "Review", description: "Review and create the classroom", estimated: "30 sec" },
    4: { title: "Invite", description: "Invite students with a join link", estimated: "1 min" },
  },
};

function getNextStep(task: UserTask): { title: string; description: string; estimated?: string } | null {
  if (task.currentStep >= task.totalSteps) return null;
  const nextStepNum = task.currentStep + 1;
  return JOB_STEP_MAPS[task.taskType]?.[nextStepNum] ?? null;
}

function getJobLabel(task: UserTask): string {
  const base = JOB_TYPE_LABELS[task.taskType]?.label || task.taskType.replace(/_/g, " ");
  const ctx = task.context;
  if (task.taskType === "quick_launch" && ctx?.input?.subjectName) {
    return `${base} \u2014 ${ctx.input.subjectName}`;
  }
  if (task.taskType === "extraction" && ctx?.fileName) {
    return `${base} \u2014 ${ctx.fileName}`;
  }
  if (task.taskType === "curriculum_generation" && ctx?.subjectName) {
    return `${base} \u2014 ${ctx.subjectName}`;
  }
  if (task.taskType === "content_wizard" && ctx?.subjectName) {
    return `${base} \u2014 ${ctx.subjectName}`;
  }
  if (task.taskType === "course_setup") {
    const name = ctx?.courseName || ctx?.summary?.domain?.name;
    if (name) return `${base} \u2014 ${name}`;
  }
  if (task.taskType === "classroom_setup" && ctx?.name) {
    return `${base} \u2014 ${ctx.name}`;
  }
  return base;
}

function getResumePath(task: UserTask): string {
  const ctx = task.context;
  if (task.taskType === "curriculum_generation" && ctx?.subjectId) {
    return `/x/subjects/${ctx.subjectId}`;
  }
  if (task.taskType === "content_wizard" && ctx?.subjectId) {
    return `/x/subjects/${ctx.subjectId}`;
  }
  return JOB_TYPE_LABELS[task.taskType]?.resumePath || "/x";
}

function getResultPath(task: UserTask): string {
  const ctx = task.context;
  const summary = ctx?.summary;

  switch (task.taskType) {
    case "quick_launch":
      if (summary?.domain?.id) return `/x/domains?id=${summary.domain.id}`;
      if (ctx?.domainId) return `/x/domains?id=${ctx.domainId}`;
      break;
    case "extraction":
      if (summary?.sourceId) return `/x/content-sources/${summary.sourceId}`;
      if (ctx?.sourceId) return `/x/content-sources/${ctx.sourceId}`;
      break;
    case "curriculum_generation":
      if (summary?.subject?.id) return `/x/subjects/${summary.subject.id}`;
      if (ctx?.subjectId) return `/x/subjects/${ctx.subjectId}`;
      break;
    case "content_wizard":
      if (summary?.subject?.id) return `/x/subjects/${summary.subject.id}`;
      if (summary?.domain?.id) return `/x/domains?id=${summary.domain.id}`;
      if (ctx?.subjectId) return `/x/subjects/${ctx.subjectId}`;
      break;
    case "configure_caller":
      if (summary?.callerId) return `/x/callers/${summary.callerId}`;
      if (ctx?.callerId) return `/x/callers/${ctx.callerId}`;
      break;
    case "create_spec":
      if (summary?.specId) return `/x/specs/${summary.specId}`;
      if (ctx?.specId) return `/x/specs/${ctx.specId}`;
      break;
    case "course_setup":
      if (summary?.domain?.id) return `/x/domains?id=${summary.domain.id}`;
      break;
    case "classroom_setup":
      if (ctx?.created?.id) return `/x/educator/classrooms/${ctx.created.id}`;
      break;
  }

  return getResumePath(task);
}

function getJobClickPath(task: UserTask): string {
  if (task.status === "in_progress") {
    return isBackgroundJob(task) ? getResultPath(task) : getResumePath(task);
  }
  return isFailedJob(task) ? getResumePath(task) : getResultPath(task);
}

function isBackgroundJob(task: UserTask): boolean {
  // Explicitly background task types (extraction, curriculum_generation)
  if (JOB_TYPE_LABELS[task.taskType]?.isBackground === true) return true;
  // Wizard tasks in execution phase (currentStep >= 1 and has _wizardStep in context)
  // are background jobs — the wizard form is done and the server is working
  if (task.context?._wizardStep !== undefined && task.currentStep >= 1) return true;
  return false;
}

/** True if this is a wizard-phase task (user is filling out the form, not yet executing) */
function isWizardPhase(task: UserTask): boolean {
  return task.context?._wizardStep !== undefined && task.currentStep === 0;
}

function isFailedJob(task: UserTask): boolean {
  return task.context?.phase === "failed" || !!task.context?.error;
}

// ── Time Ago ───────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Summary Badges ─────────────────────────────────

function CountBadge({ label, count }: { label: string; count: number }) {
  return (
    <span className="rounded px-2 py-0.5 text-[11px] font-mono jobs-count-badge">
      {count} {label}
    </span>
  );
}

function EntityLink({ label, name, href }: { label: string; name: string; href: string }) {
  return (
    <Link
      href={href}
      className="rounded px-2 py-0.5 text-[11px] transition-colors hover:underline jobs-entity-link"
      onClick={(e) => e.stopPropagation()}
    >
      {label}: {name}
    </Link>
  );
}

function JobSummary({ task }: { task: UserTask }) {
  if (isFailedJob(task) && task.context?.error) {
    return (
      <div className="jobs-error-summary">
        {task.context.error}
      </div>
    );
  }

  const summary = task.context?.summary;
  if (!summary) return null;

  if (task.taskType === "quick_launch") {
    return (
      <div className="jobs-summary-badges">
        {summary.domain?.name && (
          <EntityLink label="Domain" name={summary.domain.name} href={`/x/domains?id=${summary.domain.id}`} />
        )}
        {summary.caller?.name && (
          <EntityLink label="Caller" name={summary.caller.name} href={`/x/callers/${summary.caller.id}`} />
        )}
        {summary.counts?.assertions > 0 && <CountBadge label="assertions" count={summary.counts.assertions} />}
        {summary.counts?.modules > 0 && <CountBadge label="modules" count={summary.counts.modules} />}
        {summary.counts?.goals > 0 && <CountBadge label="goals" count={summary.counts.goals} />}
      </div>
    );
  }

  if (task.taskType === "extraction") {
    return (
      <div className="jobs-summary-badges">
        {summary.counts?.extracted > 0 && <CountBadge label="extracted" count={summary.counts.extracted} />}
        {summary.counts?.imported > 0 && <CountBadge label="imported" count={summary.counts.imported} />}
        {summary.counts?.duplicates > 0 && (
          <span className="rounded px-2 py-0.5 text-[11px] font-mono jobs-count-badge-muted">
            {summary.counts.duplicates} duplicates
          </span>
        )}
      </div>
    );
  }

  if (task.taskType === "curriculum_generation") {
    return (
      <div className="jobs-summary-badges">
        {summary.subject?.name && (
          <EntityLink label="Subject" name={summary.subject.name} href={`/x/subjects/${summary.subject.id}`} />
        )}
        {summary.counts?.modules > 0 && <CountBadge label="modules" count={summary.counts.modules} />}
        {summary.counts?.assertions > 0 && <CountBadge label="assertions" count={summary.counts.assertions} />}
      </div>
    );
  }

  if (task.taskType === "content_wizard") {
    return (
      <div className="jobs-summary-badges">
        {summary.subject?.name && (
          <EntityLink label="Subject" name={summary.subject.name} href={`/x/subjects/${summary.subject.id}`} />
        )}
        {summary.domain?.name && (
          <EntityLink label="Domain" name={summary.domain.name} href={`/x/domains?id=${summary.domain.id}`} />
        )}
        {summary.counts?.assertions > 0 && <CountBadge label="assertions" count={summary.counts.assertions} />}
        {summary.counts?.sessions > 0 && <CountBadge label="sessions" count={summary.counts.sessions} />}
      </div>
    );
  }

  if (task.taskType === "course_setup") {
    return (
      <div className="jobs-summary-badges">
        {summary?.domain?.name && (
          <EntityLink label="Domain" name={summary.domain.name} href={`/x/domains?id=${summary.domain.id}`} />
        )}
        {summary?.playbook?.name && <CountBadge label={summary.playbook.name} count={1} />}
        {summary?.invitationCount > 0 && <CountBadge label="students" count={summary.invitationCount} />}
      </div>
    );
  }

  if (task.taskType === "classroom_setup") {
    const ctx = task.context;
    return (
      <div className="jobs-summary-badges">
        {ctx?.created?.id && (
          <EntityLink label="Classroom" name={ctx.name || "\u2014"} href={`/x/educator/classrooms/${ctx.created.id}`} />
        )}
      </div>
    );
  }

  return null;
}

// ── Main Page ──────────────────────────────────────

const COMPLETED_PAGE_SIZE = 20;
const ARCHIVED_PAGE_SIZE = 20;

type SortDir = "newest" | "oldest";

export default function JobsPage() {
  const router = useRouter();
  const [activeTasks, setActiveTasks] = useState<UserTask[]>([]);
  const [completedTasks, setCompletedTasks] = useState<UserTask[]>([]);
  const [completedTotal, setCompletedTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter + sort
  const [filterType, setFilterType] = useState<string>("all");
  const [sortDir, setSortDir] = useState<SortDir>("newest");

  // Archive state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [archiving, setArchiving] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [archivedTasks, setArchivedTasks] = useState<UserTask[]>([]);
  const [archivedTotal, setArchivedTotal] = useState(0);
  const [archivedHasMore, setArchivedHasMore] = useState(false);
  const [loadingArchive, setLoadingArchive] = useState(false);
  const [loadingMoreArchive, setLoadingMoreArchive] = useState(false);
  const [archivedSelectedIds, setArchivedSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadTasks = useCallback(async () => {
    try {
      const [activeRes, completedRes] = await Promise.all([
        fetch("/api/tasks?status=in_progress"),
        fetch(`/api/tasks?status=completed&limit=${COMPLETED_PAGE_SIZE}&offset=0`),
      ]);

      const activeData = await activeRes.json();
      const completedData = await completedRes.json();

      if (activeData.ok) setActiveTasks(activeData.tasks || []);
      if (completedData.ok) {
        setCompletedTasks(completedData.tasks || []);
        setCompletedTotal(completedData.total ?? completedData.count ?? 0);
        setHasMore(completedData.hasMore ?? false);
      }
    } catch {
      setError("Failed to load jobs. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
    const interval = setInterval(loadTasks, 10000);
    return () => clearInterval(interval);
  }, [loadTasks]);

  // ── Derived: available filter types ──

  const availableTypes = useMemo(() => {
    const types = new Set<string>();
    activeTasks.forEach((t) => types.add(t.taskType));
    completedTasks.forEach((t) => types.add(t.taskType));
    return Array.from(types).sort();
  }, [activeTasks, completedTasks]);

  // ── Derived: filtered + sorted lists ──

  const filterFn = useCallback((t: UserTask) => filterType === "all" || t.taskType === filterType, [filterType]);

  const sortFn = useCallback((a: UserTask, b: UserTask) => {
    const aTime = new Date(a.startedAt).getTime();
    const bTime = new Date(b.startedAt).getTime();
    return sortDir === "newest" ? bTime - aTime : aTime - bTime;
  }, [sortDir]);

  const filteredActive = useMemo(() => activeTasks.filter(filterFn).sort(sortFn), [activeTasks, filterFn, sortFn]);
  const filteredCompleted = useMemo(() => completedTasks.filter(filterFn).sort((a, b) => {
    const aTime = new Date(a.completedAt || a.updatedAt).getTime();
    const bTime = new Date(b.completedAt || b.updatedAt).getTime();
    return sortDir === "newest" ? bTime - aTime : aTime - bTime;
  }), [completedTasks, filterFn, sortDir]);

  const loadMoreCompleted = async () => {
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/tasks?status=completed&limit=${COMPLETED_PAGE_SIZE}&offset=${completedTasks.length}`
      );
      const data = await res.json();
      if (data.ok) {
        setCompletedTasks((prev) => [...prev, ...(data.tasks || [])]);
        setHasMore(data.hasMore ?? false);
      }
    } catch {
      // Ignore
    } finally {
      setLoadingMore(false);
    }
  };

  const handleAbandon = async (taskId: string) => {
    try {
      await fetch(`/api/tasks?taskId=${taskId}`, { method: "DELETE" });
      loadTasks();
    } catch {
      // Ignore
    }
  };

  // ── Selection (completed) ───────────────────────

  const toggleSelect = (taskId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const selectableCompleted = filteredCompleted.filter((t) => !isFailedJob(t));

  const toggleSelectAll = () => {
    if (selectedIds.size === selectableCompleted.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableCompleted.map((t) => t.id)));
    }
  };

  // ── Selection (archive) ─────────────────────────

  const toggleArchiveSelect = (taskId: string) => {
    setArchivedSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const toggleArchiveSelectAll = () => {
    if (archivedSelectedIds.size === archivedTasks.length) {
      setArchivedSelectedIds(new Set());
    } else {
      setArchivedSelectedIds(new Set(archivedTasks.map((t) => t.id)));
    }
  };

  // ── Archive ─────────────────────────────────────

  const handleArchive = async () => {
    if (selectedIds.size === 0) return;
    setArchiving(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskIds: Array.from(selectedIds), action: "archive" }),
      });
      const data = await res.json();
      if (data.ok) {
        setSelectedIds(new Set());
        await loadTasks();
        if (showArchive) loadArchivedTasks();
      }
    } catch {
      // Ignore
    } finally {
      setArchiving(false);
    }
  };

  const handleUnarchive = async (taskIds: string[]) => {
    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskIds, action: "unarchive" }),
      });
      const data = await res.json();
      if (data.ok) {
        setArchivedSelectedIds((prev) => {
          const next = new Set(prev);
          taskIds.forEach((id) => next.delete(id));
          return next;
        });
        await loadTasks();
        loadArchivedTasks();
      }
    } catch {
      // Ignore
    }
  };

  // ── Hard Delete ─────────────────────────────────

  const handleDelete = async () => {
    if (archivedSelectedIds.size === 0) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskIds: Array.from(archivedSelectedIds), action: "delete" }),
      });
      const data = await res.json();
      if (data.ok) {
        setArchivedSelectedIds(new Set());
        setConfirmDelete(false);
        loadArchivedTasks();
      }
    } catch {
      // Ignore
    } finally {
      setDeleting(false);
    }
  };

  const loadArchivedTasks = async () => {
    setLoadingArchive(true);
    try {
      const res = await fetch(`/api/tasks?status=archived&limit=${ARCHIVED_PAGE_SIZE}&offset=0`);
      const data = await res.json();
      if (data.ok) {
        setArchivedTasks(data.tasks || []);
        setArchivedTotal(data.total ?? data.count ?? 0);
        setArchivedHasMore(data.hasMore ?? false);
      }
    } catch {
      // Ignore
    } finally {
      setLoadingArchive(false);
    }
  };

  const loadMoreArchived = async () => {
    setLoadingMoreArchive(true);
    try {
      const res = await fetch(
        `/api/tasks?status=archived&limit=${ARCHIVED_PAGE_SIZE}&offset=${archivedTasks.length}`
      );
      const data = await res.json();
      if (data.ok) {
        setArchivedTasks((prev) => [...prev, ...(data.tasks || [])]);
        setArchivedHasMore(data.hasMore ?? false);
      }
    } catch {
      // Ignore
    } finally {
      setLoadingMoreArchive(false);
    }
  };

  const toggleArchive = () => {
    const next = !showArchive;
    setShowArchive(next);
    if (next && archivedTasks.length === 0) loadArchivedTasks();
  };

  return (
    <div className="jobs-page">
      {/* Header */}
      <h1 className="hf-page-title jobs-title">Jobs</h1>
      <p className="hf-page-subtitle jobs-subtitle">Track your in-progress and completed jobs.</p>

      {/* Filter chips + sort toggle */}
      {!loading && !error && (availableTypes.length > 0 || activeTasks.length > 0 || completedTasks.length > 0) && (
        <div className="jobs-toolbar">
          <div className="jobs-filter-chips">
            <button
              className={filterType === "all" ? "hf-chip hf-chip-selected" : "hf-chip"}
              onClick={() => setFilterType("all")}
            >
              All
            </button>
            {availableTypes.map((type) => {
              const active = filterType === type;
              return (
                <button
                  key={type}
                  className={active ? "hf-chip hf-chip-selected" : "hf-chip"}
                  onClick={() => setFilterType(active ? "all" : type)}
                >
                  {JOB_TYPE_LABELS[type]?.label || type.replace(/_/g, " ")}
                </button>
              );
            })}
          </div>
          <button
            className="hf-btn hf-btn-secondary jobs-sort-btn"
            onClick={() => setSortDir((d) => d === "newest" ? "oldest" : "newest")}
            title={`Sort: ${sortDir === "newest" ? "Newest first" : "Oldest first"}`}
          >
            <ArrowUpDown size={12} />
            {sortDir === "newest" ? "Newest" : "Oldest"}
          </button>
        </div>
      )}

      {loading && (
        <div className="jobs-loading"><div className="hf-spinner" /></div>
      )}

      {!loading && <ErrorBanner error={error} />}

      {/* In Progress */}
      {!loading && !error && (
        <section className="jobs-section">
          <h2 className="jobs-section-heading">
            In Progress ({filteredActive.length})
          </h2>

          {filteredActive.length === 0 ? (
            <div className="hf-empty jobs-empty">
              {filterType === "all"
                ? "No jobs in progress. Start one from Community or Teach."
                : `No ${JOB_TYPE_LABELS[filterType]?.label || filterType} jobs in progress.`}
            </div>
          ) : (
            <div className="jobs-card-list">
              {filteredActive.map((task) => {
                const nextStep = getNextStep(task);
                return (
                  <div
                    key={task.id}
                    className="jobs-active-card"
                    onClick={() => router.push(getJobClickPath(task))}
                  >
                    <div className="jobs-active-header">
                      <div>
                        <div className="jobs-active-title">
                          {getJobLabel(task)}
                        </div>
                        <div className="jobs-active-meta">
                          Started {timeAgo(task.startedAt)}
                          {isWizardPhase(task)
                            ? ` \u00b7 Setting up (step ${(task.context._wizardStep ?? 0) + 1})`
                            : isBackgroundJob(task)
                              ? ` \u00b7 ${task.taskType === "extraction"
                                  ? `${task.context?.extractedCount ?? 0} assertions extracted`
                                  : `Step ${task.currentStep} of ${task.totalSteps}`}`
                              : ` \u00b7 Step ${task.currentStep} of ${task.totalSteps}`}
                        </div>
                      </div>
                      <div className="jobs-active-actions">
                        {isBackgroundJob(task) ? (
                          <span className="jobs-badge-running">
                            Running...
                          </span>
                        ) : (
                          <span className="jobs-badge-resume">
                            Resume
                          </span>
                        )}
                        <button
                          className="jobs-btn-abandon"
                          onClick={(e) => { e.stopPropagation(); handleAbandon(task.id); }}
                        >
                          Abandon
                        </button>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="jobs-progress-track">
                      <div
                        className="jobs-progress-fill"
                        style={{ width: `${(task.currentStep / task.totalSteps) * 100}%` }}
                      />
                    </div>

                    {/* Next step */}
                    {nextStep && (
                      <div className="jobs-next-step">
                        <span className="jobs-next-step-accent">{"\u21b3"} Next:</span>{" "}
                        <span className="jobs-next-step-title">{nextStep.title}</span>
                        {" \u2014 "}
                        {nextStep.description}
                        {nextStep.estimated && (
                          <span className="jobs-next-step-estimated"> (~{nextStep.estimated})</span>
                        )}
                      </div>
                    )}

                    {/* Blockers */}
                    {task.blockers && task.blockers.length > 0 && (
                      <div className="jobs-blockers">
                        Blocked: {task.blockers.join(", ")}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Completed */}
      {!loading && (
        <section className="jobs-section">
          <div className="jobs-section-bar">
            <h2 className="jobs-section-heading jobs-section-heading-inline">
              Done ({filterType === "all" ? completedTotal : filteredCompleted.length})
            </h2>

            {/* Archive controls */}
            {filteredCompleted.length > 0 && (
              <div className="jobs-action-bar">
                {selectedIds.size > 0 && (
                  <button
                    className="hf-btn hf-btn-secondary jobs-btn-sm"
                    onClick={handleArchive}
                    disabled={archiving}
                  >
                    {archiving ? "Archiving..." : `Archive ${selectedIds.size}`}
                  </button>
                )}
                <button
                  className="hf-btn hf-btn-ghost jobs-btn-sm"
                  onClick={toggleSelectAll}
                >
                  {selectedIds.size === selectableCompleted.length && selectableCompleted.length > 0
                    ? "Deselect All"
                    : "Select All"}
                </button>
              </div>
            )}
          </div>

          {filteredCompleted.length === 0 ? (
            <div className="jobs-empty-text">
              {filterType === "all" ? "No completed jobs yet." : `No completed ${JOB_TYPE_LABELS[filterType]?.label || filterType} jobs.`}
            </div>
          ) : (
            <div className="jobs-card-list jobs-card-list-compact">
              {filteredCompleted.map((task) => {
                const failed = isFailedJob(task);
                const selectable = !failed;
                const selected = selectedIds.has(task.id);

                return (
                  <div
                    key={task.id}
                    className={`jobs-completed-card${selected ? " jobs-completed-card-selected" : ""}`}
                    onClick={() => router.push(getJobClickPath(task))}
                  >
                    <div className="jobs-completed-row">
                      <div className="jobs-completed-left">
                        {selectable ? (
                          <label
                            className="jobs-checkbox-label"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleSelect(task.id)}
                              className="jobs-checkbox"
                            />
                          </label>
                        ) : (
                          <div className="jobs-failed-icon">
                            &#10007;
                          </div>
                        )}
                        <div className="jobs-completed-label">
                          {getJobLabel(task)}
                        </div>
                      </div>
                      <div className="jobs-completed-right">
                        {failed && (
                          <span className="jobs-failed-tag">
                            Failed
                          </span>
                        )}
                        <span className="jobs-time-ago">
                          {task.completedAt ? timeAgo(task.completedAt) : timeAgo(task.updatedAt)}
                        </span>
                      </div>
                    </div>
                    <JobSummary task={task} />
                  </div>
                );
              })}

              {/* Load More */}
              {hasMore && filterType === "all" && (
                <button
                  className="hf-btn hf-btn-secondary jobs-load-more"
                  onClick={loadMoreCompleted}
                  disabled={loadingMore}
                >
                  {loadingMore ? "Loading..." : "Load More"}
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {/* Archive */}
      {!loading && (
        <section>
          <button
            className={`jobs-archive-toggle${showArchive ? " jobs-archive-toggle-open" : ""}`}
            onClick={toggleArchive}
          >
            <h2 className="jobs-section-heading jobs-section-heading-inline">
              Archive {archivedTotal > 0 && `(${archivedTotal})`}
            </h2>
            <span className={`jobs-archive-chevron${showArchive ? " jobs-archive-chevron-open" : ""}`}>
              &#9660;
            </span>
          </button>

          {showArchive && (
            <>
              {/* Archive controls */}
              {archivedTasks.length > 0 && (
                <div className="jobs-archive-controls">
                  {archivedSelectedIds.size > 0 && (
                    <>
                      <button
                        className="hf-btn hf-btn-secondary jobs-btn-sm"
                        onClick={() => handleUnarchive(Array.from(archivedSelectedIds))}
                      >
                        Restore {archivedSelectedIds.size}
                      </button>
                      <button
                        className="hf-btn hf-btn-destructive jobs-btn-sm"
                        onClick={() => setConfirmDelete(true)}
                      >
                        Delete {archivedSelectedIds.size}
                      </button>
                    </>
                  )}
                  <button
                    className="hf-btn hf-btn-ghost jobs-btn-sm"
                    onClick={toggleArchiveSelectAll}
                  >
                    {archivedSelectedIds.size === archivedTasks.length && archivedTasks.length > 0
                      ? "Deselect All"
                      : "Select All"}
                  </button>
                </div>
              )}

              {/* Delete confirm dialog */}
              {confirmDelete && (
                <div className="jobs-delete-confirm">
                  <span className="jobs-delete-confirm-text">
                    Permanently delete {archivedSelectedIds.size} job{archivedSelectedIds.size !== 1 ? "s" : ""}? This cannot be undone.
                  </span>
                  <div className="jobs-delete-confirm-actions">
                    <button
                      className="hf-btn hf-btn-secondary jobs-btn-confirm"
                      onClick={() => setConfirmDelete(false)}
                    >
                      Cancel
                    </button>
                    <button
                      className="hf-btn hf-btn-destructive jobs-btn-confirm"
                      onClick={handleDelete}
                      disabled={deleting}
                    >
                      {deleting ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              )}

              {loadingArchive ? (
                <div className="jobs-archive-loading"><div className="hf-spinner" /></div>
              ) : archivedTasks.length === 0 ? (
                <div className="jobs-empty-text">
                  No archived jobs.
                </div>
              ) : (
                <div className="jobs-card-list jobs-card-list-compact">
                  {archivedTasks.map((task) => {
                    const selected = archivedSelectedIds.has(task.id);
                    return (
                      <div
                        key={task.id}
                        className={`jobs-archived-card${selected ? " jobs-archived-card-selected" : ""}`}
                        onClick={() => router.push(getJobClickPath(task))}
                      >
                        <div className="jobs-completed-row">
                          <div className="jobs-completed-left">
                            <label
                              className="jobs-checkbox-label"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() => toggleArchiveSelect(task.id)}
                                className="jobs-checkbox"
                              />
                            </label>
                            <div className={`jobs-status-icon ${isFailedJob(task) ? "jobs-status-icon-error" : "jobs-status-icon-success"}`}>
                              {isFailedJob(task) ? "\u2717" : "\u2713"}
                            </div>
                            <div className="jobs-completed-label">
                              {getJobLabel(task)}
                            </div>
                          </div>
                          <div className="jobs-completed-right">
                            <button
                              className="hf-btn hf-btn-ghost jobs-btn-xs"
                              onClick={(e) => { e.stopPropagation(); handleUnarchive([task.id]); }}
                            >
                              Restore
                            </button>
                            <span className="jobs-time-ago">
                              {task.completedAt ? timeAgo(task.completedAt) : timeAgo(task.updatedAt)}
                            </span>
                          </div>
                        </div>
                        <JobSummary task={task} />
                      </div>
                    );
                  })}

                  {archivedHasMore && (
                    <button
                      className="hf-btn hf-btn-secondary jobs-load-more"
                      onClick={loadMoreArchived}
                      disabled={loadingMoreArchive}
                    >
                      {loadingMoreArchive ? "Loading..." : "Load More"}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
