"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useApi } from "@/hooks/useApi";
import { FancySelect } from "@/components/shared/FancySelect";
import { DomainPill } from "@/src/components/shared/EntityPill";
import { School, Plus, Users } from "lucide-react";
import { useSession } from "next-auth/react";
import "./cohorts.css";

type CohortGroup = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  maxMembers: number;
  createdAt: string;
  owner: { id: string; name: string; email: string | null };
  domain: { id: string; slug: string; name: string };
  _count: { members: number };
};

type CohortsResponse = {
  cohorts: CohortGroup[];
  total: number;
};

type Domain = {
  id: string;
  slug: string;
  name: string;
};

export default function CohortsPage() {
  const [search, setSearch] = useState("");
  const [filterDomain, setFilterDomain] = useState("all");
  const [filterActive, setFilterActive] = useState("active");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data: session } = useSession();
  const isOperator = ["OPERATOR", "EDUCATOR", "ADMIN", "SUPERADMIN"].includes((session?.user?.role as string) || "");

  const handleDelete = async (id: string) => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/cohorts/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to delete");
      refetch();
    } catch (err: any) {
      setDeleteError(err.message || "Failed to delete");
    } finally {
      setDeleting(false);
      setConfirmDeleteId(null);
    }
  };

  // Fetch domains for filter
  const { data: domainsData } = useApi<{ domains: Domain[] }>("/api/domains", {
    transform: (res) => ({ domains: res.domains || [] }),
  });
  const domains = domainsData?.domains || [];

  // Fetch cohorts
  const apiUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (filterDomain !== "all") params.set("domainId", filterDomain);
    if (filterActive === "active") params.set("isActive", "true");
    if (filterActive === "inactive") params.set("isActive", "false");
    return `/api/cohorts?${params}`;
  }, [filterDomain, filterActive]);

  const {
    data: cohortsData,
    loading,
    error,
    refetch,
  } = useApi<CohortsResponse>(
    apiUrl,
    {
      transform: (res) => ({
        cohorts: (res.cohorts || []) as CohortGroup[],
        total: (res.total || 0) as number,
      }),
    },
    [filterDomain, filterActive]
  );

  const cohorts = cohortsData?.cohorts || [];

  // Client-side search filter
  const filtered = cohorts.filter((c) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(s) ||
      c.owner.name.toLowerCase().includes(s) ||
      c.domain.name.toLowerCase().includes(s)
    );
  });

  // Summary metrics (computed client-side from fetched cohorts)
  const summary = useMemo(() => {
    const active = cohorts.filter((c) => c.isActive);
    const totalMembers = cohorts.reduce((s, c) => s + c._count.members, 0);
    const fillRates = active.filter((c) => c.maxMembers > 0).map((c) => c._count.members / c.maxMembers);
    const avgFill = fillRates.length > 0
      ? Math.round(fillRates.reduce((s, r) => s + r, 0) / fillRates.length * 100)
      : 0;
    return { total: cohorts.length, active: active.length, totalMembers, avgFill };
  }, [cohorts]);

  const STATUS_PILLS = [
    { value: "active",   label: "Active" },
    { value: "inactive", label: "Inactive" },
    { value: "all",      label: "All" },
  ];

  return (
    <div className="hf-page-container hf-page-scroll">
      {/* Header */}
      <div className="co-header">
        <div>
          <div className="co-header-left">
            <School size={22} className="co-header-icon" />
            <h1 className="hf-page-title">Cohorts</h1>
            {cohortsData && (
              <span className="co-count-badge">{cohortsData.total}</span>
            )}
          </div>
          <p className="hf-page-subtitle hf-text-muted">
            Manage teacher and tutor cohort groups
          </p>
        </div>
        {isOperator && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="hf-btn hf-btn-primary"
          >
            <Plus size={14} />
            New Cohort
          </button>
        )}
      </div>

      {/* Summary Strip */}
      {!loading && cohorts.length > 0 && (
        <div className="hf-summary-strip hf-mb-md">
          <div className="hf-summary-card">
            <div className="hf-summary-card-label">Total</div>
            <div className="hf-summary-card-value">{summary.total}</div>
            <span className="hf-summary-card-sub">{summary.active} active</span>
          </div>
          <div className="hf-summary-card">
            <div className="hf-summary-card-label">Members</div>
            <div className="hf-summary-card-value">{summary.totalMembers}</div>
            <span className="hf-summary-card-sub">across all cohorts</span>
          </div>
          <div className="hf-summary-card">
            <div className="hf-summary-card-label">Avg Fill</div>
            <div className="hf-summary-card-value">{summary.avgFill}%</div>
            <span className="hf-summary-card-sub">capacity used</span>
          </div>
          <div className="hf-summary-card">
            <div className="hf-summary-card-label">Inactive</div>
            <div className="hf-summary-card-value">{summary.total - summary.active}</div>
            <span className="hf-summary-card-sub">cohorts</span>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="co-filters">
        <input
          type="text"
          placeholder="Search cohorts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="hf-input"
          style={{ width: 220, fontSize: 13 }}
        />
        {/* Status filter pills */}
        <div className="hf-flex hf-gap-xs hf-items-center">
          {STATUS_PILLS.map(({ value, label }) => (
            <button
              key={value}
              className={`hf-filter-pill${filterActive === value ? " hf-filter-pill-active" : ""}`}
              onClick={() => setFilterActive(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {/* Institution filter */}
        {domains.length > 0 && (
          <FancySelect
            value={filterDomain}
            onChange={setFilterDomain}
            searchable={false}
            style={{ minWidth: 160 }}
            options={[
              { value: "all", label: "All Institutions" },
              ...domains.map((d) => ({ value: d.id, label: d.name })),
            ]}
          />
        )}
      </div>

      {/* Delete error */}
      {deleteError && (
        <div className="hf-banner hf-banner-error hf-flex-between hf-mb-md">
          <span>{deleteError}</span>
          <button
            onClick={() => setDeleteError(null)}
            className="hf-btn-ghost"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* API error */}
      {error && (
        <div className="hf-banner hf-banner-error hf-mb-md">{error}</div>
      )}

      {/* Loading — skeleton cards */}
      {loading ? (
        <div className="co-grid">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="co-skeleton-card">
              <div className="hf-flex hf-flex-between hf-items-center">
                <div className="hf-skeleton hf-skeleton-title hf-skeleton-w-md" />
                <div className="hf-skeleton hf-skeleton-badge" />
              </div>
              <div className="hf-skeleton hf-skeleton-text hf-skeleton-w-lg" />
              <div className="hf-skeleton hf-skeleton-text hf-skeleton-w-sm" />
              <div className="co-skeleton-footer">
                <div className="hf-skeleton hf-skeleton-badge" />
                <div className="hf-skeleton hf-skeleton-text hf-skeleton-w-md" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="hf-empty-state">
          <School size={48} className="hf-icon-placeholder" />
          <div className="hf-empty-state-title">
            {search || filterDomain !== "all"
              ? "No cohorts match filters"
              : "No cohorts yet"}
          </div>
          <div className="hf-empty-state-desc">
            Create a cohort to group pupils under a teacher or tutor
          </div>
        </div>
      ) : (
        <div className="co-grid">
          {filtered.map((cohort) => {
            const fillPct = cohort.maxMembers > 0
              ? Math.round(cohort._count.members / cohort.maxMembers * 100)
              : null;
            return (
              <Link
                key={cohort.id}
                href={`/x/cohorts/${cohort.id}`}
                className="co-card-link"
              >
                <div className="co-card">
                  {/* Card Header */}
                  <div className="co-card-header">
                    <div>
                      <h3 className="co-card-name">{cohort.name}</h3>
                      {cohort.description && (
                        <p className="co-card-desc">
                          {cohort.description.length > 80
                            ? cohort.description.slice(0, 80) + "..."
                            : cohort.description}
                        </p>
                      )}
                    </div>
                    <span className={`hf-badge ${cohort.isActive ? "hf-badge-success" : "hf-badge-muted"}`}>
                      {cohort.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>

                  {/* Stats Row */}
                  <div className="co-stats">
                    <div className="co-stat-item">
                      <Users size={14} />
                      <span className="co-stat-value">{cohort._count.members}</span>
                      <span className="co-stat-max">/ {cohort.maxMembers}</span>
                    </div>
                  </div>

                  {/* Fill rate bar */}
                  {fillPct !== null && (
                    <div className="co-fill-bar">
                      <div className="co-fill-bar-track">
                        <div
                          className="co-fill-bar-fill"
                          style={{ width: `${Math.min(fillPct, 100)}%` }}
                        />
                      </div>
                      <div className="co-fill-bar-label">{fillPct}% capacity</div>
                    </div>
                  )}

                  {/* Footer */}
                  <div className="co-card-footer">
                    <DomainPill label={cohort.domain.name} size="compact" />
                    <span className="co-owner-label">
                      Owner: {cohort.owner.name}
                    </span>
                  </div>

                  {/* Delete action */}
                  {isOperator && (
                    <div
                      className="co-delete-area"
                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
                    >
                      {confirmDeleteId === cohort.id ? (
                        <div className="co-delete-confirm">
                          <span className="co-delete-warning">
                            Permanently delete this cohort?
                          </span>
                          <button
                            onClick={() => handleDelete(cohort.id)}
                            disabled={deleting}
                            className="hf-btn hf-btn-destructive"
                          >
                            {deleting ? "..." : "Yes, delete"}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="hf-btn hf-btn-secondary"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(cohort.id)}
                          className="hf-btn-ghost co-delete-btn"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <CreateCohortModal
          domains={domains}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            refetch();
          }}
        />
      )}
    </div>
  );
}

// ==============================
// Create Cohort Modal
// ==============================

function CreateCohortModal({
  domains,
  onClose,
  onCreated,
}: {
  domains: Domain[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [domainId, setDomainId] = useState(domains[0]?.id || "");
  const [ownerSearch, setOwnerSearch] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const { data: ownerResults, loading: searchingOwners } = useApi<{
    callers: { id: string; name: string; role: string }[];
  }>(
    ownerSearch.length >= 2
      ? `/api/callers?role=TEACHER&limit=10&withCounts=false`
      : "",
    {
      skip: ownerSearch.length < 2,
      transform: (res) => ({
        callers: (res.callers || []).filter(
          (c: any) =>
            c.name?.toLowerCase().includes(ownerSearch.toLowerCase()) &&
            (c.role === "TEACHER" || c.role === "TUTOR")
        ),
      }),
    },
    [ownerSearch]
  );

  const handleCreate = async () => {
    if (!name.trim()) { setError("Name is required"); return; }
    if (!ownerId) { setError("Select a teacher or tutor as owner"); return; }
    if (!domainId) { setError("Select an institution"); return; }

    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/cohorts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          domainId,
          ownerId,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Failed to create cohort");
        setCreating(false);
        return;
      }
      onCreated();
    } catch (err: any) {
      setError(err.message || "Failed to create cohort");
      setCreating(false);
    }
  };

  return (
    <div
      className="hf-modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="hf-card co-modal">
        <h2 className="hf-section-title hf-mb-md">Create Cohort</h2>

        {error && (
          <div className="hf-banner hf-banner-error hf-mb-sm">{error}</div>
        )}

        {/* Name */}
        <label className="hf-label">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Year 10 Science"
          className="hf-input hf-mb-sm"
        />

        {/* Description */}
        <label className="hf-label">Description (optional)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Brief description..."
          rows={2}
          className="hf-input hf-mb-sm"
        />

        {/* Domain */}
        <label className="hf-label">Institution</label>
        <FancySelect
          value={domainId}
          onChange={setDomainId}
          searchable={false}
          style={{ marginBottom: 12, width: "100%" }}
          options={domains.map((d) => ({ value: d.id, label: d.name }))}
        />

        {/* Owner search */}
        <label className="hf-label">Owner (Teacher / Tutor)</label>
        {ownerId ? (
          <div className="co-owner-selected">
            <span className="co-owner-name">{ownerName}</span>
            <button
              onClick={() => { setOwnerId(""); setOwnerName(""); }}
              className="co-owner-change"
            >
              Change
            </button>
          </div>
        ) : (
          <>
            <input
              type="text"
              value={ownerSearch}
              onChange={(e) => setOwnerSearch(e.target.value)}
              placeholder="Search teachers/tutors by name..."
              className="hf-input hf-mb-xs"
            />
            {ownerSearch.length >= 2 && (
              <div className="co-owner-dropdown">
                {searchingOwners ? (
                  <div className="co-owner-dropdown-empty">Searching...</div>
                ) : ownerResults?.callers.length === 0 ? (
                  <div className="co-owner-dropdown-empty">No teachers/tutors found</div>
                ) : (
                  ownerResults?.callers.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => { setOwnerId(c.id); setOwnerName(c.name); setOwnerSearch(""); }}
                      className="co-owner-option"
                    >
                      {c.name}{" "}
                      <span className="co-owner-role">({c.role})</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}

        {/* Actions */}
        <div className="hf-flex hf-gap-sm hf-mt-md">
          <button onClick={onClose} className="hf-btn hf-btn-secondary">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="hf-btn hf-btn-primary"
          >
            {creating ? "Creating..." : "Create Cohort"}
          </button>
        </div>
      </div>
    </div>
  );
}
