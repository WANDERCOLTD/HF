"use client";

import { useState, useCallback } from "react";
import { useTaskPoll } from "@/hooks/useTaskPoll";
import type { BulkDeletePreview, BulkDeleteResult, EntityType } from "@/lib/admin/bulk-delete";

interface BulkDeleteModalProps {
  preview: BulkDeletePreview;
  onConfirm: (result: BulkDeleteResult) => void;
  onCancel: () => void;
  onJobStarted?: (taskId: string) => void;
}

const ENTITY_LABELS: Record<EntityType, { singular: string; plural: string; action: string }> = {
  caller: { singular: "caller", plural: "callers", action: "Delete" },
  playbook: { singular: "course", plural: "courses", action: "Delete" },
  domain: { singular: "institution", plural: "institutions", action: "Deactivate" },
  subject: { singular: "subject", plural: "subjects", action: "Delete" },
};

/** Human-readable labels for count keys */
const COUNT_LABELS: Record<string, string> = {
  calls: "Calls",
  memories: "Memories",
  observations: "Personality observations",
  goals: "Goals",
  artifacts: "Artifacts",
  prompts: "Composed prompts",
  enrollments: "Enrollments",
  targets: "Behavior targets",
  attributes: "Attributes",
  actions: "Actions",
  messages: "Messages",
  onboarding: "Onboarding sessions",
  cohorts: "Cohort memberships",
  items: "Playbook items",
  cohortAssignments: "Cohort assignments",
  subjects: "Subject links",
  goalsNullified: "Goals (unlinked)",
  callsNullified: "Calls (unlinked)",
  promptsNullified: "Prompts (unlinked)",
  targetsNullified: "Targets (unlinked)",
  invitesNullified: "Invites (unlinked)",
  childVersionsNullified: "Child versions (unlinked)",
  playbooks: "Courses",
  callers: "Callers",
  invites: "Invites",
  sources: "Content sources (unlinked)",
  domains: "Domain links",
  media: "Media links",
  curriculaNullified: "Curricula (unlinked)",
  orphanedSources: "Orphaned sources",
};

export function BulkDeleteModal({ preview, onConfirm, onCancel, onJobStarted }: BulkDeleteModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<string | null>(null);

  const { entityType, items, totals, recommendBackground, blocked } = preview;
  const labels = ENTITY_LABELS[entityType];
  const deletableItems = items.filter((i) => i.canDelete);
  const deletableCount = deletableItems.length;

  // Poll for background job completion
  useTaskPoll({
    taskId,
    onProgress: useCallback((task: any) => {
      const ctx = (task.context || {}) as Record<string, any>;
      if (ctx.deletedCount != null && ctx.totalCount != null) {
        setJobProgress(`${ctx.deletedCount}/${ctx.totalCount}${ctx.currentEntity ? ` — ${ctx.currentEntity}` : ""}`);
      }
    }, []),
    onComplete: useCallback((task: any) => {
      const ctx = (task.context || {}) as Record<string, any>;
      onConfirm({
        entityType,
        succeeded: ctx.succeeded || [],
        failed: ctx.failedItems || [],
        totalDeleted: ctx.deletedCount || 0,
        totalFailed: ctx.failedCount || 0,
      });
    }, [entityType, onConfirm]),
    onError: useCallback((message: string) => {
      setError(message);
      setLoading(false);
    }, []),
  });

  const handleConfirm = async () => {
    setLoading(true);
    setError(null);

    const deletableIds = deletableItems.map((i) => i.id);

    try {
      if (recommendBackground) {
        // Background job
        const res = await fetch("/api/admin/bulk-delete/job", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityType, entityIds: deletableIds }),
        });
        const data = await res.json();
        if (!data.ok) {
          setError(data.error || "Failed to start job");
          setLoading(false);
          return;
        }
        setTaskId(data.taskId);
        onJobStarted?.(data.taskId);
      } else {
        // Sync delete
        const res = await fetch("/api/admin/bulk-delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityType, entityIds: deletableIds }),
        });
        const data = await res.json();
        if (!data.ok) {
          // If API says use background, try that
          if (data.useBackground) {
            const jobRes = await fetch("/api/admin/bulk-delete/job", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ entityType, entityIds: deletableIds }),
            });
            const jobData = await jobRes.json();
            if (jobData.ok) {
              setTaskId(jobData.taskId);
              onJobStarted?.(jobData.taskId);
              return;
            }
          }
          setError(data.error || "Delete failed");
          setLoading(false);
          return;
        }
        onConfirm(data.result);
      }
    } catch (err: any) {
      setError(err?.message || "Network error");
      setLoading(false);
    }
  };

  // Filter out zero-value totals
  const nonZeroTotals = Object.entries(totals).filter(([, v]) => v > 0);

  return (
    <div className="hf-modal-overlay" onClick={() => !loading && !taskId && onCancel()}>
      <div className="hf-modal" style={{ maxWidth: 520, padding: 24 }} onClick={(e) => e.stopPropagation()}>
        {/* Title */}
        <h3 className="hf-modal-title">
          {labels.action} {deletableCount} {deletableCount === 1 ? labels.singular : labels.plural}
        </h3>

        {/* Blocked items warning */}
        {blocked.length > 0 && (
          <div className="hf-banner hf-banner-warning hf-mb-md" style={{ flexDirection: "column", alignItems: "flex-start" }}>
            <div className="hf-text-bold hf-text-sm">
              {blocked.length} {blocked.length === 1 ? "item" : "items"} cannot be {entityType === "domain" ? "deactivated" : "deleted"}:
            </div>
            <ul style={{ margin: "4px 0 0 16px", padding: 0, fontSize: 13 }}>
              {blocked.map((b) => (
                <li key={b.id}>
                  <strong>{b.name}</strong> — {b.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Impact summary */}
        {nonZeroTotals.length > 0 && (
          <div className="hf-banner hf-banner-error hf-mb-md" style={{ flexDirection: "column", alignItems: "flex-start" }}>
            <div className="hf-text-bold hf-text-sm hf-mb-xs">
              {entityType === "domain" ? "Affected data (preserved):" : "This will permanently affect:"}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 24px", fontSize: 13, width: "100%" }}>
              {nonZeroTotals.map(([key, val]) => (
                <div key={key} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="hf-text-muted">{COUNT_LABELS[key] || key}</span>
                  <span className="hf-text-bold">{val.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Background job info */}
        {recommendBackground && !taskId && (
          <div className="hf-banner hf-banner-info hf-mb-md">
            Large operation — this will run in the background. You can continue using the app.
          </div>
        )}

        {/* Job progress */}
        {taskId && (
          <div className="hf-banner hf-banner-info hf-mb-md" style={{ flexDirection: "column", alignItems: "flex-start" }}>
            <div className="hf-text-bold hf-text-sm">Deleting in background...</div>
            {jobProgress && <div className="hf-text-sm hf-mt-xs">{jobProgress}</div>}
            <div style={{ width: "100%", height: 4, background: "color-mix(in srgb, var(--accent-primary) 20%, transparent)", borderRadius: 2, marginTop: 8 }}>
              <div style={{ height: "100%", background: "var(--accent-primary)", borderRadius: 2, transition: "width 0.3s", width: jobProgress ? `${(parseInt(jobProgress) / deletableCount) * 100}%` : "10%" }} />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="hf-banner hf-banner-error hf-mb-md">
            {error}
          </div>
        )}

        {/* Actions */}
        {!taskId && (
          <div className="hf-modal-actions">
            <button
              onClick={onCancel}
              disabled={loading}
              className="hf-btn hf-btn-secondary"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={loading || deletableCount === 0}
              className={entityType === "domain" ? "hf-btn hf-btn-warning" : "hf-btn hf-btn-destructive"}
            >
              {loading
                ? (recommendBackground ? "Starting..." : "Deleting...")
                : `${labels.action} ${deletableCount} ${deletableCount === 1 ? labels.singular : labels.plural}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
