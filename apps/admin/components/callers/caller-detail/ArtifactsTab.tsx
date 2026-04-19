"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ArtifactCard } from "@/components/sim/ArtifactCard";
import { CheckSquare, Plus, BookMarked, ClipboardCheck } from "lucide-react";
import { SectionSelector, useSectionVisibility } from "@/components/shared/SectionSelector";
import { ACTION_TYPE_ICONS, ASSIGNEE_COLORS } from "./constants";

function ProcessingNotice({ message }: { message: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 16px",
        marginBottom: 16,
        background: "var(--status-info-bg)",
        border: "1px solid var(--status-info-border)",
        borderRadius: 8,
        fontSize: 13,
        color: "var(--status-info-text)",
      }}
    >
      <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⏳</span>
      {message}
    </div>
  );
}

export function ArtifactsSection({ callerId, isProcessing }: { callerId: string; isProcessing?: boolean }) {
  const [artifacts, setArtifacts] = useState<any[]>([]);
  const [actions, setActions] = useState<any[]>([]);
  const [actionCounts, setActionCounts] = useState<{ pending: number; completed: number; total: number }>({ pending: 0, completed: 0, total: 0 });
  const [loadingArtifacts, setLoadingArtifacts] = useState(true);
  const [loadingActions, setLoadingActions] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [sectionVis, toggleSectionVis] = useSectionVisibility("caller-artifacts", {
    artifacts: true, actions: true,
  });

  const artifactsLoadedRef = useRef<string | null>(null);

  // Load artifacts (skip on tab re-toggle for same caller)
  useEffect(() => {
    if (artifactsLoadedRef.current === callerId) return;
    artifactsLoadedRef.current = callerId;
    fetch(`/api/callers/${callerId}/artifacts?limit=200`)
      .then((r) => r.json())
      .then((result) => {
        if (result.ok) setArtifacts(result.artifacts || []);
      })
      .catch((e) => console.warn("[CallerDetail] Failed to load artifacts:", e))
      .finally(() => setLoadingArtifacts(false));
  }, [callerId]);

  // Load actions
  const loadActions = useCallback(() => {
    fetch(`/api/callers/${callerId}/actions?limit=200`)
      .then((r) => r.json())
      .then((result) => {
        if (result.ok) {
          setActions(result.actions || []);
          setActionCounts(result.counts || { pending: 0, completed: 0, total: 0 });
        }
      })
      .catch((e) => console.warn("[CallerDetail] Failed to load actions:", e))
      .finally(() => setLoadingActions(false));
  }, [callerId]);

  const actionsLoadedRef = useRef<string | null>(null);
  useEffect(() => {
    if (actionsLoadedRef.current === callerId) return;
    actionsLoadedRef.current = callerId;
    loadActions();
  }, [loadActions]);

  // Auto-poll when processing to pick up new artifacts/actions
  useEffect(() => {
    if (!isProcessing) return;
    const interval = setInterval(() => {
      fetch(`/api/callers/${callerId}/artifacts?limit=200`)
        .then((r) => r.json())
        .then((result) => {
          if (result.ok) setArtifacts(result.artifacts || []);
        })
        .catch((e) => console.warn("[CallerDetail] Artifact poll failed:", e));
      loadActions();
    }, 5000);
    return () => clearInterval(interval);
  }, [isProcessing, callerId, loadActions]);

  const loading = loadingArtifacts || loadingActions;
  if (loading) return <div style={{ padding: 20, color: "var(--text-muted)" }}>Loading...</div>;

  const hasContent = artifacts.length > 0 || actions.length > 0;
  if (!hasContent && isProcessing) return <ProcessingNotice message="Artifacts and actions will appear here once the pipeline finishes processing the latest call." />;

  return (
    <div>
      <SectionSelector
        storageKey="caller-artifacts"
        sections={[
          { id: "artifacts", label: "Artifacts", icon: <BookMarked size={13} />, count: artifacts.length },
          { id: "actions", label: "Actions", icon: <ClipboardCheck size={13} />, count: actionCounts.pending || actionCounts.total },
        ]}
        visible={sectionVis}
        onToggle={toggleSectionVis}
      />

      {sectionVis.artifacts !== false && (
        <ArtifactsSubSection
          artifacts={artifacts}
          typeFilter={typeFilter}
          statusFilter={statusFilter}
          setTypeFilter={setTypeFilter}
          setStatusFilter={setStatusFilter}
        />
      )}

      {sectionVis.actions !== false && (
        <ActionsSubSection
          callerId={callerId}
          actions={actions}
          counts={actionCounts}
          onRefresh={loadActions}
        />
      )}
    </div>
  );
}

// Artifacts sub-section (extracted from original ArtifactsSection)
function ArtifactsSubSection({
  artifacts,
  typeFilter,
  statusFilter,
  setTypeFilter,
  setStatusFilter,
}: {
  artifacts: any[];
  typeFilter: string | null;
  statusFilter: string | null;
  setTypeFilter: (v: string | null) => void;
  setStatusFilter: (v: string | null) => void;
}) {
  if (artifacts.length === 0) return <div style={{ padding: 20, color: "var(--text-placeholder)" }}>No artifacts delivered yet</div>;

  const types = [...new Set(artifacts.map((a) => a.type))].sort();
  const statuses = [...new Set(artifacts.map((a) => a.status))].sort();
  const filtered = artifacts.filter((a) => {
    if (typeFilter && a.type !== typeFilter) return false;
    if (statusFilter && a.status !== statusFilter) return false;
    return true;
  });

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)", alignSelf: "center", marginRight: 4 }}>Type:</span>
        <button
          onClick={() => setTypeFilter(null)}
          style={{
            padding: "3px 8px", fontSize: 11, borderRadius: 12, border: "1px solid var(--border-default)", cursor: "pointer",
            background: !typeFilter ? "var(--status-info-bg)" : "transparent",
            color: !typeFilter ? "var(--button-primary-bg)" : "var(--text-muted)",
            fontWeight: !typeFilter ? 600 : 400,
          }}
        >
          All ({artifacts.length})
        </button>
        {types.map((type) => {
          const count = artifacts.filter((a) => a.type === type).length;
          return (
            <button
              key={type}
              onClick={() => setTypeFilter(typeFilter === type ? null : type)}
              style={{
                padding: "3px 8px", fontSize: 11, borderRadius: 12, border: "1px solid var(--border-default)", cursor: "pointer",
                background: typeFilter === type ? "var(--status-info-bg)" : "transparent",
                color: typeFilter === type ? "var(--button-primary-bg)" : "var(--text-muted)",
                fontWeight: typeFilter === type ? 600 : 400,
              }}
            >
              {type.replace(/_/g, " ")} ({count})
            </button>
          );
        })}
        {statuses.length > 1 && (
          <>
            <span style={{ fontSize: 11, color: "var(--text-muted)", alignSelf: "center", marginLeft: 8, marginRight: 4 }}>Status:</span>
            {statuses.map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(statusFilter === status ? null : status)}
                style={{
                  padding: "3px 8px", fontSize: 11, borderRadius: 12, border: "1px solid var(--border-default)", cursor: "pointer",
                  background: statusFilter === status ? "var(--status-info-bg)" : "transparent",
                  color: statusFilter === status ? "var(--button-primary-bg)" : "var(--text-muted)",
                  fontWeight: statusFilter === status ? 600 : 400,
                }}
              >
                {status}
              </button>
            ))}
          </>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map((artifact) => (
          <ArtifactCard key={artifact.id} artifact={artifact} />
        ))}
        {filtered.length === 0 && (
          <div style={{ padding: 20, color: "var(--text-placeholder)", textAlign: "center" }}>
            No artifacts match the current filters
          </div>
        )}
      </div>
    </div>
  );
}

// Actions sub-section
function ActionsSubSection({
  callerId,
  actions,
  counts,
  onRefresh,
}: {
  callerId: string;
  actions: any[];
  counts: { pending: number; completed: number; total: number };
  onRefresh: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [formType, setFormType] = useState("TASK");
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formAssignee, setFormAssignee] = useState("CALLER");
  const [formPriority, setFormPriority] = useState("MEDIUM");

  const filtered = actions.filter((a) => {
    if (assigneeFilter && a.assignee !== assigneeFilter) return false;
    if (statusFilter && a.status !== statusFilter) return false;
    return true;
  });

  const handleCreate = async () => {
    if (!formTitle.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/callers/${callerId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: formType,
          title: formTitle.trim(),
          description: formDescription.trim() || undefined,
          assignee: formAssignee,
          priority: formPriority,
        }),
      });
      if (res.ok) {
        setFormTitle("");
        setFormDescription("");
        setShowForm(false);
        onRefresh();
      }
    } catch {}
    setSubmitting(false);
  };

  const handleToggleStatus = async (actionId: string, currentStatus: string) => {
    const newStatus = currentStatus === "COMPLETED" ? "PENDING" : "COMPLETED";
    try {
      await fetch(`/api/callers/${callerId}/actions/${actionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      onRefresh();
    } catch {}
  };

  return (
    <div>
      {/* Header with New Action button */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {/* Assignee filter chips */}
          {["CALLER", "OPERATOR", "AGENT"].map((a) => {
            const count = actions.filter((act) => act.assignee === a).length;
            if (count === 0) return null;
            const colors = ASSIGNEE_COLORS[a];
            return (
              <button
                key={a}
                onClick={() => setAssigneeFilter(assigneeFilter === a ? null : a)}
                style={{
                  padding: "3px 8px", fontSize: 11, borderRadius: 12, border: "1px solid var(--border-default)", cursor: "pointer",
                  background: assigneeFilter === a ? colors.bg : "transparent",
                  color: assigneeFilter === a ? colors.text : "var(--text-muted)",
                  fontWeight: assigneeFilter === a ? 600 : 400,
                }}
              >
                {a} ({count})
              </button>
            );
          })}
          {/* Status filter */}
          {counts.completed > 0 && (
            <>
              <span style={{ fontSize: 11, color: "var(--text-muted)", alignSelf: "center", margin: "0 4px" }}>|</span>
              <button
                onClick={() => setStatusFilter(statusFilter === "COMPLETED" ? null : "COMPLETED")}
                style={{
                  padding: "3px 8px", fontSize: 11, borderRadius: 12, border: "1px solid var(--border-default)", cursor: "pointer",
                  background: statusFilter === "COMPLETED" ? "var(--status-info-bg)" : "transparent",
                  color: statusFilter === "COMPLETED" ? "var(--button-primary-bg)" : "var(--text-muted)",
                  fontWeight: statusFilter === "COMPLETED" ? 600 : 400,
                }}
              >
                Completed ({counts.completed})
              </button>
            </>
          )}
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "5px 10px", fontSize: 11, borderRadius: 6,
            border: "1px solid var(--border-default)", cursor: "pointer",
            background: showForm ? "var(--status-info-bg)" : "var(--surface-primary)",
            color: showForm ? "var(--button-primary-bg)" : "var(--text-default)",
            fontWeight: 500,
          }}
        >
          <Plus size={12} /> New Action
        </button>
      </div>

      {/* Inline creation form */}
      {showForm && (
        <div style={{
          padding: 16, marginBottom: 16, borderRadius: 8,
          border: "1px solid var(--border-default)", background: "var(--surface-secondary)",
        }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <select value={formType} onChange={(e) => setFormType(e.target.value)} style={{ padding: "6px 8px", fontSize: 12, borderRadius: 4, border: "1px solid var(--border-default)", background: "var(--surface-primary)" }}>
              <option value="TASK">Task</option>
              <option value="HOMEWORK">Homework</option>
              <option value="SEND_MEDIA">Send Media</option>
              <option value="FOLLOWUP">Follow-up</option>
              <option value="REMINDER">Reminder</option>
            </select>
            <select value={formAssignee} onChange={(e) => setFormAssignee(e.target.value)} style={{ padding: "6px 8px", fontSize: 12, borderRadius: 4, border: "1px solid var(--border-default)", background: "var(--surface-primary)" }}>
              <option value="CALLER">Caller</option>
              <option value="OPERATOR">Operator</option>
              <option value="AGENT">Agent</option>
            </select>
            <select value={formPriority} onChange={(e) => setFormPriority(e.target.value)} style={{ padding: "6px 8px", fontSize: 12, borderRadius: 4, border: "1px solid var(--border-default)", background: "var(--surface-primary)" }}>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>
          </div>
          <input
            type="text"
            placeholder="Action title..."
            value={formTitle}
            onChange={(e) => setFormTitle(e.target.value)}
            style={{ width: "100%", padding: "6px 8px", fontSize: 12, borderRadius: 4, border: "1px solid var(--border-default)", background: "var(--surface-primary)", marginBottom: 8 }}
          />
          <textarea
            placeholder="Description (optional)..."
            value={formDescription}
            onChange={(e) => setFormDescription(e.target.value)}
            rows={2}
            style={{ width: "100%", padding: "6px 8px", fontSize: 12, borderRadius: 4, border: "1px solid var(--border-default)", background: "var(--surface-primary)", resize: "vertical", marginBottom: 8 }}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => setShowForm(false)} style={{ padding: "5px 12px", fontSize: 11, borderRadius: 4, border: "1px solid var(--border-default)", cursor: "pointer", background: "var(--surface-primary)" }}>Cancel</button>
            <button onClick={handleCreate} disabled={submitting || !formTitle.trim()} style={{ padding: "5px 12px", fontSize: 11, borderRadius: 4, border: "none", cursor: "pointer", background: "var(--button-primary-bg)", color: "var(--button-primary-text)", opacity: submitting || !formTitle.trim() ? 0.5 : 1, fontWeight: 500 }}>
              {submitting ? "Creating..." : "Create"}
            </button>
          </div>
        </div>
      )}

      {/* Action cards */}
      {actions.length === 0 && !showForm && (
        <div style={{ padding: 20, color: "var(--text-placeholder)", textAlign: "center" }}>
          No actions yet. Click &quot;New Action&quot; to create one, or actions will be extracted from calls automatically.
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {filtered.map((action) => {
          const colors = ASSIGNEE_COLORS[action.assignee] || ASSIGNEE_COLORS.CALLER;
          const isCompleted = action.status === "COMPLETED";
          return (
            <div
              key={action.id}
              style={{
                display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px",
                borderRadius: 6, border: "1px solid var(--border-default)",
                background: isCompleted ? "var(--surface-secondary)" : "var(--surface-primary)",
                opacity: isCompleted ? 0.7 : 1,
              }}
            >
              {/* Checkbox */}
              <button
                onClick={() => handleToggleStatus(action.id, action.status)}
                style={{
                  width: 18, height: 18, borderRadius: 4, border: "1.5px solid var(--border-default)",
                  background: isCompleted ? "var(--button-primary-bg)" : "transparent",
                  cursor: "pointer", flexShrink: 0, marginTop: 1,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: isCompleted ? "var(--button-primary-text)" : "transparent",
                  fontSize: 11,
                }}
                title={isCompleted ? "Mark as pending" : "Mark as completed"}
              >
                {isCompleted ? "✓" : ""}
              </button>

              {/* Type icon */}
              <div style={{ flexShrink: 0, color: "var(--text-muted)", marginTop: 1 }}>
                {ACTION_TYPE_ICONS[action.type] || <CheckSquare size={14} />}
              </div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{
                    fontSize: 13, fontWeight: 500,
                    textDecoration: isCompleted ? "line-through" : "none",
                    color: isCompleted ? "var(--text-muted)" : "var(--text-default)",
                  }}>
                    {action.title}
                  </span>
                  {/* Assignee badge */}
                  <span style={{
                    padding: "1px 6px", fontSize: 10, borderRadius: 8, fontWeight: 500,
                    background: colors.bg, color: colors.text,
                  }}>
                    {action.assignee}
                  </span>
                  {/* Priority badge (only for HIGH/URGENT) */}
                  {(action.priority === "HIGH" || action.priority === "URGENT") && (
                    <span style={{
                      padding: "1px 6px", fontSize: 10, borderRadius: 8, fontWeight: 500,
                      background: action.priority === "URGENT"
                        ? "color-mix(in srgb, var(--status-error-text, #ef4444) 15%, transparent)"
                        : "color-mix(in srgb, var(--status-warning-text, #f59e0b) 15%, transparent)",
                      color: action.priority === "URGENT" ? "var(--status-error-text)" : "var(--status-warning-text, #d97706)",
                    }}>
                      {action.priority}
                    </span>
                  )}
                  {/* Source badge */}
                  {action.source === "EXTRACTED" && (
                    <span style={{ fontSize: 10, color: "var(--text-muted)", fontStyle: "italic" }}>extracted</span>
                  )}
                </div>
                {action.description && (
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.4 }}>
                    {action.description.length > 120 ? action.description.slice(0, 120) + "..." : action.description}
                  </div>
                )}
                <div style={{ fontSize: 10, color: "var(--text-placeholder)", marginTop: 4 }}>
                  {action.type.replace(/_/g, " ")} · {new Date(action.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  {action.dueAt && ` · due ${new Date(action.dueAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
                  {isCompleted && action.completedAt && ` · done ${new Date(action.completedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && actions.length > 0 && (
          <div style={{ padding: 20, color: "var(--text-placeholder)", textAlign: "center" }}>
            No actions match the current filters
          </div>
        )}
      </div>
    </div>
  );
}
