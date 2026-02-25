"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useTerminology } from "@/contexts/TerminologyContext";
import { FancySelect } from "@/components/shared/FancySelect";
import { PlaybookPill, CallerPill, StatusBadge } from "@/src/components/shared/EntityPill";
import { DraggableTabs } from "@/components/shared/DraggableTabs";
import { UnifiedAssistantPanel } from "@/components/shared/UnifiedAssistantPanel";
import { useAssistant, useAssistantKeyboardShortcut } from "@/hooks/useAssistant";
import { ReadinessBadge } from "@/components/shared/ReadinessBadge";
import { BulkDeleteModal } from "@/components/shared/BulkDeleteModal";
import { useBackgroundTaskQueue } from "@/components/shared/ContentJobQueue";
import type { BulkDeletePreview, BulkDeleteResult } from "@/lib/admin/bulk-delete";
import { EditableTitle } from "@/components/shared/EditableTitle";
import { BookOpen, Users, FileText, Rocket, Pencil } from "lucide-react";
import { AdvancedBanner } from "@/components/shared/AdvancedBanner";
import { SortableList } from "@/components/shared/SortableList";
import type { DomainListItem, DomainDetail } from "./components/types";
import { statusColors, playbookStatusMap, TrustBadge, DocTypeBadge } from "./components/constants";
import { SourceStatusDots } from "@/components/shared/SourceStatusDots";
import { useSourceStatus } from "@/hooks/useSourceStatus";
import { CreateDomainModal } from "./components/CreateDomainModal";
import { AddPlaybookModal } from "./components/AddPlaybookModal";
import { PromptPreviewModal } from "./components/PromptPreviewModal";
import { SectorBadge } from "./components/SectorBadge";
import { TypePicker } from "@/components/shared/TypePicker";
import { OnboardingTabContent } from "./components/OnboardingTab";

export default function DomainsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("id");
  const { terms, plural } = useTerminology();

  // List state
  const [domains, setDomains] = useState<DomainListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<"name" | "callers" | "playbooks">("name");
  const [showInactive, setShowInactive] = useState(false);

  // RBAC
  const { data: session } = useSession();
  const isOperator = ["OPERATOR", "EDUCATOR", "ADMIN", "SUPERADMIN"].includes(
    (session?.user?.role as string) || ""
  );
  const isAdmin = ["ADMIN", "SUPERADMIN"].includes(
    (session?.user?.role as string) || ""
  );

  // Detail state
  const [domain, setDomain] = useState<DomainDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"callers" | "playbooks" | "content" | "onboarding">("playbooks");
  const [showPlaybookModal, setShowPlaybookModal] = useState(false);
  const [editingType, setEditingType] = useState(false);
  const [savingType, setSavingType] = useState(false);

  // Source processing status (for status dots on content tab)
  const domainSourceIds = (domain?.subjects ?? []).flatMap(
    (sd) => sd.subject.sources.map((ss) => ss.source.id)
  );
  const sourceStatusMap = useSourceStatus(domainSourceIds, { enabled: activeTab === "content" });

  // Delete domain state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Multi-select + bulk deactivate
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedDomains, setSelectedDomains] = useState<Set<string>>(new Set());
  const [bulkDeletePreview, setBulkDeletePreview] = useState<BulkDeletePreview | null>(null);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const { addBulkDeleteJob } = useBackgroundTaskQueue();

  // Remove playbook state
  const [removingPlaybookId, setRemovingPlaybookId] = useState<string | null>(null);
  const [showRemovePlaybookConfirm, setShowRemovePlaybookConfirm] = useState<string | null>(null);

  // AI Assistant
  const assistant = useAssistant({
    defaultTab: "chat",
    layout: "popout",
    enabledTabs: ["chat", "data"],
  });
  useAssistantKeyboardShortcut(assistant.toggle);
  const [reorderingId, setReorderingId] = useState<string | null>(null);

  // Prompt preview
  const [showPromptPreview, setShowPromptPreview] = useState(false);

  const fetchDomains = () => {
    const query = showInactive ? "?includeInactive=true" : "";
    fetch(`/api/domains${query}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setDomains(data.domains || []);
        else setError(data.error);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchDomains();
  }, [showInactive]);

  // Fetch detail when selectedId changes
  useEffect(() => {
    if (!selectedId) {
      setDomain(null);
      return;
    }

    setDetailLoading(true);
    setDetailError(null);
    setEditingType(false);

    fetch(`/api/domains/${selectedId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setDomain(data.domain);
        } else {
          setDetailError(data.error);
        }
        setDetailLoading(false);
      })
      .catch((e) => {
        setDetailError(e.message);
        setDetailLoading(false);
      });
  }, [selectedId]);

  // Set activeTab from URL query param
  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam && ["callers", "playbooks", "content", "onboarding"].includes(tabParam)) {
      setActiveTab(tabParam as "callers" | "playbooks" | "content" | "onboarding");
    }
  }, [searchParams]);

  const handleDeleteDomain = async () => {
    if (!domain) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/domains/${domain.id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.ok) {
        setShowDeleteConfirm(false);
        setDomain(null);
        router.push("/x/domains", { scroll: false });
        fetchDomains();
      } else {
        setDeleteError(data.error);
      }
    } catch (e: any) {
      setDeleteError(e.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleReactivateDomain = async () => {
    if (!domain) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/domains/${domain.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: true }),
      });
      const data = await res.json();
      if (data.ok) {
        setDomain((prev) => prev ? { ...prev, isActive: true } : prev);
        fetchDomains();
      } else {
        setDeleteError(data.error);
      }
    } catch (e: any) {
      setDeleteError(e.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleRemovePlaybook = async (playbookId: string) => {
    if (!domain) return;
    setRemovingPlaybookId(playbookId);
    try {
      const res = await fetch(`/api/playbooks/${playbookId}`, { method: "DELETE" });
      const data = await res.json();
      if (data.ok) {
        // Refresh domain detail
        const refreshRes = await fetch(`/api/domains/${domain.id}`);
        const refreshData = await refreshRes.json();
        if (refreshData.ok) setDomain(refreshData.domain);
        fetchDomains();
      } else {
        alert(data.error);
      }
    } catch (e: any) {
      alert("Error removing playbook: " + e.message);
    } finally {
      setRemovingPlaybookId(null);
      setShowRemovePlaybookConfirm(null);
    }
  };

  const toggleStatus = (status: string) => {
    setSelectedStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const selectDomain = (id: string) => {
    router.push(`/x/domains?id=${id}`, { scroll: false });
  };

  // Filter and sort domains
  const filteredAndSortedDomains = domains
    .filter((d) => {
      if (search) {
        const s = search.toLowerCase();
        const matchesSearch =
          d.name.toLowerCase().includes(s) ||
          d.slug.toLowerCase().includes(s) ||
          d.description?.toLowerCase().includes(s);
        if (!matchesSearch) return false;
      }
      if (selectedStatuses.size > 0) {
        const domainStatus = d.isActive ? "active" : "inactive";
        if (!selectedStatuses.has(domainStatus)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "callers":
          return b.callerCount - a.callerCount;
        case "playbooks":
          return b.playbookCount - a.playbookCount;
        case "name":
        default:
          return a.name.localeCompare(b.name);
      }
    });

  const statusBadge = (d: DomainListItem | DomainDetail) => {
    if (!d.isActive) {
      return (
        <span className="hf-badge hf-badge-error">
          Inactive
        </span>
      );
    }
    if (d.isDefault) {
      return (
        <span className="hf-badge hf-badge-info">
          Default
        </span>
      );
    }
    return null;
  };

  const playbookStatusBadge = (status: string) => {
    return <StatusBadge status={playbookStatusMap[status] || "draft"} size="compact" />;
  };

  // Detail handlers
  const sortedPlaybooks = [...(domain?.playbooks || [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const publishedPlaybooks = sortedPlaybooks.filter((p) => p.status === "PUBLISHED");

  const handleReorder = async (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const currentPlaybook = sortedPlaybooks[fromIndex];
    const swapPlaybook = sortedPlaybooks[toIndex];
    if (!currentPlaybook || !swapPlaybook) return;

    setReorderingId(currentPlaybook.id);
    try {
      await Promise.all([
        fetch(`/api/playbooks/${currentPlaybook.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sortOrder: swapPlaybook.sortOrder }),
        }),
        fetch(`/api/playbooks/${swapPlaybook.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sortOrder: currentPlaybook.sortOrder }),
        }),
      ]);
      // Refresh domain detail
      const res = await fetch(`/api/domains/${selectedId}`);
      const data = await res.json();
      if (data.ok) setDomain(data.domain);
    } catch (err: any) {
      alert("Error reordering: " + err.message);
    } finally {
      setReorderingId(null);
    }
  };

  const FilterPill = ({
    label,
    isActive,
    colors,
    onClick,
    icon,
    tooltip,
  }: {
    label: string;
    isActive: boolean;
    colors: { bg: string; text: string };
    onClick: () => void;
    icon?: string;
    tooltip?: string;
  }) => (
    <button
      onClick={onClick}
      title={tooltip}
      className="hf-filter-pill"
      style={isActive ? {
        border: `1px solid color-mix(in srgb, ${colors.text} 25%, transparent)`,
        background: colors.bg,
        color: colors.text,
      } : undefined}
    >
      {icon && <span>{icon}</span>}
      {label}
    </button>
  );

  const ClearBtn = ({ onClick, show }: { onClick: () => void; show: boolean }) => (
    show ? (
      <button
        onClick={onClick}
        className="hf-clear-btn"
        title="Clear filter"
      >
        ×
      </button>
    ) : null
  );

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <AdvancedBanner />
      {/* Header */}
      <div className="hf-card-compact hf-mb-md" style={{ borderRadius: 8, position: "relative", zIndex: 2 }}>
        <div className="hf-flex hf-flex-between" style={{ marginBottom: 10 }}>
          <h1 className="hf-section-title">{plural("domain")}</h1>
          <div className="hf-flex hf-gap-md hf-items-center">
            {isOperator && (
              <button
                onClick={() => {
                  setSelectionMode(!selectionMode);
                  setSelectedDomains(new Set());
                }}
                className={`hf-btn-sm ${selectionMode ? "hf-btn-warning" : "hf-btn-secondary"}`}
              >
                {selectionMode ? "Cancel Select" : "Select"}
              </button>
            )}
            <button
              onClick={() => setShowCreate(true)}
              className="hf-btn-sm hf-btn-primary"
            >
              + New
            </button>
            <button
              onClick={() => {
                if (domain) {
                  assistant.openWithDomain(domain);
                } else {
                  assistant.open(undefined, { page: "/x/domains" });
                }
              }}
              className="hf-btn-sm hf-btn-ai"
              title="Ask AI Assistant (Cmd+Shift+K)"
            >
              ✨ Ask AI
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="hf-flex hf-flex-wrap hf-gap-lg hf-items-center">
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="hf-input"
            style={{ padding: "6px 10px", borderRadius: 6, width: 160, fontSize: 12, borderColor: "var(--border-strong)" }}
          />

          <div className="hf-divider-v" />

          {/* Status */}
          <div className="hf-flex hf-gap-sm hf-items-center">
            <span className="hf-text-xs hf-text-muted hf-text-bold" title={`Filter by ${terms.domain.toLowerCase()} status`}>Status</span>
            <ClearBtn onClick={() => setSelectedStatuses(new Set())} show={selectedStatuses.size > 0} />
            <div className="hf-flex hf-gap-xs">
              <FilterPill
                label="ACTIVE"
                icon={statusColors.active.icon}
                tooltip={statusColors.active.desc}
                isActive={selectedStatuses.has("active")}
                colors={statusColors.active}
                onClick={() => toggleStatus("active")}
              />
              <button
                onClick={() => setShowInactive(!showInactive)}
                title={showInactive ? "Hide inactive institutions" : "Show inactive institutions"}
                className="hf-filter-pill"
                style={showInactive ? {
                  border: "1px solid color-mix(in srgb, var(--status-warning-text) 25%, transparent)",
                  background: "var(--status-warning-bg)",
                  color: "var(--status-warning-text)",
                } : undefined}
              >
                {showInactive ? "Showing Inactive" : "Show Inactive"}
              </button>
            </div>
          </div>

          <div className="hf-divider-v" />

          <span className="hf-text-xs hf-text-muted hf-text-bold" title="Sort domains">Sort</span>
          <FancySelect
            value={sortBy}
            onChange={(v) => setSortBy(v as "name" | "callers" | "playbooks")}
            searchable={false}
            style={{ minWidth: 120 }}
            options={[
              { value: "name", label: "Name" },
              { value: "callers", label: plural("caller") },
              { value: "playbooks", label: plural("playbook") },
            ]}
          />
        </div>
      </div>

      {error && (
        <div className="hf-banner hf-banner-error hf-mb-lg" style={{ borderRadius: 8 }}>
          {error}
        </div>
      )}

      {/* Master-Detail Layout */}
      <div className="hf-flex hf-gap-lg hf-flex-1" style={{ minHeight: 0, overflow: "hidden", alignItems: "stretch" }}>
        {/* List Panel */}
        <div className="hf-master-list">
          {loading ? (
            <div className="hf-text-center hf-text-muted" style={{ padding: 40 }}>Loading...</div>
          ) : filteredAndSortedDomains.length === 0 ? (
            <div className="hf-empty-compact" style={{ border: "1px solid var(--border-default)", borderRadius: 12 }}>
              <div style={{ fontSize: 48 }} className="hf-mb-md">🌐</div>
              <div className="hf-heading-lg hf-text-secondary">
                {search || selectedStatuses.size > 0 ? `No ${plural("domain").toLowerCase()} match filters` : `No ${plural("domain").toLowerCase()} yet`}
              </div>
            </div>
          ) : (
            <div className="hf-flex-col hf-gap-sm">
              {filteredAndSortedDomains.map((d) => (
                <div
                  key={d.id}
                  onClick={() => {
                    if (selectionMode) {
                      setSelectedDomains((prev) => {
                        const next = new Set(prev);
                        if (next.has(d.id)) next.delete(d.id);
                        else next.add(d.id);
                        return next;
                      });
                    } else {
                      selectDomain(d.id);
                    }
                  }}
                  className={`hf-master-item${selectedId === d.id && !selectionMode ? " hf-master-item-selected" : ""}${!d.isActive ? " hf-master-item-inactive" : ""}${selectionMode && selectedDomains.has(d.id) ? " hf-master-item-selected" : ""}`}
                >
                  <div className="hf-flex hf-gap-sm hf-mb-sm hf-items-center">
                    {selectionMode && (
                      <input
                        type="checkbox"
                        checked={selectedDomains.has(d.id)}
                        onChange={() => {
                          setSelectedDomains((prev) => {
                            const next = new Set(prev);
                            if (next.has(d.id)) next.delete(d.id);
                            else next.add(d.id);
                            return next;
                          });
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="cp-selection-checkbox"
                      />
                    )}
                    <h3 className="hf-heading-sm hf-mb-0">{d.name}</h3>
                    <SectorBadge typeSlug={d.institution?.type?.slug} typeName={d.institution?.type?.name} />
                    {statusBadge(d)}
                  </div>
                  <p className="hf-text-xs hf-text-muted" style={{ margin: 0, marginBottom: 10, lineHeight: 1.4 }}>
                    {d.description || <em>No description</em>}
                  </p>
                  <div className="hf-flex hf-gap-md hf-text-xs hf-text-muted hf-items-center">
                    <span><strong>{d.callerCount || 0}</strong> callers</span>
                    <span><strong>{d.playbookCount || 0}</strong> playbooks</span>
                    <ReadinessBadge domainId={d.id} size="compact" />
                  </div>
                  {d.publishedPlaybook && (
                    <div
                      className="hf-text-xs hf-mt-sm"
                      style={{
                        padding: "6px 10px",
                        background: "var(--status-success-bg)",
                        borderRadius: 5,
                      }}
                    >
                      <span className="hf-text-success hf-text-bold">Published:</span>{" "}
                      <span className="hf-text-success">
                        {d.publishedPlaybook.name} v{d.publishedPlaybook.version}
                      </span>
                    </div>
                  )}
                  {!d.publishedPlaybook && (
                    <div
                      className="hf-text-xs hf-text-warning hf-mt-sm"
                      style={{
                        padding: "6px 10px",
                        background: "var(--status-warning-bg)",
                        borderRadius: 5,
                      }}
                    >
                      No published playbook
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Detail Panel */}
        <div className="hf-master-detail-right">
          {!selectedId ? (
            <div className="hf-flex-center hf-text-placeholder" style={{ height: "100%" }}>
              <div className="hf-text-center">
                <div style={{ fontSize: 48 }} className="hf-mb-md">🌐</div>
                <div className="hf-text-md">Select a domain to view details</div>
              </div>
            </div>
          ) : detailLoading ? (
            <div className="hf-text-center hf-text-muted" style={{ padding: 40 }}>Loading institution...</div>
          ) : detailError || !domain ? (
            <div className="hf-banner hf-banner-error" style={{ borderRadius: 8 }}>
              {detailError || "Institution not found"}
            </div>
          ) : (
            <>
              {/* Detail Header */}
              <div className="hf-flex hf-flex-between hf-mb-lg hf-items-start">
                <div>
                  <div className="hf-flex hf-gap-md hf-items-center">
                    <EditableTitle
                      value={domain.name}
                      as="h2"
                      onSave={async (newName) => {
                        const res = await fetch(`/api/domains/${domain.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ name: newName }),
                        });
                        const data = await res.json();
                        if (!data.ok) throw new Error(data.error);
                        setDomain((prev) => prev ? { ...prev, name: newName } : prev);
                        fetchDomains();
                      }}
                    />
                    {domain.institution?.type?.slug ? (
                      <span className="hf-flex hf-gap-xs hf-items-center">
                        <SectorBadge typeSlug={domain.institution.type.slug} typeName={domain.institution.type.name} size="md" />
                        {isAdmin && domain.institution && (
                          <button
                            onClick={() => setEditingType(true)}
                            className="hf-btn-icon-xs"
                            title="Change institution type"
                          >
                            <Pencil size={12} />
                          </button>
                        )}
                      </span>
                    ) : domain.institution && isAdmin ? (
                      <button
                        onClick={() => setEditingType(true)}
                        className="hf-btn-sm hf-btn-secondary"
                      >
                        Set type
                      </button>
                    ) : (
                      <SectorBadge typeSlug={null} />
                    )}
                    {domain.isDefault && (
                      <span className="hf-badge hf-badge-info">
                        Default
                      </span>
                    )}
                    {!domain.isActive && (
                      <span className="hf-badge hf-badge-error">
                        Inactive
                      </span>
                    )}
                    <ReadinessBadge domainId={domain.id} onScaffold={fetchDomains} />
                  </div>
                  {domain.description && (
                    <p className="hf-text-sm hf-text-muted hf-mt-xs hf-mb-0">{domain.description}</p>
                  )}
                </div>
                {!domain.isDefault && isOperator && (
                  <>
                    {domain.isActive ? (
                      <button
                        onClick={() => { setShowDeleteConfirm(true); setDeleteError(null); }}
                        className="hf-btn-sm hf-btn-destructive hf-nowrap"
                      >
                        Deactivate Institution
                      </button>
                    ) : (
                      <button
                        onClick={handleReactivateDomain}
                        disabled={deleting}
                        className="hf-btn-sm hf-btn-primary hf-nowrap"
                        style={{
                          opacity: deleting ? 0.7 : 1,
                          cursor: deleting ? "not-allowed" : "pointer",
                        }}
                      >
                        {deleting ? "Reactivating..." : "Reactivate Institution"}
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* Inline Type Picker */}
              {editingType && domain.institution && (
                <div className="hf-card-compact hf-mb-md" style={{ padding: 16 }}>
                  <div className="hf-text-sm hf-text-bold hf-mb-sm">Change institution type</div>
                  <TypePicker
                    value={domain.institution.type?.slug ?? null}
                    onChange={async (slug, typeId) => {
                      if (!typeId || !domain.institution) return;
                      setSavingType(true);
                      try {
                        const res = await fetch(`/api/institutions/${domain.institution.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ typeId }),
                        });
                        const data = await res.json();
                        if (!data.ok) throw new Error(data.error);
                        // Refresh domain detail to pick up new type
                        const detailRes = await fetch(`/api/domains/${domain.id}`);
                        const detailData = await detailRes.json();
                        if (detailData.ok) setDomain(detailData.domain);
                        fetchDomains();
                        setEditingType(false);
                      } catch (err) {
                        console.error("Failed to update institution type:", err);
                      } finally {
                        setSavingType(false);
                      }
                    }}
                  />
                  <div className="hf-flex hf-gap-sm hf-mt-sm">
                    <button
                      onClick={() => setEditingType(false)}
                      disabled={savingType}
                      className="hf-btn-sm hf-btn-secondary"
                    >
                      Cancel
                    </button>
                    {savingType && <span className="hf-text-sm hf-text-muted">Saving...</span>}
                  </div>
                </div>
              )}

              {/* Deactivate Confirmation */}
              {showDeleteConfirm && (
                <div className="hf-banner hf-banner-error hf-mb-md" style={{ border: "1px solid var(--status-error-border)", borderRadius: 8 }}>
                  <div className="hf-text-bold hf-text-md hf-text-error hf-mb-sm">
                    Deactivate &ldquo;{domain.name}&rdquo;?
                  </div>
                  {domain._count.callers > 0 ? (
                    <div>
                      <p className="hf-text-sm hf-text-error hf-mb-sm" style={{ margin: 0 }}>
                        Cannot deactivate this institution — it has {domain._count.callers} caller{domain._count.callers !== 1 ? "s" : ""} assigned.
                        Reassign callers to another institution first.
                      </p>
                      <button
                        onClick={() => setShowDeleteConfirm(false)}
                        className="hf-btn-sm hf-btn-secondary"
                      >
                        OK
                      </button>
                    </div>
                  ) : (
                    <div>
                      <p className="hf-text-sm hf-text-error" style={{ margin: "0 0 12px 0" }}>
                        This will deactivate the institution{domain._count.playbooks > 0 ? ` and its ${domain._count.playbooks} course${domain._count.playbooks !== 1 ? "s" : ""} will become inactive` : ""}.
                        You can reactivate it at any time.
                      </p>
                      {deleteError && (
                        <p className="hf-text-xs hf-text-error hf-mb-sm" style={{ margin: 0 }}>{deleteError}</p>
                      )}
                      <div className="hf-flex hf-gap-sm">
                        <button
                          onClick={handleDeleteDomain}
                          disabled={deleting}
                          className="hf-btn-sm hf-text-bold"
                          style={{
                            background: "var(--status-error-text)",
                            color: "white",
                            opacity: deleting ? 0.7 : 1,
                            cursor: deleting ? "not-allowed" : "pointer",
                          }}
                        >
                          {deleting ? "Deactivating..." : "Yes, Deactivate"}
                        </button>
                        <button
                          onClick={() => setShowDeleteConfirm(false)}
                          disabled={deleting}
                          className="hf-btn-sm hf-btn-secondary"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Stats */}
              <div className="hf-flex hf-gap-lg hf-mb-lg">
                <div className="hf-stat-card" style={{ minWidth: 100, gap: 0 }}>
                  <div className="hf-stat-value-sm">{domain._count.callers}</div>
                  <div className="hf-text-xs hf-text-muted">Callers</div>
                </div>
                <div className="hf-stat-card" style={{ minWidth: 100, gap: 0 }}>
                  <div className="hf-stat-value-sm">{domain._count.playbooks}</div>
                  <div className="hf-text-xs hf-text-muted">{plural("playbook")}</div>
                </div>
                <div className="hf-stat-card" style={{ minWidth: 100, gap: 0 }}>
                  <div className="hf-stat-value-sm">
                    {domain.playbooks.filter((p) => p.status === "PUBLISHED").length}
                  </div>
                  <div className="hf-text-xs hf-text-muted">Published</div>
                </div>
                <div className="hf-stat-card" style={{ minWidth: 100, gap: 0 }}>
                  <div className="hf-stat-value-sm">{domain._count.subjects ?? 0}</div>
                  <div className="hf-text-xs hf-text-muted">Subjects</div>
                </div>
              </div>

              {/* Tabs */}
              <DraggableTabs
                storageKey={`domain-detail-tabs-${domain.id}`}
                tabs={[
                  { id: "playbooks", label: plural("playbook"), icon: <BookOpen size={14} />, count: domain.playbooks.length },
                  { id: "callers", label: plural("caller"), icon: <Users size={14} />, count: domain._count.callers },
                  { id: "content", label: "Content", icon: <FileText size={14} />, count: domain._count.subjects ?? 0 },
                  { id: "onboarding", label: "Onboarding", icon: <Rocket size={14} /> },
                ]}
                activeTab={activeTab}
                onTabChange={(id) => setActiveTab(id as "callers" | "playbooks" | "content" | "onboarding")}
                containerStyle={{ marginBottom: 24 }}
              />

              {/* Playbooks Tab */}
              {activeTab === "playbooks" && (
                <div>
                  <div className="hf-flex hf-flex-between hf-mb-md hf-items-center">
                    <h3 className="hf-heading-lg">{plural("playbook")}</h3>
                    <button
                      onClick={() => setShowPlaybookModal(true)}
                      className="hf-btn hf-btn-primary"
                    >
                      + Add {terms.playbook}
                    </button>
                  </div>

                  {/* Stack Order Info */}
                  {publishedPlaybooks.length > 1 && (
                    <div className="hf-banner hf-banner-info hf-mb-md hf-text-xs" style={{ borderRadius: 6 }}>
                      <strong>Stack Order:</strong> {publishedPlaybooks.length} published {plural("playbook").toLowerCase()} will be stacked.
                      First {terms.playbook.toLowerCase()} wins on spec conflicts. Use arrows to reorder.
                    </div>
                  )}

                  {sortedPlaybooks.length === 0 ? (
                    <div className="hf-empty-compact">
                      <p className="hf-text-muted hf-mb-md">{`No ${plural("playbook").toLowerCase()} yet`}</p>
                      <button
                        onClick={() => setShowPlaybookModal(true)}
                        className="hf-btn hf-btn-primary"
                      >
                        Add First {terms.playbook}
                      </button>
                    </div>
                  ) : (
                    <SortableList
                      items={sortedPlaybooks}
                      getItemId={(p) => p.id}
                      onReorder={handleReorder}
                      onRemove={(index) => {
                        const playbook = sortedPlaybooks[index];
                        if (playbook) setShowRemovePlaybookConfirm(playbook.id);
                      }}
                      disabled={!!reorderingId}
                      renderCard={(playbook) => {
                        const isPublished = playbook.status === "PUBLISHED";
                        const stackPosition = isPublished ? publishedPlaybooks.findIndex((p) => p.id === playbook.id) + 1 : null;
                        return (
                          <div className="hf-flex hf-gap-md hf-flex-1 hf-items-center" onClick={(e) => e.stopPropagation()}>
                            {/* Stack position badge */}
                            <div
                              className="hf-stack-badge"
                              style={{
                                background: isPublished ? "var(--status-success-bg)" : "var(--surface-tertiary)",
                                color: isPublished ? "var(--status-success-text)" : "var(--text-muted)",
                              }}
                            >
                              {stackPosition ? `#${stackPosition}` : "—"}
                            </div>

                            {/* Playbook info */}
                            <Link
                              href={`/x/playbooks/${playbook.id}`}
                              className="hf-link-plain hf-flex-1"
                            >
                              <div className="hf-flex hf-gap-sm hf-flex-wrap hf-items-center" style={{ marginBottom: 2 }}>
                                <PlaybookPill label={playbook.name} size="compact" />
                                {playbookStatusBadge(playbook.status)}
                                <span className="hf-text-xs hf-text-placeholder">v{playbook.version}</span>
                              </div>
                              <div className="hf-text-xs hf-text-muted">
                                {playbook._count?.items || 0} specs
                                {(playbook._count?.enrollments ?? 0) > 0 && (
                                  <> &bull; {playbook._count!.enrollments} enrolled</>
                                )}
                                {playbook.publishedAt && (
                                  <> &bull; Published {new Date(playbook.publishedAt).toLocaleDateString()}</>
                                )}
                              </div>
                            </Link>

                            {/* Remove confirm (inline) */}
                            {showRemovePlaybookConfirm === playbook.id && (
                              <div className="hf-flex hf-gap-xs hf-items-center">
                                <span className="hf-text-xs hf-text-error hf-nowrap">
                                  {isPublished ? "Archive first" : "Remove?"}
                                </span>
                                {!isPublished && (
                                  <button
                                    onClick={(e) => { e.preventDefault(); handleRemovePlaybook(playbook.id); }}
                                    disabled={removingPlaybookId === playbook.id}
                                    className="hf-btn-xs"
                                    style={{
                                      background: "var(--status-error-text)",
                                      color: "white",
                                      opacity: removingPlaybookId === playbook.id ? 0.7 : 1,
                                      cursor: removingPlaybookId === playbook.id ? "not-allowed" : "pointer",
                                    }}
                                  >
                                    {removingPlaybookId === playbook.id ? "..." : "Yes"}
                                  </button>
                                )}
                                <button
                                  onClick={(e) => { e.preventDefault(); setShowRemovePlaybookConfirm(null); }}
                                  className="hf-btn-xs hf-btn-secondary"
                                >
                                  No
                                </button>
                              </div>
                            )}

                            <Link href={`/x/playbooks/${playbook.id}`} className="hf-link-plain hf-flex-shrink-0 hf-text-placeholder">
                              →
                            </Link>
                          </div>
                        );
                      }}
                    />
                  )}
                </div>
              )}

              {/* Callers Tab */}
              {activeTab === "callers" && (
                <div>
                  <h3 className="hf-heading-lg hf-mb-md">
                    Callers in this Institution
                  </h3>

                  {domain.callers.length === 0 ? (
                    <div className="hf-empty-compact">
                      <p className="hf-text-muted">No callers assigned to this domain yet</p>
                    </div>
                  ) : (
                    <div style={{ background: "var(--surface-primary)", border: "1px solid var(--border-default)", borderRadius: 8, overflow: "hidden" }}>
                      <table className="hf-table">
                        <thead>
                          <tr style={{ background: "var(--surface-secondary)", borderBottom: "1px solid var(--border-default)" }}>
                            <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>Name</th>
                            <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>Contact</th>
                            <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>Calls</th>
                            <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>Created</th>
                          </tr>
                        </thead>
                        <tbody>
                          {domain.callers.map((caller) => (
                            <tr key={caller.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                              <td style={{ padding: "12px 16px" }}>
                                <CallerPill
                                  label={caller.name || "No name"}
                                  href={`/x/callers/${caller.id}`}
                                  size="compact"
                                />
                              </td>
                              <td className="hf-text-md hf-text-muted" style={{ padding: "12px 16px" }}>
                                {caller.email || caller.phone || caller.externalId || "—"}
                              </td>
                              <td className="hf-text-md" style={{ padding: "12px 16px" }}>{caller._count.calls}</td>
                              <td className="hf-text-xs hf-text-muted" style={{ padding: "12px 16px" }}>
                                {new Date(caller.createdAt).toLocaleDateString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Content Tab */}
              {activeTab === "content" && (
                <div>
                  <h3 className="hf-heading-lg hf-mb-md">Subjects & Materials</h3>
                  {(!domain.subjects || domain.subjects.length === 0) ? (
                    <div className="hf-empty-compact">
                      <div style={{ fontSize: 32 }} className="hf-mb-md">📚</div>
                      <div className="hf-text-md hf-text-muted hf-mb-md">
                        No subjects linked to this domain yet.
                      </div>
                      <Link
                        href="/x/subjects"
                        className="hf-link-accent hf-text-md"
                      >
                        Go to Subjects to link one →
                      </Link>
                    </div>
                  ) : (
                    <div className="hf-flex-col hf-gap-lg">
                      {domain.subjects.map((sd) => {
                        const subj = sd.subject;
                        const totalAssertions = subj.sources.reduce(
                          (sum, ss) => sum + ss.source._count.assertions, 0
                        );
                        return (
                          <div
                            key={subj.id}
                            style={{
                              border: "1px solid var(--border-default)",
                              borderRadius: 8,
                              overflow: "hidden",
                            }}
                          >
                            {/* Subject header */}
                            <div className="hf-flex hf-flex-between hf-items-center" style={{ padding: "12px 16px", background: "var(--surface-secondary)" }}>
                              <div>
                                <Link
                                  href={`/x/subjects?id=${subj.id}`}
                                  className="hf-link-plain hf-heading-sm hf-text-primary hf-mb-0"
                                >
                                  {subj.name}
                                </Link>
                                {subj.qualificationRef && (
                                  <span className="hf-text-xs hf-text-muted hf-mono hf-ml-sm">
                                    {subj.qualificationRef}
                                  </span>
                                )}
                              </div>
                              <div className="hf-flex hf-gap-sm hf-text-xs hf-text-muted hf-items-center">
                                <span>{subj._count.sources} source{subj._count.sources !== 1 ? "s" : ""} / {totalAssertions} assertion{totalAssertions !== 1 ? "s" : ""}</span>
                                <Link
                                  href={`/x/content-sources`}
                                  className="hf-micro-action"
                                  style={{
                                    color: "var(--accent-primary)",
                                    background: "color-mix(in srgb, var(--accent-primary) 10%, transparent)",
                                  }}
                                >
                                  Add Content
                                </Link>
                                <Link
                                  href={`/x/domains/${domain.id}/extraction`}
                                  className="hf-micro-action"
                                  style={{
                                    color: "var(--badge-purple-text)",
                                    background: "var(--badge-purple-bg)",
                                  }}
                                >
                                  Extraction Config
                                </Link>
                              </div>
                            </div>
                            {/* Sources list */}
                            {subj.sources.length > 0 ? (
                              <div style={{ padding: "8px 16px" }}>
                                {subj.sources.map((ss, idx) => (
                                  <div
                                    key={ss.id}
                                    className="hf-flex hf-gap-md hf-items-center"
                                    style={{
                                      padding: "8px 0",
                                      borderTop: idx > 0 ? "1px solid var(--border-subtle)" : "none",
                                    }}
                                  >
                                    <span className="hf-text-md hf-text-muted" style={{ width: 20 }}>
                                      {idx === subj.sources.length - 1 ? "└" : "├"}
                                    </span>
                                    {ss.tags?.length > 0 && (
                                      <span className="hf-micro-badge hf-uppercase">
                                        {ss.tags[0]}
                                      </span>
                                    )}
                                    <DocTypeBadge type={ss.source.documentType} />
                                    <Link
                                      href={`/x/content-sources?highlight=${ss.source.id}`}
                                      className="hf-link-plain hf-text-sm hf-text-bold hf-flex-1 hf-text-primary"
                                    >
                                      {ss.source.name}
                                    </Link>
                                    <TrustBadge level={ss.source.trustLevel} />
                                    <SourceStatusDots status={sourceStatusMap[ss.source.id] ?? null} />
                                    <span className="hf-text-xs hf-text-muted hf-text-right" style={{ minWidth: 80 }}>
                                      {ss.source._count.assertions} assertion{ss.source._count.assertions !== 1 ? "s" : ""}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="hf-text-sm hf-text-muted hf-text-italic" style={{ padding: "12px 16px" }}>
                                No sources linked to this subject
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Onboarding Tab */}
              {activeTab === "onboarding" && (
                <OnboardingTabContent
                  domain={domain}
                  onDomainRefresh={() => {
                    fetch(`/api/domains/${domain.id}`)
                      .then((r) => r.json())
                      .then((data) => { if (data.ok) setDomain(data.domain); });
                  }}
                  onPreviewPrompt={() => setShowPromptPreview(true)}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Success message */}
      {successMessage && (
        <div
          className="hf-banner hf-banner-success"
          style={{ position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)", zIndex: 100, borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}
          onClick={() => setSuccessMessage(null)}
        >
          {successMessage}
        </div>
      )}

      {/* Bulk Selection Floating Bar */}
      {selectionMode && selectedDomains.size > 0 && (
        <div className="hf-floating-bar">
          <span className="hf-text-sm hf-text-bold">
            {selectedDomains.size} selected
          </span>
          <button
            onClick={async () => {
              setBulkActionLoading(true);
              try {
                const res = await fetch("/api/admin/bulk-delete/preview", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ entityType: "domain", entityIds: Array.from(selectedDomains) }),
                });
                const data = await res.json();
                if (data.ok) setBulkDeletePreview(data.preview);
              } finally {
                setBulkActionLoading(false);
              }
            }}
            disabled={bulkActionLoading}
            className="hf-btn hf-btn-warning"
          >
            {bulkActionLoading ? "Loading..." : `Deactivate Selected (${selectedDomains.size})`}
          </button>
          <button
            onClick={() => { setSelectionMode(false); setSelectedDomains(new Set()); }}
            className="hf-btn hf-btn-secondary"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Bulk Deactivate Modal */}
      {bulkDeletePreview && (
        <BulkDeleteModal
          preview={bulkDeletePreview}
          onCancel={() => setBulkDeletePreview(null)}
          onConfirm={(result: BulkDeleteResult) => {
            setBulkDeletePreview(null);
            setSelectionMode(false);
            setSelectedDomains(new Set());
            fetchDomains();
            // Refresh detail if current domain was deactivated
            if (selectedId && result.succeeded.some((s) => s.id === selectedId)) {
              fetch(`/api/domains/${selectedId}`)
                .then((r) => r.json())
                .then((data) => { if (data.ok) setDomain(data.domain); });
            }
            setSuccessMessage(
              `Deactivated ${result.totalDeleted} ${result.totalDeleted === 1 ? terms.domain.toLowerCase() : plural("domain").toLowerCase()}${result.totalFailed ? ` (${result.totalFailed} failed)` : ""}`
            );
          }}
          onJobStarted={(taskId: string) => {
            addBulkDeleteJob(taskId, "domain", selectedDomains.size);
            setBulkDeletePreview(null);
            setSelectionMode(false);
            setSelectedDomains(new Set());
            setSuccessMessage("Bulk deactivate started in background. Check the job queue for progress.");
          }}
        />
      )}

      {/* Create Domain Modal */}
      <CreateDomainModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(id) => {
          setShowCreate(false);
          fetchDomains();
          router.push(`/x/domains?id=${id}`, { scroll: false });
        }}
        onError={(msg) => setError(msg)}
      />
      {/* Add Playbook Modal */}
      {domain && (
        <AddPlaybookModal
          domainId={domain.id}
          domainName={domain.name}
          open={showPlaybookModal}
          onClose={() => setShowPlaybookModal(false)}
          onPlaybookAdded={() => {
            setShowPlaybookModal(false);
            fetch(`/api/domains/${domain.id}`)
              .then((r) => r.json())
              .then((data) => { if (data.ok) setDomain(data.domain); });
            fetchDomains();
          }}
        />
      )}
      {/* Prompt Preview Modal */}
      {domain && (
        <PromptPreviewModal
          domainId={domain.id}
          domainName={domain.name}
          open={showPromptPreview}
          onClose={() => setShowPromptPreview(false)}
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
