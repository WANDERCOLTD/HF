"use client";

import "./callers-page.css";
import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { SourcePageHeader } from "@/components/shared/SourcePageHeader";
import { FancySelect } from "@/components/shared/FancySelect";
import { DomainPill } from "@/src/components/shared/EntityPill";
import { UnifiedAssistantPanel } from "@/components/shared/UnifiedAssistantPanel";
import { useAssistant, useAssistantKeyboardShortcut } from "@/hooks/useAssistant";
import { useArchiveFilter } from "@/hooks/useArchiveFilter";
import { BulkDeleteModal } from "@/components/shared/BulkDeleteModal";
import { useBackgroundTaskQueue } from "@/components/shared/ContentJobQueue";
import type { BulkDeletePreview, BulkDeleteResult } from "@/lib/admin/bulk-delete";

type Caller = {
  id: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  externalId: string | null;
  createdAt: string;
  archivedAt: string | null;
  nextPrompt: string | null;
  nextPromptComposedAt: string | null;
  domain?: {
    id: string;
    slug: string;
    name: string;
  } | null;
  personality?: {
    parameterValues?: Record<string, number>;
    // LEGACY: Deprecated fields for backward compatibility
    openness?: number | null;
    conscientiousness?: number | null;
    extraversion?: number | null;
    agreeableness?: number | null;
    neuroticism?: number | null;
    confidenceScore: number | null;
  } | null;
  _count?: {
    calls: number;
    memories: number;
    personalityObservations: number;
  };
};

type Domain = {
  id: string;
  slug: string;
  name: string;
};

type SortOption = "name" | "calls" | "memories" | "createdAt";

interface CallersPageProps {
  routePrefix?: string;
}

export function CallersPage({ routePrefix = "" }: CallersPageProps) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const [callers, setCallers] = useState<Caller[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [resetConfirm, setResetConfirm] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [snapshotModal, setSnapshotModal] = useState<Caller | null>(null);
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filter/Sort state
  const [selectedDomain, setSelectedDomain] = useState<string>("");
  const [sortBy, setSortBy] = useState<SortOption>("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Delete state
  const [showDeleteModal, setShowDeleteModal] = useState<Caller | null>(null);
  const [deleteExclude, setDeleteExclude] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Merge callers state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedCallers, setSelectedCallers] = useState<Set<string>>(new Set());
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);

  // Bulk delete state
  const [bulkDeletePreview, setBulkDeletePreview] = useState<BulkDeletePreview | null>(null);
  const { addBulkDeleteJob } = useBackgroundTaskQueue();

  // Create caller state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newCallerName, setNewCallerName] = useState("");
  const [newCallerEmail, setNewCallerEmail] = useState("");
  const [newCallerPhone, setNewCallerPhone] = useState("");
  const [newCallerDomainId, setNewCallerDomainId] = useState("");
  const [creating, setCreating] = useState(false);

  // Archive filter
  const [showArchived, toggleShowArchived] = useArchiveFilter("callers");

  // AI Assistant
  const assistant = useAssistant({
    defaultTab: "chat",
    layout: "popout",
    enabledTabs: ["chat", "data"],
  });

  // Keyboard shortcut for assistant
  useAssistantKeyboardShortcut(assistant.toggle);

  const fetchCallers = () => {
    const archiveParam = showArchived ? "&includeArchived=true" : "";
    fetch(`/api/callers?withPersonality=true&withCounts=true${archiveParam}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setCallers(data.callers || []);
        } else {
          setError(data.error || "Failed to load callers");
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  };

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    fetchCallers();
    // Fetch domains for filter (only on mount, not on archive toggle)
    fetch("/api/domains")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setDomains(data.domains || []);
        }
      })
      .catch((e) => console.warn("[Callers] Failed to load domains:", e));
  }, [showArchived]);

  // Auto-clear success message
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  const getCallerLabel = (caller: Caller) => {
    return caller.name || caller.email || caller.phone || caller.externalId || "Unknown";
  };

  // Filter and sort callers
  const filteredAndSortedCallers = useMemo(() => {
    let result = callers.filter((caller) => {
      // Search filter
      if (search) {
        const s = search.toLowerCase();
        const matchesSearch =
          caller.name?.toLowerCase().includes(s) ||
          caller.email?.toLowerCase().includes(s) ||
          caller.phone?.toLowerCase().includes(s) ||
          caller.externalId?.toLowerCase().includes(s);
        if (!matchesSearch) return false;
      }
      // Domain filter
      if (selectedDomain) {
        if (caller.domain?.id !== selectedDomain) return false;
      }
      return true;
    });

    // Sort
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case "name":
          cmp = (getCallerLabel(a)).localeCompare(getCallerLabel(b));
          break;
        case "calls":
          cmp = (a._count?.calls || 0) - (b._count?.calls || 0);
          break;
        case "memories":
          cmp = (a._count?.memories || 0) - (b._count?.memories || 0);
          break;
        case "createdAt":
        default:
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });

    return result;
  }, [callers, search, selectedDomain, sortBy, sortDir]);

  const getPersonalityBadge = (caller: Caller) => {
    if (!caller.personality || caller.personality.confidenceScore === null) return null;

    // Helper to get parameter value (checks parameterValues first, then legacy fields)
    const getParam = (paramId: string, legacyField?: number | null) => {
      return caller.personality?.parameterValues?.[paramId] ?? legacyField ?? null;
    };

    const traits = [];
    const openness = getParam("B5-O", caller.personality.openness);
    const extraversion = getParam("B5-E", caller.personality.extraversion);
    const agreeableness = getParam("B5-A", caller.personality.agreeableness);
    const conscientiousness = getParam("B5-C", caller.personality.conscientiousness);
    const neuroticism = getParam("B5-N", caller.personality.neuroticism);

    if (openness !== null && openness > 0.6) traits.push("Open");
    if (extraversion !== null && extraversion > 0.6) traits.push("Extraverted");
    if (agreeableness !== null && agreeableness > 0.6) traits.push("Agreeable");
    if (conscientiousness !== null && conscientiousness > 0.6) traits.push("Conscientious");
    if (neuroticism !== null && neuroticism > 0.6) traits.push("Neurotic");
    return traits.length > 0 ? traits.slice(0, 2).join(", ") : "Balanced";
  };

  const hasAnalysisData = (caller: Caller) => {
    return (caller._count?.memories || 0) > 0 ||
           (caller._count?.personalityObservations || 0) > 0 ||
           caller.personality?.confidenceScore !== null;
  };

  const handleReset = async (callerId: string) => {
    setActionLoading(callerId);
    try {
      const res = await fetch(`/api/callers/${callerId}/reset`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setSuccessMessage(`Reset complete: ${data.deleted.scores} scores, ${data.deleted.memories} memories deleted`);
        fetchCallers(); // Refresh data
      } else {
        setError(data.error || "Failed to reset");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(null);
      setResetConfirm(null);
    }
  };

  const handleDownload = (caller: Caller) => {
    const label = encodeURIComponent(snapshotLabel.trim().replace(/\s+/g, "-") || "");
    const url = `/api/callers/${caller.id}/snapshot${label ? `?label=${label}` : ""}`;
    window.open(url, "_blank");
    setSnapshotModal(null);
    setSnapshotLabel("");
  };

  const toggleCallerSelection = (callerId: string) => {
    setSelectedCallers((prev) => {
      const next = new Set(prev);
      if (next.has(callerId)) {
        next.delete(callerId);
      } else {
        next.add(callerId);
      }
      return next;
    });
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedCallers(new Set());
    setShowMergeModal(false);
    setMergeTarget(null);
  };

  const getSelectedCallersList = () => {
    return callers.filter((c) => selectedCallers.has(c.id));
  };

  const handleMerge = async () => {
    if (!mergeTarget || selectedCallers.size < 2) return;

    const sourceIds = Array.from(selectedCallers).filter((id) => id !== mergeTarget);

    setMerging(true);
    try {
      const res = await fetch("/api/callers/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetCallerId: mergeTarget,
          sourceCallerIds: sourceIds,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setSuccessMessage(
          `Merged ${sourceIds.length} caller(s) into ${data.targetCaller?.name || data.targetCaller?.email || "target"}. ` +
          `Moved ${data.merged?.calls || 0} calls, ${data.merged?.memories || 0} memories.`
        );
        exitSelectionMode();
        fetchCallers();
      } else {
        setError(data.error || "Failed to merge callers");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to merge callers");
    } finally {
      setMerging(false);
    }
  };

  const handleDelete = async (caller: Caller) => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/callers/${caller.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exclude: deleteExclude }),
      });
      const data = await res.json();
      if (data.ok) {
        setSuccessMessage(
          `Deleted ${getCallerLabel(caller)}${deleteExclude ? " (excluded from future imports)" : ""}`
        );
        setShowDeleteModal(null);
        setDeleteExclude(false);
        fetchCallers();
      } else {
        setError(data.error || "Failed to delete caller");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete caller");
    } finally {
      setDeleting(false);
    }
  };

  const handleCardClick = (caller: Caller, e: React.MouseEvent) => {
    // Don't navigate if clicking action buttons or in selection mode
    if (selectionMode) {
      toggleCallerSelection(caller.id);
      return;
    }
    // Check if click was on an interactive element
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("a")) {
      return;
    }
    router.push(`${routePrefix}/callers/${caller.id}`);
  };

  const handleCreateCaller = async () => {
    if (!newCallerName.trim() && !newCallerEmail.trim() && !newCallerPhone.trim()) {
      setError("Please provide at least a name, email, or phone");
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/callers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newCallerName.trim() || null,
          email: newCallerEmail.trim() || null,
          phone: newCallerPhone.trim() || null,
          domainId: newCallerDomainId || null,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setSuccessMessage(`Created caller: ${newCallerName || newCallerEmail || newCallerPhone}`);
        setShowCreateModal(false);
        setNewCallerName("");
        setNewCallerEmail("");
        setNewCallerPhone("");
        setNewCallerDomainId("");
        fetchCallers();
      } else {
        setError(data.error || "Failed to create caller");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create caller");
    } finally {
      setCreating(false);
    }
  };

  const handleArchive = async (caller: Caller, shouldArchive: boolean) => {
    setActionLoading(caller.id);
    try {
      const res = await fetch(`/api/callers/${caller.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archive: shouldArchive }),
      });
      const data = await res.json();
      if (data.ok) {
        setSuccessMessage(shouldArchive ? `Archived ${getCallerLabel(caller)}` : `Unarchived ${getCallerLabel(caller)}`);
        fetchCallers();
      } else {
        setError(data.error || "Failed to update archive status");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update archive status");
    } finally {
      setActionLoading(null);
    }
  };

  const handleBulkArchive = async () => {
    const ids = Array.from(selectedCallers);
    setActionLoading("bulk");
    try {
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/callers/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ archive: true }),
          })
        )
      );
      setSuccessMessage(`Archived ${ids.length} caller(s)`);
      exitSelectionMode();
      fetchCallers();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to archive callers");
    } finally {
      setActionLoading(null);
    }
  };

  // Sort options for FancySelect
  const sortOptions = [
    { value: "createdAt-desc", label: "Newest first" },
    { value: "createdAt-asc", label: "Oldest first" },
    { value: "name-asc", label: "Name A-Z" },
    { value: "name-desc", label: "Name Z-A" },
    { value: "calls-desc", label: "Most calls" },
    { value: "calls-asc", label: "Fewest calls" },
    { value: "memories-desc", label: "Most memories" },
    { value: "memories-asc", label: "Fewest memories" },
  ];

  return (
    <div className="hf-page-container">
      <SourcePageHeader
        title="Callers"
        description="All callers with their calls, memories, and personality profiles"
        count={callers.length}
      />

      {/* Success Message */}
      {successMessage && (
        <div className="hf-banner hf-banner-success hf-mb-md">
          <span>✓</span> {successMessage}
        </div>
      )}

      {/* Search, Filters, and Actions */}
      <div className="hf-flex hf-flex-wrap hf-gap-md hf-mb-md">
        <input
          ref={searchRef}
          type="text"
          placeholder="Search by name, email, phone, or ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="hf-input cp-search"
        />

        {/* Domain Filter */}
        <FancySelect
          value={selectedDomain}
          onChange={setSelectedDomain}
          placeholder="All domains"
          searchable={domains.length > 5}
          clearable={!!selectedDomain}
          style={{ minWidth: 160 }}
          options={[
            { value: "", label: "All domains" },
            ...domains.map((d) => ({ value: d.id, label: d.name })),
          ]}
        />

        {/* Sort */}
        <FancySelect
          value={`${sortBy}-${sortDir}`}
          onChange={(v) => {
            const [newSort, newDir] = v.split("-") as [SortOption, "asc" | "desc"];
            setSortBy(newSort);
            setSortDir(newDir);
          }}
          searchable={false}
          style={{ minWidth: 150 }}
          options={sortOptions}
        />

        {/* Archive Toggle */}
        <button
          onClick={toggleShowArchived}
          className={`cp-archive-toggle ${showArchived ? "is-active" : ""}`}
        >
          {showArchived ? "Showing Archived" : "Show Archived"}
        </button>

        <div className="cp-spacer" />

        {/* Add Caller Button */}
        <button
          onClick={() => setShowCreateModal(true)}
          className="hf-btn hf-btn-primary hf-text-sm cp-btn-compact"
        >
          + New Caller
        </button>

        <button
          onClick={() => {
            if (selectionMode) {
              exitSelectionMode();
            } else {
              setSelectionMode(true);
            }
          }}
          className={`hf-btn hf-text-sm cp-btn-compact ${selectionMode ? "hf-btn-primary" : "hf-btn-secondary"}`}
        >
          {selectionMode ? "Cancel Selection" : "Select"}
        </button>

        <button
          onClick={() => {
            assistant.open(undefined, { page: `${routePrefix}/callers` });
          }}
          className="hf-btn-ai"
          title="Ask AI Assistant (Cmd+Shift+K)"
        >
          ✨ Ask AI
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="hf-banner hf-banner-error hf-mb-md">
          {error}
          <button
            onClick={() => setError(null)}
            className="hf-btn-unstyled cp-dismiss-link"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="hf-empty">Loading...</div>
      ) : filteredAndSortedCallers.length === 0 ? (
        <div className="hf-empty-state cp-empty-bordered">
          <div className="hf-empty-state-icon">👥</div>
          <div className="hf-empty-state-title">
            {search || selectedDomain ? "No callers match your filters" : "No callers yet"}
          </div>
          <div className="hf-empty-state-desc">
            {search || selectedDomain ? "Try different filters" : "Callers are created when processing transcripts"}
          </div>
        </div>
      ) : (
        <div className="hf-card-grid">
          {filteredAndSortedCallers.map((caller) => (
            <div
              key={caller.id}
              onClick={(e) => handleCardClick(caller, e)}
              className={`cp-card${selectedCallers.has(caller.id) ? " is-selected" : ""}${caller.archivedAt ? " is-archived" : ""}`}
            >
              {/* Selection checkbox */}
              {selectionMode && (
                <div
                  className={`hf-flex-center cp-selection-checkbox${selectedCallers.has(caller.id) ? " is-checked" : ""}`}
                >
                  {selectedCallers.has(caller.id) && "✓"}
                </div>
              )}

              {/* Caller Header */}
              <div className="hf-flex-between hf-mb-sm">
                <div className="cp-name-container">
                  <div className="hf-text-md hf-text-bold hf-truncate">
                    {getCallerLabel(caller)}
                  </div>
                </div>
                <div className="hf-flex hf-gap-xs">
                  {caller.archivedAt && (
                    <span className="hf-badge hf-badge-warning cp-badge-archived">
                      Archived
                    </span>
                  )}
                  {caller.domain && (
                    <DomainPill label={caller.domain.name} size="compact" />
                  )}
                </div>
              </div>

              {/* Stats Row */}
              <div className="hf-flex hf-gap-sm hf-text-xs hf-text-muted hf-mb-sm">
                <span>📞 {caller._count?.calls || 0}</span>
                <span>💭 {caller._count?.memories || 0}</span>
                {caller.nextPrompt && <span className="hf-text-success">✨</span>}
              </div>

              {/* Action Buttons */}
              <div
                className="hf-flex hf-gap-xs cp-action-row"
              >
                <button
                  onClick={(e) => { e.stopPropagation(); router.push(`${routePrefix}/callers/${caller.id}?tab=ai-call`); }}
                  title="Start a call"
                  className="hf-btn-mini hf-btn-mini-success"
                >
                  📞
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); router.push(`/x/caller-graph/${caller.id}`); }}
                  title="View caller graph"
                  className="hf-btn-mini"
                >
                  🌌
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setSnapshotModal(caller); }}
                  disabled={actionLoading === caller.id}
                  title="Download snapshot"
                  className="hf-btn-mini"
                >
                  📥
                </button>
                {/* Spacer + Mini OCEAN */}
                <div className="cp-ocean-spacer">
                  {caller.personality && caller.personality.confidenceScore !== null && (() => {
                    // Helper to get parameter value (checks parameterValues first, then legacy fields)
                    const getParam = (paramId: string, legacyField?: number | null) => {
                      return caller.personality?.parameterValues?.[paramId] ?? legacyField ?? null;
                    };

                    return (
                      <div className="hf-flex cp-ocean-chart">
                        {[
                          { label: "O", value: getParam("B5-O", caller.personality.openness), color: "var(--trait-openness)" },
                          { label: "C", value: getParam("B5-C", caller.personality.conscientiousness), color: "var(--trait-conscientiousness)" },
                          { label: "E", value: getParam("B5-E", caller.personality.extraversion), color: "var(--trait-extraversion)" },
                          { label: "A", value: getParam("B5-A", caller.personality.agreeableness), color: "var(--trait-agreeableness)" },
                          { label: "N", value: getParam("B5-N", caller.personality.neuroticism), color: "var(--trait-neuroticism)" },
                        ].map((t, i) => (
                          <div key={i} className="hf-flex-col cp-ocean-bar-col">
                            <div className="cp-ocean-bar-track">
                              <div className="cp-ocean-bar-fill" style={{ height: `${(t.value || 0) * 100}%`, background: t.color }} />
                            </div>
                            <span className="cp-ocean-bar-label">{t.label}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
                {resetConfirm === caller.id ? (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleReset(caller.id); }}
                      disabled={actionLoading === caller.id}
                      title="Confirm reset"
                      className={`hf-btn-mini-confirm${actionLoading === caller.id ? " cp-cursor-wait" : ""}`}
                    >
                      {actionLoading === caller.id ? "..." : "Yes"}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setResetConfirm(null); }}
                      className="hf-btn-mini-cancel"
                    >
                      No
                    </button>
                  </>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); setResetConfirm(caller.id); }}
                    disabled={!hasAnalysisData(caller) || actionLoading === caller.id}
                    title={hasAnalysisData(caller) ? "Reset analysis" : "No data"}
                    className={`hf-btn-mini ${hasAnalysisData(caller) ? "hf-btn-mini-error" : "cp-btn-disabled"}`}
                  >
                    🔄
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); handleArchive(caller, !caller.archivedAt); }}
                  disabled={actionLoading === caller.id}
                  title={caller.archivedAt ? "Unarchive caller" : "Archive caller"}
                  className={`hf-btn-mini ${caller.archivedAt ? "hf-btn-mini-info" : "hf-btn-mini-warning"}${actionLoading === caller.id ? " cp-cursor-wait" : ""}`}
                >
                  {caller.archivedAt ? "📤" : "📦"}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowDeleteModal(caller); setDeleteExclude(false); }}
                  title="Delete caller"
                  className="hf-btn-mini hf-btn-mini-error"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Snapshot Modal */}
      {snapshotModal && (
        <div
          className="hf-modal-overlay"
          onClick={() => setSnapshotModal(null)}
        >
          <div
            className="hf-modal cp-modal-snapshot"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="hf-modal-title">
              Download Snapshot
            </h3>
            <p className="hf-modal-desc">
              Download analysis data for <strong>{getCallerLabel(snapshotModal)}</strong>
            </p>

            <div className="hf-field">
              <label className="hf-field-label">
                Label (optional)
              </label>
              <input
                type="text"
                placeholder="e.g., playbook-v1, baseline, test-run-3"
                value={snapshotLabel}
                onChange={(e) => setSnapshotLabel(e.target.value)}
                className="hf-input"
              />
              <p className="hf-hint">
                Label helps identify this snapshot when comparing multiple runs
              </p>
            </div>

            <div className="hf-info-box hf-mb-md">
              <strong>Comparison Workflow:</strong>
              <ol className="cp-workflow-list">
                <li>Download snapshot (label: &quot;baseline&quot;)</li>
                <li>Reset caller analysis</li>
                <li>Change playbook/settings</li>
                <li>Re-run analysis</li>
                <li>Download snapshot (label: &quot;variant-a&quot;)</li>
                <li>Use <code className="cp-code-inline">diff</code> or JSON comparison tool</li>
              </ol>
            </div>

            <div className="hf-modal-actions">
              <button
                onClick={() => {
                  setSnapshotModal(null);
                  setSnapshotLabel("");
                }}
                className="hf-btn hf-btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDownload(snapshotModal)}
                className="hf-btn hf-btn-primary"
              >
                Download JSON
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Action Bar - when 1+ callers selected */}
      {selectionMode && selectedCallers.size >= 1 && (
        <div className="hf-floating-bar">
          <span className="hf-text-md hf-text-bold">
            {selectedCallers.size} callers selected
          </span>
          <button
            onClick={() => {
              setMergeTarget(null);
              setShowMergeModal(true);
            }}
            disabled={selectedCallers.size < 2}
            className={`hf-btn hf-btn-primary${selectedCallers.size < 2 ? " cp-btn-merge-disabled" : ""}`}
          >
            Merge Selected {selectedCallers.size >= 2 ? `(${selectedCallers.size})` : ""}
          </button>
          <button
            onClick={handleBulkArchive}
            disabled={actionLoading === "bulk"}
            className={`hf-btn cp-btn-archive-bulk${actionLoading === "bulk" ? " cp-cursor-wait" : ""}`}
          >
            Archive Selected ({selectedCallers.size})
          </button>
          <button
            onClick={async () => {
              setActionLoading("bulk-delete");
              try {
                const res = await fetch("/api/admin/bulk-delete/preview", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ entityType: "caller", entityIds: Array.from(selectedCallers) }),
                });
                const data = await res.json();
                if (data.ok) setBulkDeletePreview(data.preview);
              } finally {
                setActionLoading(null);
              }
            }}
            disabled={actionLoading === "bulk-delete"}
            className="hf-btn hf-btn-destructive"
          >
            {actionLoading === "bulk-delete" ? "Loading..." : `Delete Selected (${selectedCallers.size})`}
          </button>
          <button
            onClick={exitSelectionMode}
            className="hf-btn hf-btn-secondary cp-btn-cancel-muted"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Merge Modal */}
      {showMergeModal && (
        <div
          className="hf-modal-overlay"
          onClick={() => !merging && setShowMergeModal(false)}
        >
          <div
            className="hf-modal cp-modal-merge"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="hf-modal-title">
              Merge {selectedCallers.size} Callers
            </h3>
            <p className="hf-modal-desc">
              Select which caller will receive all merged data. The other{" "}
              {selectedCallers.size - 1} caller{selectedCallers.size > 2 ? "s" : ""} will be deleted.
            </p>

            {!mergeTarget && (
              <div className="hf-banner hf-banner-warning">
                ⚠️ Please select a target caller below
              </div>
            )}

            {/* Target selection */}
            <div className="hf-mb-md">
              <label className="hf-field-label hf-mb-10">
                Merge into:
              </label>
              {getSelectedCallersList().map((caller) => (
                <label
                  key={caller.id}
                  className={`hf-flex cp-merge-target-label${mergeTarget === caller.id ? " is-selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="mergeTarget"
                    value={caller.id}
                    checked={mergeTarget === caller.id}
                    onChange={() => setMergeTarget(caller.id)}
                    className="cp-radio-input"
                  />
                  <div className="cp-spacer">
                    <div className="hf-text-md hf-text-bold">
                      {getCallerLabel(caller)}
                    </div>
                    {caller.email && caller.name && (
                      <div className="hf-text-xs hf-text-muted hf-mt-xs">
                        {caller.email}
                      </div>
                    )}
                    <div className="hf-flex hf-gap-md hf-text-xs hf-text-muted hf-mt-xs">
                      <span>{caller._count?.calls || 0} calls</span>
                      <span>{caller._count?.memories || 0} memories</span>
                    </div>
                  </div>
                </label>
              ))}
            </div>

            {/* Warning */}
            <div className="hf-banner hf-banner-warning hf-mb-md">
              <div>
                <strong>Warning:</strong> This action cannot be undone. The{" "}
                {selectedCallers.size - 1} non-target caller(s) will be permanently
                deleted after their data is moved.
              </div>
            </div>

            {/* Summary */}
            {mergeTarget && (
              <div className="hf-banner hf-banner-success hf-mb-md">
                <div>
                  <strong>Data to be merged:</strong>
                  <ul className="cp-detail-list">
                    <li>
                      {getSelectedCallersList()
                        .filter((c) => c.id !== mergeTarget)
                        .reduce((sum, c) => sum + (c._count?.calls || 0), 0)}{" "}
                      calls
                    </li>
                    <li>
                      {getSelectedCallersList()
                        .filter((c) => c.id !== mergeTarget)
                        .reduce((sum, c) => sum + (c._count?.memories || 0), 0)}{" "}
                      memories
                    </li>
                    <li>
                      {getSelectedCallersList()
                        .filter((c) => c.id !== mergeTarget)
                        .reduce((sum, c) => sum + (c._count?.personalityObservations || 0), 0)}{" "}
                      personality observations
                    </li>
                  </ul>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="hf-modal-actions">
              <button
                onClick={() => setShowMergeModal(false)}
                disabled={merging}
                className="hf-btn hf-btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleMerge}
                disabled={!mergeTarget || merging}
                title={!mergeTarget ? "Please select a target caller first" : ""}
                className="hf-btn hf-btn-primary"
              >
                {merging ? "Merging..." : "Merge Callers"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {showDeleteModal && (
        <div
          className="hf-modal-overlay"
          onClick={() => !deleting && setShowDeleteModal(null)}
        >
          <div
            className="hf-modal cp-modal-delete"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="hf-text-center cp-modal-delete-icon">🗑️</div>
            <h3 className="hf-modal-title hf-text-center">
              Delete Caller
            </h3>
            <p className="hf-modal-desc hf-text-center">
              Delete <strong>{getCallerLabel(showDeleteModal)}</strong> and all their data?
            </p>

            {/* Stats */}
            <div className="hf-banner hf-banner-error hf-mb-md">
              <div>
                <strong>This will permanently delete:</strong>
                <ul className="cp-detail-list">
                  <li>{showDeleteModal._count?.calls || 0} calls and transcripts</li>
                  <li>{showDeleteModal._count?.memories || 0} memories</li>
                  <li>{showDeleteModal._count?.personalityObservations || 0} personality observations</li>
                  <li>All analysis scores and behavior measurements</li>
                </ul>
              </div>
            </div>

            {/* Exclude Option */}
            {(showDeleteModal.phone || showDeleteModal.externalId) && (
              <label
                className={`hf-flex cp-exclude-label${deleteExclude ? " is-active" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={deleteExclude}
                  onChange={(e) => setDeleteExclude(e.target.checked)}
                  className="cp-exclude-checkbox"
                />
                <div>
                  <div className="hf-text-md hf-text-bold hf-text-secondary">
                    Exclude from future imports
                  </div>
                  <div className="hf-text-xs hf-text-muted hf-mt-xs">
                    When running &quot;Import Transcripts&quot;, calls from{" "}
                    <strong>{showDeleteModal.phone || showDeleteModal.externalId}</strong>{" "}
                    will be skipped. Use this for spam callers or test data you don&apos;t want re-imported.
                  </div>
                </div>
              </label>
            )}

            {/* Actions */}
            <div className="hf-modal-actions">
              <button
                onClick={() => setShowDeleteModal(null)}
                disabled={deleting}
                className="hf-btn hf-btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(showDeleteModal)}
                disabled={deleting}
                className="hf-btn cp-btn-delete"
              >
                {deleting ? "Deleting..." : "Delete Caller"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Caller Modal */}
      {showCreateModal && (
        <div
          className="hf-modal-overlay"
          onClick={() => !creating && setShowCreateModal(false)}
        >
          <div
            className="hf-modal cp-modal-create"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="hf-modal-title">
              New Caller
            </h3>
            <p className="hf-modal-desc">
              Create a new caller profile
            </p>

            <div className="hf-flex-col hf-gap-lg">
              <div>
                <label className="hf-field-label">
                  Name
                </label>
                <input
                  type="text"
                  value={newCallerName}
                  onChange={(e) => setNewCallerName(e.target.value)}
                  placeholder="John Smith"
                  className="hf-input"
                />
              </div>

              <div>
                <label className="hf-field-label">
                  Email
                </label>
                <input
                  type="email"
                  value={newCallerEmail}
                  onChange={(e) => setNewCallerEmail(e.target.value)}
                  placeholder="john@example.com"
                  className="hf-input"
                />
              </div>

              <div>
                <label className="hf-field-label">
                  Phone
                </label>
                <input
                  type="tel"
                  value={newCallerPhone}
                  onChange={(e) => setNewCallerPhone(e.target.value)}
                  placeholder="+1 555 123 4567"
                  className="hf-input"
                />
              </div>

              <div>
                <label className="hf-field-label">
                  Institution (optional)
                </label>
                <FancySelect
                  value={newCallerDomainId}
                  onChange={setNewCallerDomainId}
                  placeholder="Select institution..."
                  clearable
                  options={domains.map((d) => ({ value: d.id, label: d.name }))}
                />
              </div>
            </div>

            <div className="hf-modal-actions hf-mt-lg">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setNewCallerName("");
                  setNewCallerEmail("");
                  setNewCallerPhone("");
                  setNewCallerDomainId("");
                }}
                disabled={creating}
                className="hf-btn hf-btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateCaller}
                disabled={creating || (!newCallerName.trim() && !newCallerEmail.trim() && !newCallerPhone.trim())}
                className="hf-btn hf-btn-primary"
              >
                {creating ? "Creating..." : "Create Caller"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Modal */}
      {bulkDeletePreview && (
        <BulkDeleteModal
          preview={bulkDeletePreview}
          onCancel={() => setBulkDeletePreview(null)}
          onConfirm={(result: BulkDeleteResult) => {
            setBulkDeletePreview(null);
            setSelectionMode(false);
            setSelectedCallers(new Set());
            fetchCallers();
            setSuccessMessage(
              `Deleted ${result.totalDeleted} caller${result.totalDeleted === 1 ? "" : "s"}${result.totalFailed ? ` (${result.totalFailed} failed)` : ""}`
            );
          }}
          onJobStarted={(taskId: string) => {
            addBulkDeleteJob(taskId, "caller", selectedCallers.size);
            setBulkDeletePreview(null);
            setSelectionMode(false);
            setSelectedCallers(new Set());
            setSuccessMessage("Bulk delete started in background. Check the job queue for progress.");
          }}
        />
      )}

      {/* AI Assistant */}
      <UnifiedAssistantPanel
        visible={assistant.isOpen}
        onClose={assistant.close}
        context={assistant.context}
        location={assistant.location}
        {...assistant.options}
      />
    </div>
  );
}
