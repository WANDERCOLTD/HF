"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useTerminology } from "@/contexts/TerminologyContext";
import { FancySelect } from "@/components/shared/FancySelect";
import { EntityPill, DomainPill, PlaybookPill, SpecPill, StatusBadge } from "@/src/components/shared/EntityPill";
import { AdvancedBanner } from "@/components/shared/AdvancedBanner";
import { BulkDeleteModal } from "@/components/shared/BulkDeleteModal";
import { useBackgroundTaskQueue } from "@/components/shared/ContentJobQueue";
import type { BulkDeletePreview, BulkDeleteResult } from "@/lib/admin/bulk-delete";
import "./playbooks.css";

type Domain = {
  id: string;
  slug: string;
  name: string;
};

type PlaybookListItem = {
  id: string;
  name: string;
  description: string | null;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  version: string;
  domain: Domain;
  _count: { items: number };
};

type PlaybookItem = {
  id: string;
  itemType: string;
  isEnabled: boolean;
  sortOrder: number;
  spec: {
    id: string;
    slug: string;
    name: string;
    scope: string;
    outputType: string;
    specRole: string | null;
  } | null;
  promptTemplate: {
    id: string;
    slug: string;
    name: string;
  } | null;
};

type PlaybookDetail = {
  id: string;
  name: string;
  description: string | null;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  version: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  domain: Domain;
  items: PlaybookItem[];
  parentVersion: { id: string; name: string; version: string } | null;
  _count: { items: number };
};

const STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;

const statusColors: Record<string, { bg: string; text: string; icon: string; desc: string }> = {
  DRAFT: { bg: "var(--status-warning-bg)", text: "var(--status-warning-text)", icon: "\u{1F4DD}", desc: "Work in progress" },
  PUBLISHED: { bg: "var(--status-success-bg)", text: "var(--status-success-text)", icon: "\u2705", desc: "Active and in use" },
  ARCHIVED: { bg: "var(--status-neutral-bg)", text: "var(--status-neutral-text)", icon: "\u{1F4E6}", desc: "No longer active" },
};

// Map playbook status to StatusBadge status type
const playbookStatusMap: Record<string, "draft" | "active" | "archived"> = {
  DRAFT: "draft",
  PUBLISHED: "active",
  ARCHIVED: "archived",
};

const outputTypeColors: Record<string, { bg: string; text: string }> = {
  LEARN: { bg: "var(--badge-violet-bg)", text: "var(--badge-violet-text)" },
  MEASURE: { bg: "var(--badge-green-bg)", text: "var(--badge-green-text)" },
  ADAPT: { bg: "var(--badge-yellow-bg)", text: "var(--badge-yellow-text)" },
  COMPOSE: { bg: "var(--badge-pink-bg)", text: "var(--badge-pink-text)" },
  AGGREGATE: { bg: "var(--badge-indigo-bg)", text: "var(--badge-indigo-text)" },
  REWARD: { bg: "var(--badge-amber-bg)", text: "var(--badge-amber-text)" },
};

export default function PlaybooksPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("id");
  const { terms, plural } = useTerminology();

  // List state
  const [playbooks, setPlaybooks] = useState<PlaybookListItem[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newPlaybook, setNewPlaybook] = useState({ name: "", description: "", domainId: "" });
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set());
  const [selectedDomain, setSelectedDomain] = useState("");

  // Detail state
  const [playbook, setPlaybook] = useState<PlaybookDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [archivingList, setArchivingList] = useState<Set<string>>(new Set());

  // Multi-select + bulk delete
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPlaybooks, setSelectedPlaybooks] = useState<Set<string>>(new Set());
  const [bulkDeletePreview, setBulkDeletePreview] = useState<BulkDeletePreview | null>(null);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const { addBulkDeleteJob } = useBackgroundTaskQueue();

  // RBAC
  const { data: session } = useSession();
  const isOperator = ["OPERATOR", "EDUCATOR", "ADMIN", "SUPERADMIN"].includes(
    (session?.user?.role as string) || ""
  );

  const fetchPlaybooks = () => {
    Promise.all([
      fetch("/api/playbooks").then((r) => r.json()),
      fetch("/api/domains").then((r) => r.json()),
    ])
      .then(([pb, dom]) => {
        if (pb.ok) setPlaybooks(pb.playbooks || []);
        if (dom.ok) setDomains(dom.domains || []);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchPlaybooks();
  }, []);

  // Fetch detail when selectedId changes
  useEffect(() => {
    if (!selectedId) {
      setPlaybook(null);
      return;
    }

    setDetailLoading(true);
    setDetailError(null);

    fetch(`/api/playbooks/${selectedId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setPlaybook(data.playbook);
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

  const handleCreate = async () => {
    if (!newPlaybook.name || !newPlaybook.domainId) return;
    setCreating(true);
    try {
      const res = await fetch("/api/playbooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newPlaybook),
      });
      const data = await res.json();
      if (data.ok) {
        setPlaybooks([...playbooks, data.playbook]);
        setShowCreate(false);
        setNewPlaybook({ name: "", description: "", domainId: "" });
        router.push(`/x/playbooks?id=${data.playbook.id}`, { scroll: false });
      } else {
        setError(data.error);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  const handlePublish = async () => {
    if (!playbook) return;
    setPublishing(true);
    try {
      const res = await fetch(`/api/playbooks/${playbook.id}/publish`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setPlaybook(data.playbook);
        fetchPlaybooks(); // Refresh list
      } else {
        alert(data.error);
      }
    } catch (e: any) {
      alert(e.message);
    } finally {
      setPublishing(false);
    }
  };

  const handleArchive = async () => {
    if (!playbook) return;
    if (!confirm("Archive this course? It will no longer be available to learners.")) return;
    setArchiving(true);
    try {
      const res = await fetch(`/api/playbooks/${playbook.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ARCHIVED" }),
      });
      const data = await res.json();
      if (data.ok) {
        setPlaybook({ ...playbook, status: "ARCHIVED" });
        fetchPlaybooks();
      } else {
        alert(data.error);
      }
    } catch (e: any) {
      alert(e.message);
    } finally {
      setArchiving(false);
    }
  };

  const handleRestore = async () => {
    if (!playbook) return;
    setArchiving(true);
    try {
      const res = await fetch(`/api/playbooks/${playbook.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DRAFT" }),
      });
      const data = await res.json();
      if (data.ok) {
        setPlaybook({ ...playbook, status: "DRAFT" });
        fetchPlaybooks();
      } else {
        alert(data.error);
      }
    } catch (e: any) {
      alert(e.message);
    } finally {
      setArchiving(false);
    }
  };

  const handleArchiveListItem = async (playbookId: string) => {
    setArchivingList((prev) => new Set([...prev, playbookId]));
    try {
      const res = await fetch(`/api/playbooks/${playbookId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ARCHIVED" }),
      });
      const data = await res.json();
      if (data.ok) {
        fetchPlaybooks();
        // If this is the currently selected playbook, update it
        if (playbook?.id === playbookId) {
          setPlaybook({ ...playbook, status: "ARCHIVED" });
        }
      } else {
        alert(data.error);
      }
    } catch (e: any) {
      alert(e.message);
    } finally {
      setArchivingList((prev) => {
        const next = new Set(prev);
        next.delete(playbookId);
        return next;
      });
    }
  };

  const handleRestoreListItem = async (playbookId: string) => {
    setArchivingList((prev) => new Set([...prev, playbookId]));
    try {
      const res = await fetch(`/api/playbooks/${playbookId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DRAFT" }),
      });
      const data = await res.json();
      if (data.ok) {
        fetchPlaybooks();
        // If this is the currently selected playbook, update it
        if (playbook?.id === playbookId) {
          setPlaybook({ ...playbook, status: "DRAFT" });
        }
      } else {
        alert(data.error);
      }
    } catch (e: any) {
      alert(e.message);
    } finally {
      setArchivingList((prev) => {
        const next = new Set(prev);
        next.delete(playbookId);
        return next;
      });
    }
  };

  const handleDelete = async () => {
    if (!playbook) return;
    if (!confirm("Delete this course? This cannot be undone.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/playbooks/${playbook.id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.ok) {
        router.push("/x/playbooks", { scroll: false });
        fetchPlaybooks();
      } else {
        alert(data.error);
      }
    } catch (e: any) {
      alert(e.message);
    } finally {
      setDeleting(false);
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

  const selectPlaybook = (id: string) => {
    router.push(`/x/playbooks?id=${id}`, { scroll: false });
  };

  // Filter playbooks
  const filteredPlaybooks = playbooks.filter((pb) => {
    if (search) {
      const s = search.toLowerCase();
      const matchesSearch = pb.name.toLowerCase().includes(s) || pb.description?.toLowerCase().includes(s);
      if (!matchesSearch) return false;
    }
    if (selectedStatuses.size > 0 && !selectedStatuses.has(pb.status)) return false;
    if (selectedDomain && selectedDomain !== pb.domain.id) return false;
    return true;
  });

  // Group by domain
  const groupedByDomain = filteredPlaybooks.reduce(
    (acc, pb) => {
      const domainName = pb.domain.name;
      if (!acc[domainName]) acc[domainName] = [];
      acc[domainName].push(pb);
      return acc;
    },
    {} as Record<string, PlaybookListItem[]>
  );

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
      className={`pb-filter-pill ${isActive ? "" : "pb-filter-pill--inactive"}`}
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
        className="pb-clear-btn"
        title="Clear filter"
      >
        ×
      </button>
    ) : null
  );

  // Group items by scope for detail view
  const groupedItems = playbook?.items.reduce(
    (acc, item) => {
      if (!item.spec) return acc;
      const scope = item.spec.scope || "OTHER";
      if (!acc[scope]) acc[scope] = [];
      acc[scope].push(item);
      return acc;
    },
    {} as Record<string, PlaybookItem[]>
  );

  return (
    <div>
      <AdvancedBanner />
      {/* Header */}
      <div className="pb-header">
        <div className="pb-header-top">
          <h1 className="hf-section-title">{plural("playbook")}</h1>
          <div className="pb-header-actions">
            {isOperator && (
              <button
                onClick={() => {
                  setSelectionMode(!selectionMode);
                  setSelectedPlaybooks(new Set());
                }}
                className={`hf-btn-sm ${selectionMode ? "hf-btn-warning" : "hf-btn-secondary"}`}
              >
                {selectionMode ? "Cancel Select" : "Select"}
              </button>
            )}
            <button
              onClick={() => setShowCreate(true)}
              className="pb-new-btn"
            >
              + New
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="pb-filters">
          {/* Search */}
          <div className="pb-search-wrap">
            <input
              type="text"
              placeholder="Search playbooks..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`pb-search-input ${search ? "pb-search-input--has-value" : ""}`}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="pb-search-clear"
              >
                &times;
              </button>
            )}
          </div>

          <div className="pb-divider" />

          {/* Status */}
          <div className="pb-filter-group">
            <span className="pb-filter-label" title={`Filter by ${terms.playbook.toLowerCase()} status`}>Status</span>
            <ClearBtn onClick={() => setSelectedStatuses(new Set())} show={selectedStatuses.size > 0} />
            <div className="pb-filter-pills">
              {STATUSES.map((status) => {
                const config = statusColors[status];
                return (
                  <FilterPill
                    key={status}
                    label={status}
                    icon={config.icon}
                    tooltip={config.desc}
                    isActive={selectedStatuses.has(status)}
                    colors={config}
                    onClick={() => toggleStatus(status)}
                  />
                );
              })}
            </div>
          </div>

          {/* Domain */}
          {domains.length > 0 && (
            <>
              <div className="pb-divider" />
              <div className="pb-filter-group">
                <span className="pb-filter-label" title={`Filter by ${terms.domain.toLowerCase()}`}>{terms.domain}</span>
                <FancySelect
                  value={selectedDomain}
                  onChange={setSelectedDomain}
                  placeholder="All domains"
                  clearable
                  options={domains.map((d) => ({ value: d.id, label: d.name }))}
                  style={{ width: 180 }}
                />
              </div>
            </>
          )}

          {/* Results count */}
          <span className="pb-results-count">
            {filteredPlaybooks.length} of {playbooks.length}
          </span>
        </div>
      </div>

      {error && (
        <div className="pb-error-banner">
          {error}
        </div>
      )}

      {/* Master-Detail Layout */}
      <div className="pb-layout">
        {/* List Panel */}
        <div className="pb-list-panel">
          {loading ? (
            <div className="pb-list-loading">Loading...</div>
          ) : filteredPlaybooks.length === 0 ? (
            <div className="pb-list-empty">
              <div className="pb-list-empty-icon">{"\u{1F4DA}"}</div>
              <div className="pb-list-empty-text">
                {search || selectedStatuses.size > 0 || selectedDomain
                  ? `No ${plural("playbook").toLowerCase()} match filters`
                  : `No ${plural("playbook").toLowerCase()} yet`}
              </div>
            </div>
          ) : (
            <div className="pb-domain-list">
              {Object.entries(groupedByDomain)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([domainName, playbooksInDomain]) => (
                  <div key={domainName}>
                    <h2 className="pb-domain-heading">
                      {domainName} ({playbooksInDomain.length})
                    </h2>
                    <div className="pb-domain-items">
                      {playbooksInDomain.map((pb) => {
                        const isPublished = pb.status === "PUBLISHED";
                        const canSelect = selectionMode && !isPublished;
                        return (
                        <div
                          key={pb.id}
                          onClick={() => {
                            if (canSelect) {
                              setSelectedPlaybooks((prev) => {
                                const next = new Set(prev);
                                if (next.has(pb.id)) next.delete(pb.id);
                                else next.add(pb.id);
                                return next;
                              });
                            } else if (!selectionMode) {
                              selectPlaybook(pb.id);
                            }
                          }}
                          className={`pb-card ${selectedId === pb.id && !selectionMode ? "pb-card--selected" : ""} ${pb.status === "ARCHIVED" ? "pb-card--archived" : ""}${selectionMode && selectedPlaybooks.has(pb.id) ? " pb-card--selected" : ""}${selectionMode && isPublished ? " pb-card--archived" : ""}`}
                        >
                          <div className="pb-card-badges">
                            {canSelect && (
                              <input
                                type="checkbox"
                                checked={selectedPlaybooks.has(pb.id)}
                                onChange={() => {
                                  setSelectedPlaybooks((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(pb.id)) next.delete(pb.id);
                                    else next.add(pb.id);
                                    return next;
                                  });
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="cp-selection-checkbox"
                              />
                            )}
                            {selectionMode && isPublished && (
                              <span className="hf-text-xs hf-text-muted" title="Archive before deleting">🔒</span>
                            )}
                            <StatusBadge status={playbookStatusMap[pb.status]} size="compact" />
                            <span className="pb-version-tag">
                              v{pb.version}
                            </span>
                          </div>
                          <div className="pb-card-name">
                            {pb.name}
                          </div>
                          <div className="pb-card-count">{pb._count.items} specs</div>
                          {isOperator && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="pb-card-actions"
                            >
                              {pb.status !== "ARCHIVED" ? (
                                <button
                                  onClick={() => handleArchiveListItem(pb.id)}
                                  disabled={archivingList.has(pb.id)}
                                  title="Archive course"
                                  className="pb-card-action-btn pb-card-action-btn--archive"
                                >
                                  {archivingList.has(pb.id) ? "..." : "\u{1F4E6}"}
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleRestoreListItem(pb.id)}
                                  disabled={archivingList.has(pb.id)}
                                  title="Restore course"
                                  className="pb-card-action-btn pb-card-action-btn--restore"
                                >
                                  {archivingList.has(pb.id) ? "..." : "\u{1F4E4}"}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      ); })}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Detail Panel */}
        <div className="pb-detail-panel">
          {!selectedId ? (
            <div className="pb-detail-empty">
              <div className="pb-detail-empty-inner">
                <div className="pb-detail-empty-icon">{"\u{1F4DA}"}</div>
                <div className="pb-detail-empty-text">Select a playbook to view details</div>
              </div>
            </div>
          ) : detailLoading ? (
            <div className="pb-detail-loading">Loading playbook...</div>
          ) : detailError || !playbook ? (
            <div className="pb-detail-error">
              {detailError || `${terms.playbook} not found`}
            </div>
          ) : (
            <>
              {/* Detail Header */}
              <div className="pb-detail-header">
                <div className="pb-detail-header-row">
                  <div>
                    <h2 className="pb-detail-title">
                      {playbook.name}
                    </h2>
                    <div className="pb-detail-subtitle">
                      {playbook.domain.name} &bull; v{playbook.version}
                    </div>
                  </div>
                  <div className="pb-detail-header-buttons">
                    <Link
                      href={`/x/taxonomy-graph?focus=playbook:${playbook.id}&depth=6`}
                      className="pb-graph-link"
                      title="View in taxonomy graph"
                    >
                      {"\u{1F30C}"}
                    </Link>
                    <Link
                      href={`/x/playbooks/${playbook.id}`}
                      className="pb-editor-link"
                    >
                      Open Editor
                    </Link>
                  </div>
                </div>
              </div>

              {/* Badges */}
              <div className="pb-detail-badges">
                <StatusBadge status={playbookStatusMap[playbook.status]} />
                <DomainPill label={playbook.domain.name} href={`/x/domains?id=${playbook.domain.id}`} size="compact" />
                {playbook.parentVersion && (
                  <span className="pb-parent-badge">
                    Based on: {playbook.parentVersion.name} v{playbook.parentVersion.version}
                  </span>
                )}
              </div>

              {/* Description */}
              {playbook.description && (
                <div className="pb-description">
                  {playbook.description}
                </div>
              )}

              {/* Stats */}
              <div className="pb-stats">
                <div className="pb-stat-card">
                  <div className="pb-stat-value">{playbook.items.length}</div>
                  <div className="pb-stat-label">Specs</div>
                </div>
                <div className="pb-stat-card">
                  <div className="pb-stat-value">
                    {playbook.items.filter((i) => i.isEnabled).length}
                  </div>
                  <div className="pb-stat-label">Enabled</div>
                </div>
                {Object.keys(groupedItems || {}).length > 0 && (
                  <div className="pb-stat-card">
                    <div className="pb-stat-value">{Object.keys(groupedItems || {}).length}</div>
                    <div className="pb-stat-label">Scopes</div>
                  </div>
                )}
              </div>

              {/* Quick Actions */}
              <div className="pb-actions-section">
                <h3 className="pb-actions-title">Actions</h3>
                <div className="pb-actions-row">
                  {playbook.status === "DRAFT" && (
                    <button
                      onClick={handlePublish}
                      disabled={publishing}
                      className="pb-action-btn pb-action-btn--publish"
                    >
                      {publishing ? "Publishing..." : "Publish"}
                    </button>
                  )}
                  {playbook.status !== "ARCHIVED" && isOperator && (
                    <button
                      onClick={handleArchive}
                      disabled={archiving}
                      className="pb-action-btn pb-action-btn--archive"
                    >
                      {archiving ? "Archiving Course..." : "Archive Course"}
                    </button>
                  )}
                  {playbook.status === "ARCHIVED" && isOperator && (
                    <button
                      onClick={handleRestore}
                      disabled={archiving}
                      className="pb-action-btn pb-action-btn--restore"
                    >
                      {archiving ? "Restoring Course..." : "Restore Course"}
                    </button>
                  )}
                  {playbook.status === "DRAFT" && isOperator && (
                    <button
                      onClick={handleDelete}
                      disabled={deleting}
                      className="pb-action-btn pb-action-btn--delete"
                    >
                      {deleting ? "Deleting..." : "Delete Course"}
                    </button>
                  )}
                </div>
              </div>

              {/* Specs Preview */}
              {groupedItems && Object.keys(groupedItems).length > 0 && (
                <div>
                  <h3 className="pb-specs-title">
                    Specs by Scope
                  </h3>
                  <div className="pb-specs-groups">
                    {Object.entries(groupedItems)
                      .sort(([a], [b]) => {
                        const order = ["SYSTEM", "DOMAIN", "CALLER"];
                        return order.indexOf(a) - order.indexOf(b);
                      })
                      .map(([scope, items]) => (
                        <div key={scope}>
                          <div className="pb-scope-heading">
                            {scope} ({items.length})
                          </div>
                          <div className="pb-specs-grid">
                            {items.slice(0, 6).map((item) => (
                              <div
                                key={item.id}
                                className={`pb-spec-card ${!item.isEnabled ? "pb-spec-card--disabled" : ""}`}
                              >
                                <div className="pb-spec-name">
                                  {item.spec?.name}
                                </div>
                                <div className="pb-spec-tags">
                                  {item.spec?.outputType && (
                                    <span
                                      className="pb-spec-tag"
                                      style={{
                                        background: outputTypeColors[item.spec.outputType]?.bg || "var(--surface-secondary)",
                                        color: outputTypeColors[item.spec.outputType]?.text || "var(--text-secondary)",
                                      }}
                                    >
                                      {item.spec.outputType}
                                    </span>
                                  )}
                                  {!item.isEnabled && (
                                    <span className="pb-spec-tag pb-spec-tag--disabled">
                                      DISABLED
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                            {items.length > 6 && (
                              <div className="pb-spec-overflow">
                                +{items.length - 6} more
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Metadata */}
              <div className="pb-metadata">
                <h3 className="pb-metadata-title">Metadata</h3>
                <div className="pb-metadata-grid">
                  <div>
                    <div className="pb-metadata-label">ID</div>
                    <div className="pb-metadata-value--mono">
                      {playbook.id}
                    </div>
                  </div>
                  <div>
                    <div className="pb-metadata-label">Created</div>
                    <div className="pb-metadata-value">
                      {new Date(playbook.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div>
                    <div className="pb-metadata-label">Updated</div>
                    <div className="pb-metadata-value">
                      {new Date(playbook.updatedAt).toLocaleDateString()}
                    </div>
                  </div>
                  {playbook.publishedAt && (
                    <div>
                      <div className="pb-metadata-label">Published</div>
                      <div className="pb-metadata-value">
                        {new Date(playbook.publishedAt).toLocaleDateString()}
                      </div>
                    </div>
                  )}
                </div>
              </div>
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
      {selectionMode && selectedPlaybooks.size > 0 && (
        <div className="hf-floating-bar">
          <span className="hf-text-sm hf-text-bold">
            {selectedPlaybooks.size} selected
          </span>
          <button
            onClick={async () => {
              setBulkActionLoading(true);
              try {
                const res = await fetch("/api/admin/bulk-delete/preview", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ entityType: "playbook", entityIds: Array.from(selectedPlaybooks) }),
                });
                const data = await res.json();
                if (data.ok) setBulkDeletePreview(data.preview);
              } finally {
                setBulkActionLoading(false);
              }
            }}
            disabled={bulkActionLoading}
            className="hf-btn hf-btn-destructive"
          >
            {bulkActionLoading ? "Loading..." : `Delete Selected (${selectedPlaybooks.size})`}
          </button>
          <button
            onClick={() => { setSelectionMode(false); setSelectedPlaybooks(new Set()); }}
            className="hf-btn hf-btn-secondary"
          >
            Cancel
          </button>
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
            setSelectedPlaybooks(new Set());
            fetchPlaybooks();
            // If current detail was deleted, clear it
            if (selectedId && result.succeeded.some((s) => s.id === selectedId)) {
              router.push("/x/playbooks", { scroll: false });
            }
            setSuccessMessage(
              `Deleted ${result.totalDeleted} ${result.totalDeleted === 1 ? terms.playbook.toLowerCase() : plural("playbook").toLowerCase()}${result.totalFailed ? ` (${result.totalFailed} failed)` : ""}`
            );
          }}
          onJobStarted={(taskId: string) => {
            addBulkDeleteJob(taskId, "playbook", selectedPlaybooks.size);
            setBulkDeletePreview(null);
            setSelectionMode(false);
            setSelectedPlaybooks(new Set());
            setSuccessMessage("Bulk delete started in background. Check the job queue for progress.");
          }}
        />
      )}

      {/* Create Modal */}
      {showCreate && (
        <div
          className="pb-modal-backdrop"
          onClick={() => setShowCreate(false)}
        >
          <div
            className="pb-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="pb-modal-title">New {terms.playbook}</h2>
            <div className="pb-modal-field">
              <label className="pb-modal-label">Institution</label>
              <FancySelect
                value={newPlaybook.domainId}
                onChange={(v) => setNewPlaybook({ ...newPlaybook, domainId: v })}
                placeholder="Select institution..."
                options={domains.map((d) => ({ value: d.id, label: d.name }))}
              />
            </div>
            <div className="pb-modal-field">
              <label className="pb-modal-label">Name</label>
              <input
                type="text"
                value={newPlaybook.name}
                onChange={(e) => setNewPlaybook({ ...newPlaybook, name: e.target.value })}
                className="pb-modal-input"
              />
            </div>
            <div className="pb-modal-footer">
              <button
                onClick={() => setShowCreate(false)}
                className="pb-modal-cancel"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !newPlaybook.name || !newPlaybook.domainId}
                className="pb-modal-submit"
              >
                {creating ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
