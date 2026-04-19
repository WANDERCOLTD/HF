'use client';

/**
 * JobsPopup — small flyout anchored to the status bar Jobs chip.
 *
 * Shows:
 *   - Active jobs with progress bars + click-to-resume
 *   - Recent completed jobs (last 24h)
 *   - "View All" link to /x/jobs
 *
 * Polls /api/tasks every 10s while open.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Cog, ExternalLink, X, CheckCircle2, AlertCircle } from 'lucide-react';

// ── Types (mirrors jobs page) ──────────────────────

interface UserTask {
  id: string;
  taskType: string;
  status: 'in_progress' | 'completed' | 'abandoned';
  currentStep: number;
  totalSteps: number;
  context: any;
  startedAt: string;
  completedAt: string | null;
  updatedAt: string;
}

const JOB_TYPE_LABELS: Record<string, { label: string; resumePath: string; isBackground?: boolean }> = {
  quick_launch: { label: 'Community', resumePath: '/x/quick-launch' },
  create_spec: { label: 'Create Spec', resumePath: '/x/specs' },
  configure_caller: { label: 'Configure Caller', resumePath: '/x/callers' },
  extraction: { label: 'Content Extraction', resumePath: '/x/content-sources', isBackground: true },
  curriculum_generation: { label: 'Curriculum Generation', resumePath: '/x/subjects', isBackground: true },
  content_wizard: { label: 'Content Wizard', resumePath: '/x/subjects' },
  course_setup: { label: 'Course Setup', resumePath: '/x/courses' },
  classroom_setup: { label: 'Classroom Setup', resumePath: '/x/educator/classrooms/new' },
};

function getJobLabel(task: UserTask): string {
  const base = JOB_TYPE_LABELS[task.taskType]?.label || task.taskType.replace(/_/g, ' ');
  const ctx = task.context;
  if (task.taskType === 'quick_launch' && ctx?.input?.subjectName) return `${base} — ${ctx.input.subjectName}`;
  if (task.taskType === 'extraction' && ctx?.fileName) return `${base} — ${ctx.fileName}`;
  if (task.taskType === 'curriculum_generation' && ctx?.subjectName) return `${base} — ${ctx.subjectName}`;
  if (task.taskType === 'content_wizard' && ctx?.subjectName) return `${base} — ${ctx.subjectName}`;
  if (task.taskType === 'course_setup') {
    const name = ctx?.courseName || ctx?.summary?.domain?.name;
    if (name) return `${base} — ${name}`;
  }
  if (task.taskType === 'classroom_setup' && ctx?.name) return `${base} — ${ctx.name}`;
  return base;
}

function isBackgroundJob(task: UserTask): boolean {
  if (JOB_TYPE_LABELS[task.taskType]?.isBackground === true) return true;
  if (task.context?._wizardStep !== undefined && task.currentStep >= 1) return true;
  return false;
}

function isFailedJob(task: UserTask): boolean {
  return task.context?.phase === 'failed' || !!task.context?.error;
}

function getResultPath(task: UserTask): string {
  const ctx = task.context;
  const summary = ctx?.summary;
  switch (task.taskType) {
    case 'quick_launch':
      if (summary?.domain?.id) return `/x/domains?id=${summary.domain.id}`;
      if (ctx?.domainId) return `/x/domains?id=${ctx.domainId}`;
      break;
    case 'extraction':
      if (ctx?.courseId && ctx?.subjectId) return `/x/courses/${ctx.courseId}/subjects/${ctx.subjectId}`;
      if (summary?.sourceId) return `/x/content-sources/${summary.sourceId}`;
      if (ctx?.sourceId) return `/x/content-sources/${ctx.sourceId}`;
      break;
    case 'curriculum_generation':
      if (ctx?.courseId && ctx?.subjectId) return `/x/courses/${ctx.courseId}/subjects/${ctx.subjectId}`;
      if (summary?.subject?.id) return `/x/subjects?id=${summary.subject.id}`;
      if (ctx?.subjectId) return `/x/subjects?id=${ctx.subjectId}`;
      break;
    case 'content_wizard':
      if (ctx?.courseId && ctx?.subjectId) return `/x/courses/${ctx.courseId}/subjects/${ctx.subjectId}`;
      if (summary?.subject?.id) return `/x/subjects?id=${summary.subject.id}`;
      if (summary?.domain?.id) return `/x/domains?id=${summary.domain.id}`;
      if (ctx?.subjectId) return `/x/subjects?id=${ctx.subjectId}`;
      break;
    case 'configure_caller':
      if (summary?.callerId) return `/x/callers/${summary.callerId}`;
      if (ctx?.callerId) return `/x/callers/${ctx.callerId}`;
      break;
    case 'create_spec':
      if (summary?.specId) return `/x/specs/${summary.specId}`;
      if (ctx?.specId) return `/x/specs/${ctx.specId}`;
      break;
    case 'course_setup':
      if (summary?.playbook?.id) return `/x/courses/${summary.playbook.id}`;
      if (summary?.domain?.institutionId) return `/x/institutions/${summary.domain.institutionId}`;
      break;
    case 'classroom_setup':
      if (ctx?.created?.id) return `/x/educator/classrooms/${ctx.created.id}`;
      break;
  }
  return JOB_TYPE_LABELS[task.taskType]?.resumePath || '/x';
}

function getResumePath(task: UserTask): string {
  const ctx = task.context;
  if (task.taskType === 'curriculum_generation' && ctx?.courseId && ctx?.subjectId) return `/x/courses/${ctx.courseId}/subjects/${ctx.subjectId}`;
  if (task.taskType === 'curriculum_generation' && ctx?.subjectId) return `/x/subjects?id=${ctx.subjectId}`;
  if (task.taskType === 'content_wizard' && ctx?.courseId && ctx?.subjectId) return `/x/courses/${ctx.courseId}/subjects/${ctx.subjectId}`;
  if (task.taskType === 'content_wizard' && ctx?.subjectId) return `/x/subjects?id=${ctx.subjectId}`;
  return JOB_TYPE_LABELS[task.taskType]?.resumePath || '/x';
}

function getClickPath(task: UserTask): string {
  if (task.status === 'in_progress') {
    return isBackgroundJob(task) ? getResultPath(task) : getResumePath(task);
  }
  return isFailedJob(task) ? getResumePath(task) : getResultPath(task);
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Component ──────────────────────────────────────

interface JobsPopupProps {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

export function JobsPopup({ open, onClose, anchorRef }: JobsPopupProps) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const [activeTasks, setActiveTasks] = useState<UserTask[]>([]);
  const [recentTasks, setRecentTasks] = useState<UserTask[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTasks = useCallback(async () => {
    try {
      const [activeRes, recentRes] = await Promise.all([
        fetch('/api/tasks?status=in_progress'),
        fetch('/api/tasks?status=completed&limit=5&offset=0'),
      ]);
      const activeData = await activeRes.json();
      const recentData = await recentRes.json();
      if (activeData.ok) setActiveTasks(activeData.tasks || []);
      if (recentData.ok) setRecentTasks(recentData.tasks || []);
    } catch {
      // Silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    loadTasks();
    const interval = setInterval(loadTasks, 10000);
    return () => clearInterval(interval);
  }, [open, loadTasks]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        panelRef.current && !panelRef.current.contains(target) &&
        anchorRef.current && !anchorRef.current.contains(target)
      ) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose, anchorRef]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const handleJobClick = (task: UserTask) => {
    onClose();
    router.push(getClickPath(task));
  };

  const handleDismiss = async (e: React.MouseEvent, taskId: string) => {
    e.stopPropagation();
    try {
      await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskIds: [taskId], action: 'abandon' }),
      });
      setActiveTasks((prev) => prev.filter((t) => t.id !== taskId));
    } catch {
      // Silent
    }
  };

  const isEmpty = activeTasks.length === 0 && recentTasks.length === 0;

  return (
    <div className="jobs-popup" ref={panelRef}>
      {/* Header */}
      <div className="jobs-popup-header">
        <span className="jobs-popup-title">Jobs</span>
        <button className="jobs-popup-close" onClick={onClose} title="Close">
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="jobs-popup-body">
        {loading ? (
          <div className="jobs-popup-loading"><div className="hf-spinner" /></div>
        ) : isEmpty ? (
          <div className="jobs-popup-empty">No active or recent jobs</div>
        ) : (
          <>
            {/* Active jobs */}
            {activeTasks.length > 0 && (
              <div className="jobs-popup-section">
                <div className="jobs-popup-section-label">Active ({activeTasks.length})</div>
                {activeTasks.map((task) => (
                  <div
                    key={task.id}
                    className="jobs-popup-row"
                    onClick={() => handleJobClick(task)}
                  >
                    <div className="jobs-popup-row-icon">
                      <Cog size={13} className="hf-status-jobs-spin" />
                    </div>
                    <div className="jobs-popup-row-content">
                      <div className="jobs-popup-row-name">{getJobLabel(task)}</div>
                      <div className="jobs-popup-row-meta">
                        {isBackgroundJob(task) ? 'Running' : `Step ${task.currentStep}/${task.totalSteps}`}
                        {' \u00b7 '}
                        {timeAgo(task.startedAt)}
                      </div>
                      {/* Mini progress bar */}
                      <div className="jobs-popup-progress-track">
                        <div
                          className="jobs-popup-progress-fill"
                          style={{ width: `${Math.max((task.currentStep / task.totalSteps) * 100, 5)}%` }}
                        />
                      </div>
                    </div>
                    <button
                      className="jobs-popup-dismiss"
                      onClick={(e) => handleDismiss(e, task.id)}
                      title="Dismiss stale job"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Recent completed */}
            {recentTasks.length > 0 && (
              <div className="jobs-popup-section">
                <div className="jobs-popup-section-label">Recent</div>
                {recentTasks.map((task) => {
                  const failed = isFailedJob(task);
                  return (
                    <div
                      key={task.id}
                      className="jobs-popup-row"
                      onClick={() => handleJobClick(task)}
                    >
                      <div className="jobs-popup-row-icon">
                        {failed ? (
                          <AlertCircle size={13} className="jobs-popup-icon-error" />
                        ) : (
                          <CheckCircle2 size={13} className="jobs-popup-icon-success" />
                        )}
                      </div>
                      <div className="jobs-popup-row-content">
                        <div className="jobs-popup-row-name">{getJobLabel(task)}</div>
                        <div className="jobs-popup-row-meta">
                          {failed ? 'Failed' : 'Done'}
                          {' \u00b7 '}
                          {task.completedAt ? timeAgo(task.completedAt) : timeAgo(task.updatedAt)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="jobs-popup-footer">
        <button
          className="jobs-popup-viewall"
          onClick={() => { onClose(); router.push('/x/jobs'); }}
        >
          View All Jobs <ExternalLink size={11} />
        </button>
      </div>
    </div>
  );
}
