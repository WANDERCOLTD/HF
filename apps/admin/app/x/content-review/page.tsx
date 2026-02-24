"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { AdvancedBanner } from "@/components/shared/AdvancedBanner";
import { RefreshCw, AlertTriangle } from "lucide-react";
import "./content-review.css";

type ContentSource = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  trustLevel: string;
  publisherOrg: string | null;
  accreditingBody: string | null;
  qualificationRef: string | null;
  validFrom: string | null;
  validUntil: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  verificationNotes: string | null;
  isActive: boolean;
  createdAt: string;
  _count: { assertions: number };
};

type DirtySpec = {
  id: string;
  slug: string;
  name: string;
  dirtyReason: string | null;
  assertionCount: number;
  moduleCount: number;
  generatedAt: string | null;
  updatedAt: string;
  domainId: string | null;
  domainName: string | null;
};

type ErrorTask = {
  id: string;
  sourceId: string | null;
  sourceName: string;
  error: string | null;
  createdAt: string;
};

const TRUST_LEVELS = [
  { value: "REGULATORY_STANDARD", label: "L5 Regulatory Standard", color: "var(--trust-l5-text)", bg: "var(--trust-l5-bg)", level: 5 },
  { value: "ACCREDITED_MATERIAL", label: "L4 Accredited Material", color: "var(--trust-l4-text)", bg: "var(--trust-l4-bg)", level: 4 },
  { value: "PUBLISHED_REFERENCE", label: "L3 Published Reference", color: "var(--trust-l3-text)", bg: "var(--trust-l3-bg)", level: 3 },
  { value: "EXPERT_CURATED", label: "L2 Expert Curated", color: "var(--trust-l2-text)", bg: "var(--trust-l2-bg)", level: 2 },
  { value: "AI_ASSISTED", label: "L1 AI Assisted", color: "var(--trust-l1-text)", bg: "var(--trust-l1-bg)", level: 1 },
  { value: "UNVERIFIED", label: "L0 Unverified", color: "var(--trust-l0-text)", bg: "var(--trust-l0-bg)", level: 0 },
];

function TrustBadge({ level }: { level: string }) {
  const config = TRUST_LEVELS.find((t) => t.value === level) || TRUST_LEVELS[5];
  return (
    <span
      className="cr-trust-badge"
      style={{
        color: config.color,
        backgroundColor: config.bg,
        border: `1px solid color-mix(in srgb, ${config.color} 20%, transparent)`,
      }}
    >
      {config.label}
    </span>
  );
}

function FreshnessBadge({ validUntil }: { validUntil: string | null }) {
  if (!validUntil) return <span className="cr-freshness-none">No expiry</span>;
  const days = Math.floor((new Date(validUntil).getTime() - Date.now()) / 86400000);
  if (days < 0) {
    return <span className="cr-freshness-expired">Expired {Math.abs(days)}d ago</span>;
  }
  if (days <= 60) {
    return <span className="cr-freshness-expiring">Expires in {days}d</span>;
  }
  return <span className="cr-freshness-valid">Valid until {new Date(validUntil).toLocaleDateString()}</span>;
}

type ReviewTab = "needs-review" | "curriculum-outdated" | "errors" | "expired" | "all";

export default function ContentReviewPage() {
  const [sources, setSources] = useState<ContentSource[]>([]);
  const [dirtySpecs, setDirtySpecs] = useState<DirtySpec[]>([]);
  const [errorTasks, setErrorTasks] = useState<ErrorTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ReviewTab>("needs-review");

  // Promotion modal
  const [promotingSource, setPromotingSource] = useState<ContentSource | null>(null);
  const [newTrustLevel, setNewTrustLevel] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Regenerating state
  const [regeneratingSpecId, setRegeneratingSpecId] = useState<string | null>(null);

  const fetchSources = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/content-sources?activeOnly=false").then((r) => r.json()),
      fetch("/api/content-review/items").then((r) => r.json()),
    ]).then(([sourceData, itemData]) => {
      if (sourceData.sources) setSources(sourceData.sources);
      if (itemData.ok) {
        setDirtySpecs(itemData.dirtySpecs || []);
        setErrorTasks(itemData.errorTasks || []);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  // Filter sources by tab
  const now = Date.now();
  const needsReview = sources.filter((s) => {
    const level = TRUST_LEVELS.find((t) => t.value === s.trustLevel);
    return level && level.level <= 1; // L0, L1
  });

  const expired = sources.filter((s) => {
    if (!s.validUntil) return false;
    const days = Math.floor((new Date(s.validUntil).getTime() - now) / 86400000);
    return days < 0 || days <= 60;
  });

  const displayed = activeTab === "needs-review" ? needsReview : activeTab === "expired" ? expired : activeTab === "all" ? sources : [];

  const handlePromote = async () => {
    if (!promotingSource || !newTrustLevel || !notes.trim()) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch(`/api/content-sources/${promotingSource.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trustLevel: newTrustLevel, verificationNotes: notes }),
      });
      const data = await res.json();
      if (data.ok) {
        setSaveMessage({ type: "success", text: `Trust level updated to ${newTrustLevel}` });
        setPromotingSource(null);
        setNewTrustLevel("");
        setNotes("");
        fetchSources();
      } else {
        setSaveMessage({ type: "error", text: data.error || "Failed to update" });
      }
    } catch (err: unknown) {
      setSaveMessage({ type: "error", text: err instanceof Error ? err.message : "Update failed" });
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerateSpec = async (spec: DirtySpec) => {
    if (!spec.domainId) {
      setSaveMessage({ type: "error", text: "Cannot regenerate: no domain linked to this curriculum" });
      return;
    }
    setRegeneratingSpecId(spec.id);
    try {
      const res = await fetch(`/api/domains/${spec.domainId}/generate-content-spec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerate: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Regeneration failed");

      const result = data.result || data;
      setSaveMessage({ type: "success", text: `${spec.name} regenerated with ${result.moduleCount || 0} modules` });
      fetchSources();
    } catch (err: unknown) {
      setSaveMessage({ type: "error", text: err instanceof Error ? err.message : "Regeneration failed" });
    } finally {
      setRegeneratingSpecId(null);
    }
  };

  const isDisabled = !newTrustLevel || !notes.trim() || saving;

  // Action-required count for sidebar signal
  const actionCount = needsReview.length + dirtySpecs.length + errorTasks.length;

  const TABS: { key: ReviewTab; label: string; count: number }[] = [
    { key: "needs-review", label: "Needs Review", count: needsReview.length },
    { key: "curriculum-outdated", label: "Curriculum Outdated", count: dirtySpecs.length },
    { key: "errors", label: "Extraction Errors", count: errorTasks.length },
    { key: "expired", label: "Expired/Expiring", count: expired.length },
    { key: "all", label: "All Materials", count: sources.length },
  ];

  return (
    <div>
      <AdvancedBanner />
      {/* Header */}
      <div className="cr-header">
        <div className="hf-flex hf-items-center hf-flex-between">
          <div>
            <h1 className="hf-page-title" style={{ fontSize: 18 }}>
              Content Review Queue
            </h1>
            <p className="hf-page-subtitle" style={{ fontSize: 12, margin: "4px 0 0" }}>
              Review materials, update curricula, and resolve extraction issues.
            </p>
          </div>
          <Link href="/x/content-sources" className="hf-btn hf-btn-secondary" style={{ fontSize: 12, padding: "6px 12px" }}>
            Material Registry
          </Link>
        </div>
      </div>

      {/* Summary cards */}
      <div className="cr-summary-row">
        <div className={`cr-stat-card ${needsReview.length > 0 ? "cr-stat-card-error" : "cr-stat-card-default"}`}>
          <div className={`cr-stat-value ${needsReview.length > 0 ? "cr-stat-value-error" : ""}`}>
            {needsReview.length}
          </div>
          <div className={`cr-stat-label ${needsReview.length > 0 ? "cr-stat-label-error" : ""}`}>
            Needs Review (L0/L1)
          </div>
        </div>
        <div className={`cr-stat-card ${dirtySpecs.length > 0 ? "cr-stat-card-warning" : "cr-stat-card-default"}`}>
          <div className={`cr-stat-value ${dirtySpecs.length > 0 ? "cr-stat-value-warning" : ""}`}>
            {dirtySpecs.length}
          </div>
          <div className={`cr-stat-label ${dirtySpecs.length > 0 ? "cr-stat-label-warning" : ""}`}>
            Curriculum Outdated
          </div>
        </div>
        <div className={`cr-stat-card ${errorTasks.length > 0 ? "cr-stat-card-error" : "cr-stat-card-default"}`}>
          <div className={`cr-stat-value ${errorTasks.length > 0 ? "cr-stat-value-error" : ""}`}>
            {errorTasks.length}
          </div>
          <div className={`cr-stat-label ${errorTasks.length > 0 ? "cr-stat-label-error" : ""}`}>
            Extraction Errors
          </div>
        </div>
        <div className="cr-stat-card cr-stat-card-default">
          <div className="cr-stat-value">{sources.length}</div>
          <div className="cr-stat-label">Total Materials</div>
        </div>
      </div>

      {/* Success/Error banner */}
      {saveMessage && (
        <div className={`hf-banner ${saveMessage.type === "success" ? "hf-banner-success" : "hf-banner-error"}`} style={{ marginBottom: 12 }}>
          {saveMessage.text}
        </div>
      )}

      {/* Tabs */}
      <div className="cr-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`cr-tab ${activeTab === tab.key ? "cr-tab-active" : "cr-tab-inactive"}`}
          >
            {tab.label}
            {tab.count > 0 ? ` (${tab.count})` : ""}
          </button>
        ))}
      </div>

      {/* ── Tab Content: Sources (needs-review / expired / all) ── */}
      {(activeTab === "needs-review" || activeTab === "expired" || activeTab === "all") && (
        <div className="cr-list">
          {loading ? (
            <div className="cr-loading">Loading...</div>
          ) : displayed.length === 0 ? (
            <div className="cr-empty">
              <div className="cr-empty-icon">
                {activeTab === "needs-review" ? "\u2705" : activeTab === "expired" ? "\u2705" : "\u2728"}
              </div>
              <div className="cr-empty-title">
                {activeTab === "needs-review"
                  ? "No materials need review"
                  : activeTab === "expired"
                  ? "No expired materials"
                  : "No materials yet"}
              </div>
              <div className="cr-empty-hint">
                {activeTab === "all" && (
                  <Link href="/x/content-sources" className="cr-link-accent">
                    Add materials in the registry
                  </Link>
                )}
              </div>
            </div>
          ) : (
            displayed.map((source) => (
              <div key={source.id} className="cr-source-row">
                <div className="cr-source-info">
                  <div className="cr-source-name-row">
                    <Link href={`/x/content-sources/${source.id}`} className="cr-source-name cr-link-accent">
                      {source.name}
                    </Link>
                    <TrustBadge level={source.trustLevel} />
                    <FreshnessBadge validUntil={source.validUntil} />
                  </div>
                  <div className="cr-source-meta">
                    <span className="cr-source-slug">{source.slug}</span>
                    {source.publisherOrg && <span>{source.publisherOrg}</span>}
                    {source.qualificationRef && <span>{source.qualificationRef}</span>}
                    {source._count.assertions > 0 && (
                      <span>{source._count.assertions} assertions</span>
                    )}
                  </div>
                  {source.verifiedAt && (
                    <div className="cr-source-verified">
                      Verified {new Date(source.verifiedAt).toLocaleDateString()}
                      {source.verificationNotes && ` — ${source.verificationNotes.substring(0, 80)}${source.verificationNotes.length > 80 ? "..." : ""}`}
                    </div>
                  )}
                </div>
                <div className="cr-actions">
                  <button
                    onClick={() => {
                      setPromotingSource(source);
                      const currentLevel = TRUST_LEVELS.find((t) => t.value === source.trustLevel);
                      const nextUp = TRUST_LEVELS.find((t) => t.level === (currentLevel?.level || 0) + 1);
                      setNewTrustLevel(nextUp?.value || "");
                      setNotes("");
                      setSaveMessage(null);
                    }}
                    className="cr-btn-review"
                  >
                    Review
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Tab Content: Curriculum Outdated ── */}
      {activeTab === "curriculum-outdated" && (
        <div className="cr-list">
          {loading ? (
            <div className="cr-loading">Loading...</div>
          ) : dirtySpecs.length === 0 ? (
            <div className="cr-empty">
              <div className="cr-empty-icon">{"\u2705"}</div>
              <div className="cr-empty-title">All curricula are up to date</div>
              <div className="cr-empty-hint">
                Curricula are marked outdated when new teaching points are extracted after generation.
              </div>
            </div>
          ) : (
            dirtySpecs.map((spec) => (
              <div key={spec.id} className="cr-source-row">
                <div className="cr-source-info">
                  <div className="cr-source-name-row">
                    <span className="cr-source-name">{spec.name}</span>
                    <span className="cr-freshness-expiring">Outdated</span>
                  </div>
                  <div className="cr-source-meta">
                    {spec.domainName && <span>{spec.domainName}</span>}
                    <span>{spec.moduleCount} modules</span>
                    <span>{spec.assertionCount} teaching points at generation</span>
                  </div>
                  {spec.dirtyReason && (
                    <div className="cr-source-verified">{spec.dirtyReason}</div>
                  )}
                </div>
                <div className="cr-actions">
                  <button
                    onClick={() => handleRegenerateSpec(spec)}
                    disabled={regeneratingSpecId === spec.id}
                    className="hf-btn hf-btn-primary"
                    style={{ padding: "4px 12px", fontSize: 11, fontWeight: 600 }}
                  >
                    {regeneratingSpecId === spec.id ? (
                      <>
                        <RefreshCw style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />
                        Regenerating...
                      </>
                    ) : (
                      <>
                        <RefreshCw style={{ width: 12, height: 12 }} />
                        Regenerate
                      </>
                    )}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Tab Content: Extraction Errors ── */}
      {activeTab === "errors" && (
        <div className="cr-list">
          {loading ? (
            <div className="cr-loading">Loading...</div>
          ) : errorTasks.length === 0 ? (
            <div className="cr-empty">
              <div className="cr-empty-icon">{"\u2705"}</div>
              <div className="cr-empty-title">No extraction errors</div>
              <div className="cr-empty-hint">
                Failed extractions from the last 7 days appear here.
              </div>
            </div>
          ) : (
            errorTasks.map((task) => (
              <div key={task.id} className="cr-source-row">
                <div className="cr-source-info">
                  <div className="cr-source-name-row">
                    {task.sourceId ? (
                      <Link href={`/x/content-sources/${task.sourceId}`} className="cr-source-name cr-link-accent">
                        {task.sourceName}
                      </Link>
                    ) : (
                      <span className="cr-source-name">{task.sourceName}</span>
                    )}
                    <span className="cr-freshness-expired">
                      <AlertTriangle style={{ width: 10, height: 10, display: "inline", verticalAlign: "middle" }} /> Failed
                    </span>
                  </div>
                  <div className="cr-source-meta">
                    <span>{new Date(task.createdAt).toLocaleDateString()}</span>
                    {task.error && (
                      <span style={{ color: "var(--status-error-text)" }}>
                        {task.error.substring(0, 100)}{task.error.length > 100 ? "..." : ""}
                      </span>
                    )}
                  </div>
                </div>
                <div className="cr-actions">
                  {task.sourceId && (
                    <Link
                      href={`/x/content-sources/${task.sourceId}`}
                      className="hf-btn hf-btn-secondary"
                      style={{ padding: "4px 10px", fontSize: 11, textDecoration: "none" }}
                    >
                      View Source
                    </Link>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Promotion Modal */}
      {promotingSource && (
        <div
          className="hf-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPromotingSource(null);
          }}
        >
          <div className="cr-modal-content">
            <h2 className="cr-modal-title">Review Material</h2>
            <p className="cr-modal-desc">
              Verify and update trust level for this material.
            </p>

            <div className="cr-detail-card">
              <div className="cr-detail-name">{promotingSource.name}</div>
              <div className="cr-detail-meta-row">
                <span className="cr-detail-slug">{promotingSource.slug}</span>
                <TrustBadge level={promotingSource.trustLevel} />
              </div>
              {promotingSource.publisherOrg && (
                <div className="cr-detail-field">Publisher: {promotingSource.publisherOrg}</div>
              )}
              {promotingSource.qualificationRef && (
                <div className="cr-detail-field">Qualification: {promotingSource.qualificationRef}</div>
              )}
              <FreshnessBadge validUntil={promotingSource.validUntil} />
            </div>

            <div className="cr-field">
              <label className="hf-label">New Trust Level</label>
              <select
                value={newTrustLevel}
                onChange={(e) => setNewTrustLevel(e.target.value)}
                className="hf-input"
              >
                <option value="">Select trust level...</option>
                {TRUST_LEVELS.map((tl) => (
                  <option
                    key={tl.value}
                    value={tl.value}
                    disabled={tl.value === promotingSource.trustLevel}
                  >
                    {tl.label} {tl.value === promotingSource.trustLevel ? "(current)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="cr-field-lg">
              <label className="hf-label">Verification Notes *</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Describe why this trust level is appropriate. E.g., 'Verified against CII accreditation register - qualification R04 confirmed active for 2025/26 academic year.'"
                className="hf-input"
                style={{ minHeight: 80, resize: "vertical" }}
              />
              <div className="cr-field-hint">
                Required. Explain how you verified this source against the original material.
              </div>
            </div>

            {saveMessage?.type === "error" && (
              <div className="hf-banner hf-banner-error" style={{ marginBottom: 12, fontSize: 11 }}>
                {saveMessage.text}
              </div>
            )}

            <div className="cr-modal-actions">
              <button
                onClick={() => setPromotingSource(null)}
                className="hf-btn hf-btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handlePromote}
                disabled={isDisabled}
                className="hf-btn hf-btn-primary"
              >
                {saving ? "Saving..." : "Update Trust Level"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
