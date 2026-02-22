"use client";

import { useState, useMemo } from "react";
import { useApi } from "@/hooks/useApi";
import { FancySelect } from "@/components/shared/FancySelect";
import { UnifiedAssistantPanel } from "@/components/shared/UnifiedAssistantPanel";
import { useAssistant, useAssistantKeyboardShortcut } from "@/hooks/useAssistant";
import { useTerminology } from "@/contexts/TerminologyContext";
import "./dictionary.css";

// ── Types matching /api/data-dictionary/parameters response ──

type SpecRef = {
  id: string;
  slug: string;
  name: string;
  outputType: string;
  scope: string;
  domain: string | null;
  isActive: boolean;
  actionCount: number;
  triggers: string[];
};

type PlaybookRef = {
  id: string;
  name: string;
  status: string;
  domain: { id: string; name: string; slug: string } | null;
};

type PromptSlugRef = {
  id: string;
  slug: string;
  name: string;
  memoryCategory: string | null;
  memoryMode: string | null;
  weight: number | null;
  mode: string | null;
  rangeCount: number;
};

type BehaviorTargetRef = {
  id: string;
  scope: string;
  targetValue: number;
  confidence: number | null;
  source: string;
  playbook: { id: string; name: string } | null;
};

type ScoringAnchorRef = {
  id: string;
  score: number;
  example: string | null;
  rationale: string | null;
  isGold: boolean;
};

type EnrichedParameter = {
  id: string;
  parameterId: string;
  name: string;
  domainGroup: string | null;
  definition: string | null;
  isActive: boolean;
  specs: SpecRef[];
  playbooks: PlaybookRef[];
  promptSlugs: PromptSlugRef[];
  behaviorTargets: BehaviorTargetRef[];
  scoringAnchors: ScoringAnchorRef[];
  _counts: {
    specs: number;
    activeSpecs: number;
    playbooks: number;
    behaviorTargets: number;
    promptSlugs: number;
    scoringAnchors: number;
  };
};

type Summary = {
  total: number;
  active: number;
  withSpecs: number;
  withPlaybooks: number;
  withTargets: number;
  withAnchors: number;
  orphaned: number;
  byDomainGroup: Record<string, number>;
};

type ApiResult = {
  parameters: EnrichedParameter[];
  summary: Summary;
};

// ── Colors ──

const DOMAIN_COLORS: Record<string, string> = {
  companion: "var(--badge-purple-text)",
  communication: "var(--badge-cyan-text)",
  personality: "var(--badge-yellow-text)",
  learning: "var(--status-success-text)",
  voice: "var(--accent-primary)",
  memory: "var(--badge-pink-text)",
  math: "var(--status-warning-text)",
};

function domainColor(group: string | null): string {
  if (!group) return "var(--text-muted)";
  const key = group.toLowerCase();
  for (const [k, v] of Object.entries(DOMAIN_COLORS)) {
    if (key.includes(k)) return v;
  }
  return "var(--text-secondary)";
}

// ── Stat Card ──

function StatCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="dict-stat-card">
      <div className="dict-stat-label">{label}</div>
      <div className="dict-stat-value" style={{ color: accent || "var(--button-primary-bg)" }}>
        {value}
      </div>
    </div>
  );
}

// ── Pill Badge ──

function Pill({ label, count, color }: { label: string; count: number; color: string }) {
  if (count === 0) return null;
  return (
    <span
      className="dict-pill"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
      }}
    >
      {label}
      <span className="dict-pill-count">{count}</span>
    </span>
  );
}

// ── Relationship section in expanded detail ──

function RelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="dict-rel-section">
      <div className="dict-rel-title">{title}</div>
      {children}
    </div>
  );
}

function RelChip({ label, sub, color }: { label: string; sub?: string; color: string }) {
  return (
    <span
      className="dict-rel-chip"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 20%, transparent)`,
      }}
    >
      {label}
      {sub && (
        <span className="dict-rel-chip-sub">{sub}</span>
      )}
    </span>
  );
}

// ── Main Page ──

export default function DictionaryPage() {
  const { plural } = useTerminology();
  const [search, setSearch] = useState("");
  const [filterDomain, setFilterDomain] = useState("");
  const [showOrphans, setShowOrphans] = useState(false);
  const [showActiveOnly, setShowActiveOnly] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // AI Assistant
  const assistant = useAssistant({
    defaultTab: "chat",
    layout: "popout",
    enabledTabs: ["chat", "data"],
  });
  useAssistantKeyboardShortcut(assistant.toggle);

  const { data, loading, error } = useApi<ApiResult>(
    "/api/data-dictionary/parameters",
    {
      transform: (res) => ({
        parameters: (res.parameters as EnrichedParameter[]) || [],
        summary: (res.summary as Summary) || {
          total: 0, active: 0, withSpecs: 0, withPlaybooks: 0,
          withTargets: 0, withAnchors: 0, orphaned: 0, byDomainGroup: {},
        },
      }),
    }
  );

  const parameters = data?.parameters || [];
  const summary = data?.summary;

  // Domain group options
  const domainGroups = useMemo(() => {
    const groups = [...new Set(parameters.map((p) => p.domainGroup).filter(Boolean))] as string[];
    return groups.sort();
  }, [parameters]);

  // Filtered list
  const filtered = useMemo(() => {
    return parameters.filter((p) => {
      if (filterDomain && p.domainGroup !== filterDomain) return false;
      if (showOrphans) {
        const c = p._counts;
        if (c.specs > 0 || c.playbooks > 0 || c.behaviorTargets > 0 || c.promptSlugs > 0) return false;
      }
      if (showActiveOnly && !p.isActive) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          p.parameterId.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          (p.definition || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [parameters, filterDomain, showOrphans, showActiveOnly, search]);

  // Group by domain
  const grouped = useMemo(() => {
    const acc: Record<string, EnrichedParameter[]> = {};
    for (const p of filtered) {
      const cat = p.domainGroup || "Uncategorized";
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(p);
    }
    return acc;
  }, [filtered]);

  const totalRelationships = (p: EnrichedParameter) =>
    p._counts.specs + p._counts.playbooks + p._counts.behaviorTargets + p._counts.promptSlugs + p._counts.scoringAnchors;

  return (
    <div>
      {/* Header */}
      <div className="dict-header">
        <div>
          <h1 className="hf-page-title">Data Dictionary</h1>
          <p className="dict-subtitle">
            Parameters, cross-references, and relationships across specs and playbooks
          </p>
        </div>
        <button
          onClick={() => assistant.open(undefined, { page: "/x/dictionary" })}
          className="hf-btn-ai hf-flex-shrink-0"
          title="Ask AI Assistant (Cmd+Shift+K)"
        >
          Ask AI
        </button>
      </div>

      {/* Summary Stats */}
      {summary && !loading && (
        <div className="dict-stats-grid">
          <StatCard label="Total" value={summary.total} />
          <StatCard label="Active" value={summary.active} accent="var(--status-success-text)" />
          <StatCard label="With Specs" value={summary.withSpecs} accent="var(--accent-primary)" />
          <StatCard label={`With ${plural("playbook")}`} value={summary.withPlaybooks} accent="var(--accent-primary)" />
          <StatCard label="With Targets" value={summary.withTargets} accent="var(--badge-yellow-text)" />
          <StatCard label="Orphaned" value={summary.orphaned} accent={summary.orphaned > 0 ? "var(--status-error-text)" : "var(--text-muted)"} />
        </div>
      )}

      {/* Filters */}
      <div className="dict-filters">
        <input
          type="text"
          placeholder="Search keys, names, or definitions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="dict-search-input"
        />
        <FancySelect
          value={filterDomain}
          onChange={setFilterDomain}
          placeholder="All Institutions"
          clearable={!!filterDomain}
          searchable={domainGroups.length > 5}
          style={{ minWidth: 160 }}
          options={[
            { value: "", label: "All Institutions" },
            ...domainGroups.map((g) => ({ value: g, label: g })),
          ]}
        />
        <label className="dict-filter-label">
          <input
            type="checkbox"
            checked={showOrphans}
            onChange={(e) => setShowOrphans(e.target.checked)}
            style={{ accentColor: "var(--status-error-text)" }}
          />
          Orphans only
        </label>
        <label className="dict-filter-label">
          <input
            type="checkbox"
            checked={showActiveOnly}
            onChange={(e) => setShowActiveOnly(e.target.checked)}
            style={{ accentColor: "var(--status-success-text)" }}
          />
          Active only
        </label>
      </div>

      {/* Results count */}
      {!loading && (
        <div className="dict-results-count">
          {filtered.length} parameter{filtered.length !== 1 ? "s" : ""}
          {(search || filterDomain || showOrphans || showActiveOnly) && ` (filtered from ${parameters.length})`}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="dict-error">{error}</div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="dict-loading">Loading parameters...</div>
      ) : filtered.length === 0 ? (
        <div className="dict-empty">
          <div className="dict-empty-icon">
            {showOrphans ? "\u26A0\uFE0F" : "\uD83D\uDD0D"}
          </div>
          <div className="dict-empty-title">
            {search || filterDomain || showOrphans || showActiveOnly
              ? "No parameters match filters"
              : "No parameters found"}
          </div>
          <div className="dict-empty-desc">
            {showOrphans ? "All parameters have at least one relationship" : "Try adjusting your search or filters"}
          </div>
        </div>
      ) : (
        <div className="dict-groups">
          {Object.entries(grouped)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([category, items]) => (
              <div key={category}>
                {/* Category header */}
                <div className="dict-category-header">
                  <h2
                    className="dict-category-title"
                    style={{ color: domainColor(category === "Uncategorized" ? null : category) }}
                  >
                    {category}
                  </h2>
                  <span className="dict-category-count">
                    {items.length}
                  </span>
                </div>

                {/* Table */}
                <div className="dict-table">
                  {/* Header row */}
                  <div className="dict-table-header">
                    <div />
                    <div>Key</div>
                    <div>Name</div>
                    <div className="dict-table-header-links">Links</div>
                  </div>

                  {/* Data rows */}
                  {items.map((param) => {
                    const isExpanded = expandedId === param.id;
                    const relCount = totalRelationships(param);

                    return (
                      <div key={param.id}>
                        {/* Row */}
                        <div
                          onClick={() => setExpandedId(isExpanded ? null : param.id)}
                          className={`dict-row${isExpanded ? " dict-row-expanded" : ""}`}
                        >
                          {/* Active indicator */}
                          <div className="dict-active-cell">
                            <span
                              className={`dict-active-dot ${param.isActive ? "dict-active-dot-on" : "dict-active-dot-off"}`}
                              title={param.isActive ? "Active" : "Inactive"}
                            />
                          </div>

                          {/* Key */}
                          <div className="dict-param-key" title={`{{${param.parameterId}}}`}>
                            {"{{"}
                            {param.parameterId}
                            {"}}"}
                          </div>

                          {/* Name + definition preview */}
                          <div className="dict-name-cell">
                            <div className="dict-name">{param.name}</div>
                            {param.definition && !isExpanded && (
                              <div className="dict-definition-preview">{param.definition}</div>
                            )}
                          </div>

                          {/* Relationship pills */}
                          <div className="dict-pills">
                            <Pill label="Specs" count={param._counts.specs} color="var(--accent-primary)" />
                            <Pill label={plural("playbook")} count={param._counts.playbooks} color="var(--accent-primary)" />
                            <Pill label="Targets" count={param._counts.behaviorTargets} color="var(--badge-yellow-text)" />
                            <Pill label="Slugs" count={param._counts.promptSlugs} color="var(--badge-cyan-text)" />
                            <Pill label="Anchors" count={param._counts.scoringAnchors} color="var(--badge-purple-text)" />
                            {relCount === 0 && (
                              <span className="dict-orphan-label">orphan</span>
                            )}
                          </div>
                        </div>

                        {/* Expanded detail */}
                        {isExpanded && (
                          <div className="dict-detail">
                            {/* Definition */}
                            {param.definition && (
                              <div className="dict-definition">{param.definition}</div>
                            )}

                            {/* Specs */}
                            {param.specs.length > 0 && (
                              <RelSection title={`Specs (${param.specs.length})`}>
                                <div className="dict-rel-chips">
                                  {param.specs.map((s) => (
                                    <RelChip
                                      key={s.id}
                                      label={s.slug}
                                      sub={`${s.actionCount} action${s.actionCount !== 1 ? "s" : ""}`}
                                      color={s.isActive ? "var(--accent-primary)" : "var(--text-muted)"}
                                    />
                                  ))}
                                </div>
                              </RelSection>
                            )}

                            {/* Playbooks */}
                            {param.playbooks.length > 0 && (
                              <RelSection title={`${plural("playbook")} (${param.playbooks.length})`}>
                                <div className="dict-rel-chips">
                                  {param.playbooks.map((pb) => (
                                    <RelChip
                                      key={pb.id}
                                      label={pb.name}
                                      sub={pb.domain?.name || undefined}
                                      color="var(--accent-primary)"
                                    />
                                  ))}
                                </div>
                              </RelSection>
                            )}

                            {/* Prompt Slugs */}
                            {param.promptSlugs.length > 0 && (
                              <RelSection title={`Prompt Slugs (${param.promptSlugs.length})`}>
                                <div className="dict-rel-chips">
                                  {param.promptSlugs.map((ps) => (
                                    <RelChip
                                      key={ps.id}
                                      label={ps.slug}
                                      sub={ps.rangeCount > 0 ? `${ps.rangeCount} range${ps.rangeCount !== 1 ? "s" : ""}` : undefined}
                                      color="var(--badge-cyan-text)"
                                    />
                                  ))}
                                </div>
                              </RelSection>
                            )}

                            {/* Behavior Targets */}
                            {param.behaviorTargets.length > 0 && (
                              <RelSection title={`Behavior Targets (${param.behaviorTargets.length})`}>
                                <div className="dict-targets-grid">
                                  {param.behaviorTargets.map((bt) => (
                                    <div key={bt.id} className="dict-target-card">
                                      <div className="dict-target-value">
                                        Target: {bt.targetValue}
                                        {bt.confidence != null && (
                                          <span className="dict-target-conf">
                                            ({Math.round(bt.confidence * 100)}% conf)
                                          </span>
                                        )}
                                      </div>
                                      <div className="dict-target-meta">
                                        {bt.scope}
                                        {bt.playbook && <> &middot; {bt.playbook.name}</>}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </RelSection>
                            )}

                            {/* Scoring Anchors */}
                            {param.scoringAnchors.length > 0 && (
                              <RelSection title={`Scoring Anchors (${param.scoringAnchors.length})`}>
                                <div className="dict-anchors-list">
                                  {param.scoringAnchors.map((sa) => (
                                    <div key={sa.id} className="dict-anchor-row">
                                      <span className="dict-anchor-score">{sa.score}</span>
                                      {sa.isGold && (
                                        <span className="dict-anchor-gold">GOLD</span>
                                      )}
                                      <span className="dict-anchor-text">
                                        {sa.example || sa.rationale || "\u2014"}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </RelSection>
                            )}

                            {/* No relationships */}
                            {relCount === 0 && (
                              <div className="dict-orphan-warning">
                                Orphaned parameter — not referenced by any spec, playbook, prompt slug, or target
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>
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
