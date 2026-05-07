"use client";

import "./roster.css";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Search, ChevronUp, ChevronDown } from "lucide-react";
import { useTerminology } from "@/contexts/TerminologyContext";
import { useRosterData, type RosterFilters } from "./useRosterData";
import { RosterSummary } from "./RosterSummary";
import { RosterRow } from "./RosterRow";
import type { TriageCategory } from "@/lib/caller-utils";

type CallerRosterProps = {
  routePrefix?: string;
  institutionId?: string | null;
};

// ─── Filter Config ──────────────────────────────────────────

type FilterDef = { key: TriageCategory | "all" | "in_call"; label: string; icon: string };

const FILTER_DEFS: FilterDef[] = [
  { key: "all", label: "All", icon: "" },
  { key: "attention", label: "Attention", icon: "⚠" },
  { key: "advancing", label: "Advancing", icon: "✅" },
  { key: "active", label: "Active", icon: "📈" },
  { key: "inactive", label: "Inactive", icon: "⏸" },
  { key: "in_call", label: "In Call", icon: "📞" },
];

// ─── Section Headers ────────────────────────────────────────

type SectionConfig = { key: TriageCategory; label: string; icon: string; className: string };

const SECTIONS: SectionConfig[] = [
  { key: "attention", label: "Needs Attention", icon: "⚠", className: "ros-section-attention" },
  { key: "advancing", label: "Ready to Advance", icon: "✅", className: "ros-section-advancing" },
  { key: "active", label: "Active", icon: "→", className: "ros-section-active" },
  { key: "inactive", label: "Inactive", icon: "⏸", className: "ros-section-inactive" },
  { key: "new", label: "Not Started", icon: "🆕", className: "ros-section-new" },
];

// ─── Sort Columns ───────────────────────────────────────────

type SortKey = RosterFilters["sortKey"];

const SORTABLE_COLS: { key: SortKey; label: string }[] = [
  { key: "triage", label: "Priority" },
  { key: "name", label: "Name" },
  { key: "mastery", label: "Progress" },
  { key: "calls", label: "Calls" },
  { key: "lastCall", label: "Last Call" },
];

// ─── Main Component ─────────────────────────────────────────

export function CallerRoster({ routePrefix = "/x", institutionId }: CallerRosterProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const { plural, lowerPlural } = useTerminology();
  const role = session?.user?.role;
  const isAdmin = role === "SUPERADMIN" || role === "ADMIN" || role === "SUPER_TESTER";

  const {
    roster,
    activeCalls,
    summary,
    classrooms,
    filters,
    setFilters,
    loading,
    error,
  } = useRosterData(institutionId);

  const callerLabel = plural("caller");
  const sessionLabel = plural("session_short") || "Lessons";

  const updateFilter = <K extends keyof RosterFilters>(key: K, value: RosterFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const toggleSort = (key: SortKey) => {
    setFilters((prev) => ({
      ...prev,
      sortKey: key,
      sortDir: prev.sortKey === key ? (prev.sortDir === "asc" ? "desc" : "asc") : "asc",
    }));
  };

  const filterCounts: Record<string, number> = {
    all: summary.total,
    attention: summary.attention,
    advancing: summary.advancing,
    active: summary.active,
    inactive: summary.inactive + summary.newCount,
    in_call: summary.inCall,
  };

  const handleNavigate = (callerId: string) => {
    // Deep-link to the AI Call tab so educators land on the actionable
    // chat/call surface, not the read-only overview.
    router.push(`${routePrefix}/callers/${callerId}?tab=ai-call`);
  };

  const handleObserve = (callId: string) => {
    router.push(`${routePrefix}/educator/observe/${callId}`);
  };

  const handleAction = (action: string, callerId: string) => {
    // These open the existing admin modals — for now, navigate to old page
    // TODO: Inline modals in Phase 2
    router.push(`${routePrefix}/callers/${callerId}?action=${action}`);
  };

  // ─── Group roster by triage when sorted by triage ─────────
  const showSections = filters.sortKey === "triage" && filters.triageFilter === "all";

  // ─── Render ───────────────────────────────────────────────

  return (
    <div className="hf-page-container">
      {/* Header */}
      <div className="hf-flex-between hf-items-start hf-mb-md">
        <div>
          <h1 className="hf-page-title">{callerLabel}</h1>
          <p className="hf-page-subtitle">
            {summary.total} {summary.total !== 1 ? lowerPlural("caller") : callerLabel.toLowerCase()}
            {summary.avgMastery !== null && (
              <> &middot; {Math.round(summary.avgMastery * 100)}% avg mastery</>
            )}
            {summary.attention > 0 && (
              <> &middot; {summary.attention} need attention</>
            )}
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <RosterSummary summary={summary} callerLabel={callerLabel} />

      {/* Toolbar: Search + Filters */}
      <div className="ros-toolbar">
        <div className="hf-input-icon-wrap">
          <Search size={14} className="hf-input-icon" />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => updateFilter("search", e.target.value)}
            placeholder={`Search ${lowerPlural("caller")}...`}
            className="hf-input ros-search"
          />
        </div>

        {/* Triage filter pills */}
        {FILTER_DEFS.map((f) => {
          const count = filterCounts[f.key] || 0;
          if (f.key !== "all" && count === 0) return null;
          return (
            <button
              key={f.key}
              className={`hf-filter-pill${filters.triageFilter === f.key ? " hf-filter-pill-active" : ""}`}
              onClick={() => updateFilter("triageFilter", f.key)}
            >
              {f.icon && <span>{f.icon}</span>} {f.label}
              <span className="ros-filter-count">{count}</span>
            </button>
          );
        })}

        {/* Classroom filter */}
        {classrooms.length > 1 && (
          <>
            <span className="hf-divider-v" />
            <select
              value={filters.classroomFilter}
              onChange={(e) => updateFilter("classroomFilter", e.target.value)}
              className="hf-filter-pill ros-classroom-select"
            >
              <option value="all">All classrooms</option>
              {classrooms.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="hf-banner hf-banner-error hf-mb-md">{error}</div>
      )}

      {/* Loading skeleton */}
      {loading ? (
        <div className="ros-table">
          <div className="ros-header">
            <span>Name</span>
            <span>Group</span>
            <span className="ros-col-subject">Subject</span>
            <span>Progress</span>
            <span className="ros-col-assessment">Assessment</span>
            <span>Momentum</span>
            <span>Last</span>
            <span />
          </div>
          {[...Array(5)].map((_, i) => (
            <div key={i} className="ros-skeleton-row">
              <div>
                <div className="ros-skeleton-cell" />
                <div className="ros-skeleton-cell ros-skeleton-cell-sm" />
              </div>
              <div className="ros-skeleton-cell" />
              <div className="ros-skeleton-cell" />
              <div className="ros-skeleton-cell" />
              <div className="ros-skeleton-cell" />
              <div className="ros-skeleton-cell" />
              <div />
            </div>
          ))}
        </div>
      ) : roster.length === 0 ? (
        /* Empty state */
        <div className="ros-table">
          <div className="ros-empty">
            <div className="ros-empty-icon">👥</div>
            <div className="ros-empty-title">
              {filters.search || filters.triageFilter !== "all" || filters.classroomFilter !== "all"
                ? `No ${lowerPlural("caller")} match your filters`
                : `No ${lowerPlural("caller")} yet`}
            </div>
            <div className="ros-empty-desc">
              {filters.search || filters.triageFilter !== "all" || filters.classroomFilter !== "all"
                ? "Try different filters or clear your search."
                : `${callerLabel} will appear here when they join your ${lowerPlural("cohort")}.`}
            </div>
            {(filters.search || filters.triageFilter !== "all" || filters.classroomFilter !== "all") && (
              <div className="ros-empty-actions">
                <button
                  className="hf-btn hf-btn-secondary"
                  onClick={() => setFilters((prev) => ({
                    ...prev,
                    search: "",
                    triageFilter: "all",
                    classroomFilter: "all",
                  }))}
                >
                  Clear filters
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Table */
        <div className="ros-table">
          {/* Header */}
          <div className="ros-header">
            {SORTABLE_COLS.map((col) => (
              <span
                key={col.key}
                className={`ros-header-sortable${filters.sortKey === col.key ? " ros-header-active" : ""}${col.key === "mastery" ? "" : ""}`}
                onClick={() => toggleSort(col.key)}
              >
                {col.label === "Priority" ? "Name" : col.label}
                {filters.sortKey === col.key && (
                  filters.sortDir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                )}
              </span>
            ))}
            <span className="ros-col-subject ros-header-sortable" onClick={() => toggleSort("mastery")}>
              Subject
            </span>
            <span className="ros-col-assessment">Assessment</span>
            <span />
          </div>

          {/* Rows — optionally grouped by triage */}
          {showSections ? (
            SECTIONS.map((section) => {
              const sectionCallers = roster.filter((c) => c.triage === section.key);
              if (sectionCallers.length === 0) return null;
              return (
                <div key={section.key}>
                  <div className={`ros-section-header ${section.className}`}>
                    <span className="ros-section-icon">{section.icon}</span>
                    {section.label}
                    <span className="ros-section-count">{sectionCallers.length}</span>
                  </div>
                  {sectionCallers.map((caller) => (
                    <RosterRow
                      key={caller.id}
                      caller={caller}
                      inCallId={activeCalls.get(caller.id)}
                      isAdmin={isAdmin}
                      routePrefix={routePrefix}
                      groupLabel={plural("cohort")}
                      sessionLabel={sessionLabel}
                      onNavigate={handleNavigate}
                      onObserve={handleObserve}
                      onAction={handleAction}
                    />
                  ))}
                </div>
              );
            })
          ) : (
            roster.map((caller) => (
              <RosterRow
                key={caller.id}
                caller={caller}
                inCallId={activeCalls.get(caller.id)}
                isAdmin={isAdmin}
                routePrefix={routePrefix}
                groupLabel={plural("cohort")}
                sessionLabel={sessionLabel}
                onNavigate={handleNavigate}
                onObserve={handleObserve}
                onAction={handleAction}
              />
            ))
          )}

          {/* Footer */}
          <div className="ros-footer">
            Showing {roster.length} of {summary.total} {lowerPlural("caller")}
          </div>
        </div>
      )}
    </div>
  );
}
