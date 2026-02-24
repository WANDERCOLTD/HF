"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { DraggableTabs, type TabDefinition } from "@/components/shared/DraggableTabs";
import { ReviewTabBadge } from "./_components/ReviewTabBadge";
import QuestionsPanel from "./_components/QuestionsPanel";
import VocabularyPanel from "./_components/VocabularyPanel";
import "./content-source-detail.css";

// ── Types ──────────────────────────────────────────────

type ContentSource = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  trustLevel: string;
  documentType: string;
  documentTypeSource: string | null;
  publisherOrg: string | null;
  accreditingBody: string | null;
  accreditationRef: string | null;
  authors: string[];
  isbn: string | null;
  edition: string | null;
  publicationYear: number | null;
  validFrom: string | null;
  validUntil: string | null;
  qualificationRef: string | null;
  isActive: boolean;
  archivedAt: string | null;
  createdAt: string;
  assertionCount: number;
  questionCount: number;
  vocabularyCount: number;
  questionReviewedCount: number;
  vocabularyReviewedCount: number;
  freshnessStatus: "valid" | "expiring" | "expired" | "unknown";
};

type UsageData = {
  subjects: Array<{ id: string; name: string; slug: string }>;
  domains: Array<{ id: string; name: string; slug: string; callerCount: number }>;
  curricula: Array<{ id: string; slug: string; name: string }>;
  totalCallerReach: number;
  contentStats: { assertions: number; questions: number; vocabulary: number; mediaAssets: number };
};

type Assertion = {
  id: string;
  assertion: string;
  category: string;
  tags: string[];
  chapter: string | null;
  section: string | null;
  pageRef: string | null;
  validFrom: string | null;
  validUntil: string | null;
  taxYear: string | null;
  examRelevance: number | null;
  learningOutcomeRef: string | null;
  depth: number | null;
  topicSlug: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  reviewer: { id: string; name: string | null; email: string } | null;
  _count: { children: number };
};

// ── Constants ──────────────────────────────────────────

const TRUST_LEVELS = [
  { value: "REGULATORY_STANDARD", label: "L5 Regulatory Standard", color: "var(--trust-l5-text)", bg: "var(--trust-l5-bg)" },
  { value: "ACCREDITED_MATERIAL", label: "L4 Accredited Material", color: "var(--trust-l4-text)", bg: "var(--trust-l4-bg)" },
  { value: "PUBLISHED_REFERENCE", label: "L3 Published Reference", color: "var(--trust-l3-text)", bg: "var(--trust-l3-bg)" },
  { value: "EXPERT_CURATED", label: "L2 Expert Curated", color: "var(--trust-l2-text)", bg: "var(--trust-l2-bg)" },
  { value: "AI_ASSISTED", label: "L1 AI Assisted", color: "var(--trust-l1-text)", bg: "var(--trust-l1-bg)" },
  { value: "UNVERIFIED", label: "L0 Unverified", color: "var(--trust-l0-text)", bg: "var(--trust-l0-bg)" },
];

const CATEGORIES = [
  // Textbook categories
  { value: "fact", label: "Fact", color: "var(--accent-primary)", icon: "\u2139\uFE0F" },
  { value: "definition", label: "Definition", color: "var(--accent-secondary, #8b5cf6)", icon: "\uD83D\uDCD6" },
  { value: "threshold", label: "Threshold", color: "var(--status-warning-text)", icon: "\uD83D\uDCCF" },
  { value: "rule", label: "Rule", color: "var(--status-error-text)", icon: "\u26A0\uFE0F" },
  { value: "process", label: "Process", color: "var(--status-success-text)", icon: "\u2699\uFE0F" },
  { value: "example", label: "Example", color: "var(--text-muted)", icon: "\uD83D\uDCC4" },
  // Worksheet categories
  { value: "question", label: "Question", color: "var(--accent-primary)", icon: "\u2753" },
  { value: "true_false", label: "True/False", color: "var(--badge-cyan-text, #0891B2)", icon: "\u2696\uFE0F" },
  { value: "matching_exercise", label: "Matching", color: "var(--accent-secondary, #8b5cf6)", icon: "\uD83D\uDD17" },
  { value: "vocabulary_exercise", label: "Vocabulary", color: "var(--badge-purple-text, #9333EA)", icon: "\uD83D\uDCDA" },
  { value: "discussion_prompt", label: "Discussion", color: "var(--badge-pink-text, #DB2777)", icon: "\uD83D\uDCAC" },
  { value: "activity", label: "Activity", color: "var(--status-success-text)", icon: "\u270D\uFE0F" },
  { value: "information", label: "Information", color: "var(--accent-primary)", icon: "\uD83D\uDCD6" },
  { value: "reference", label: "Reference", color: "var(--status-warning-text)", icon: "\uD83D\uDCD1" },
  { value: "answer_key_item", label: "Answer Key", color: "var(--status-success-text)", icon: "\uD83D\uDD11" },
  // Curriculum categories
  { value: "learning_outcome", label: "Learning Outcome", color: "var(--accent-primary)", icon: "\uD83C\uDFAF" },
  { value: "assessment_criterion", label: "Assessment Criterion", color: "var(--status-success-text)", icon: "\uD83D\uDCCB" },
  { value: "range", label: "Range/Scope", color: "var(--status-warning-text)", icon: "\uD83D\uDCCF" },
  // Assessment categories
  { value: "answer", label: "Answer", color: "var(--status-success-text)", icon: "\u2705" },
  { value: "matching_item", label: "Matching Item", color: "var(--accent-secondary, #8b5cf6)", icon: "\uD83D\uDD17" },
  { value: "misconception", label: "Misconception", color: "var(--status-error-text)", icon: "\u274C" },
  { value: "mark_scheme", label: "Mark Scheme", color: "var(--badge-orange-text, #EA580C)", icon: "\uD83D\uDCDD" },
  // Example categories
  { value: "concept", label: "Concept", color: "var(--accent-primary)", icon: "\uD83D\uDCA1" },
  { value: "observation", label: "Observation", color: "var(--status-success-text)", icon: "\uD83D\uDC41\uFE0F" },
  { value: "discussion_point", label: "Discussion Point", color: "var(--accent-secondary, #8b5cf6)", icon: "\uD83D\uDCAC" },
  { value: "context", label: "Context", color: "var(--text-muted)", icon: "\uD83D\uDCC4" },
];

const DOCUMENT_TYPES: Record<string, { label: string; icon: string }> = {
  TEXTBOOK: { label: "Textbook", icon: "\uD83D\uDCD6" },
  CURRICULUM: { label: "Curriculum", icon: "\uD83C\uDF93" },
  WORKSHEET: { label: "Worksheet", icon: "\uD83D\uDCDD" },
  COMPREHENSION: { label: "Comprehension", icon: "\uD83D\uDCDA" },
  EXAMPLE: { label: "Example", icon: "\uD83D\uDCC4" },
  ASSESSMENT: { label: "Assessment", icon: "\u2705" },
  REFERENCE: { label: "Reference", icon: "\uD83D\uDCD1" },
  LESSON_PLAN: { label: "Lesson Plan", icon: "\uD83D\uDCCB" },
  POLICY_DOCUMENT: { label: "Policy Document", icon: "\uD83C\uDFDB\uFE0F" },
};

const PAGE_SIZE = 50;

// ── Small Components ───────────────────────────────────

function TrustBadge({ level }: { level: string }) {
  const cfg = TRUST_LEVELS.find((t) => t.value === level) || TRUST_LEVELS[5];
  return (
    <span
      className="csd-trust-badge"
      style={{ color: cfg.color, backgroundColor: cfg.bg, border: `1px solid color-mix(in srgb, ${cfg.color} 20%, transparent)` }}
    >
      {cfg.label}
    </span>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const cfg = CATEGORIES.find((c) => c.value === category);
  const color = cfg?.color || "var(--text-muted)";
  const icon = cfg?.icon;
  return (
    <span
      className="csd-category-badge"
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }}
    >
      {icon && <span className="csd-category-icon">{icon}</span>}
      {cfg?.label || category}
    </span>
  );
}

/** Inline category selector — looks like a badge, click to reclassify */
function CategorySelect({
  category,
  sourceId,
  assertionId,
  onChanged,
}: {
  category: string;
  sourceId: string;
  assertionId: string;
  onChanged: (newCategory: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const cfg = CATEGORIES.find((c) => c.value === category);
  const color = cfg?.color || "var(--text-muted)";

  const handleChange = async (newCat: string) => {
    if (newCat === category || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/content-sources/${sourceId}/assertions/${assertionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: newCat }),
      });
      if (res.ok) {
        onChanged(newCat);
      }
    } catch {
      // Silent fail — badge stays unchanged
    } finally {
      setSaving(false);
    }
  };

  return (
    <select
      value={category}
      onChange={(e) => handleChange(e.target.value)}
      disabled={saving}
      className="csd-category-select"
      style={{
        color,
        backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
        borderColor: `color-mix(in srgb, ${color} 25%, transparent)`,
        opacity: saving ? 0.5 : 1,
      }}
      title="Click to reclassify"
    >
      {CATEGORIES.map((c) => (
        <option key={c.value} value={c.value}>
          {c.icon} {c.label}
        </option>
      ))}
    </select>
  );
}

function ReviewBadge({ reviewed }: { reviewed: boolean }) {
  return reviewed ? (
    <span className="csd-review-reviewed">Reviewed</span>
  ) : (
    <span className="csd-review-pending">Pending</span>
  );
}

// ── Main Page ──────────────────────────────────────────

export default function SourceDetailPage() {
  const { sourceId } = useParams<{ sourceId: string }>();
  const router = useRouter();

  // Source data
  const [source, setSource] = useState<ContentSource | null>(null);
  const [sourceLoading, setSourceLoading] = useState(true);

  // Assertions data
  const [assertions, setAssertions] = useState<Assertion[]>([]);
  const [total, setTotal] = useState(0);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [reviewProgress, setReviewProgress] = useState(0);
  const [assertionsLoading, setAssertionsLoading] = useState(true);

  // Filters + pagination
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterReview, setFilterReview] = useState("");
  const [sortBy, setSortBy] = useState("chapter");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);

  // Selection for bulk actions
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  // Expanded row + edit mode
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);

  // Error / success feedback
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState("assertions");
  const [qTotal, setQTotal] = useState(0);
  const [qReviewed, setQReviewed] = useState(0);
  const [vTotal, setVTotal] = useState(0);
  const [vReviewed, setVReviewed] = useState(0);

  // Archive + Usage state
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  // ── Fetch source detail ──
  const fetchSource = useCallback(async () => {
    try {
      const res = await fetch(`/api/content-sources/${sourceId}`);
      const data = await res.json();
      if (data.ok) setSource(data.source);
    } catch {
      // silent
    } finally {
      setSourceLoading(false);
    }
  }, [sourceId]);

  // ── Fetch assertions ──
  const fetchAssertions = useCallback(async () => {
    setAssertionsLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (filterCategory) params.set("category", filterCategory);
      if (filterReview) params.set("reviewed", filterReview);
      params.set("sortBy", sortBy);
      params.set("sortDir", sortDir);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(page * PAGE_SIZE));

      const res = await fetch(`/api/content-sources/${sourceId}/assertions?${params}`);
      const data = await res.json();
      if (data.ok) {
        setAssertions(data.assertions);
        setTotal(data.total);
        setReviewedCount(data.reviewed);
        setReviewProgress(data.reviewProgress);
      }
    } catch {
      // silent
    } finally {
      setAssertionsLoading(false);
    }
  }, [sourceId, search, filterCategory, filterReview, sortBy, sortDir, page]);

  useEffect(() => { fetchSource(); }, [fetchSource]);
  // ── Fetch usage data ──
  const fetchUsage = useCallback(async () => {
    setUsageLoading(true);
    try {
      const res = await fetch(`/api/content-sources/${sourceId}/usage`);
      const data = await res.json();
      if (data.ok) setUsageData(data.usage);
    } catch { /* ignore */ } finally {
      setUsageLoading(false);
    }
  }, [sourceId]);

  // ── Archive handler ──
  const handleArchive = async (force = false) => {
    setArchiving(true);
    try {
      const url = `/api/content-sources/${sourceId}${force ? "?force=true" : ""}`;
      const res = await fetch(url, { method: "DELETE" });
      const data = await res.json();
      if (data.ok) {
        setFeedback({ type: "success", message: "Material archived" });
        setArchiveConfirm(false);
        fetchSource();
      } else if (res.status === 409) {
        // In use — show usage and ask to force
        setUsageData(data.usage);
        setFeedback({ type: "error", message: data.error });
      } else {
        setFeedback({ type: "error", message: data.error || "Archive failed" });
      }
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message });
    } finally {
      setArchiving(false);
    }
  };

  // ── Unarchive handler ──
  const handleUnarchive = async () => {
    setArchiving(true);
    try {
      const res = await fetch(`/api/content-sources/${sourceId}/unarchive`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setFeedback({ type: "success", message: "Material restored" });
        fetchSource();
      } else {
        setFeedback({ type: "error", message: data.error || "Unarchive failed" });
      }
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message });
    } finally {
      setArchiving(false);
    }
  };

  useEffect(() => { fetchAssertions(); }, [fetchAssertions]);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [search, filterCategory, filterReview, sortBy, sortDir]);

  // Clear feedback after delay
  useEffect(() => {
    if (feedback) {
      const t = setTimeout(() => setFeedback(null), 4000);
      return () => clearTimeout(t);
    }
  }, [feedback]);

  // ── Bulk review ──
  const handleBulkReview = async () => {
    if (selected.size === 0) return;
    setBulkLoading(true);
    try {
      const res = await fetch(`/api/content-sources/${sourceId}/assertions/bulk-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assertionIds: [...selected] }),
      });
      const data = await res.json();
      if (data.ok) {
        setFeedback({ type: "success", message: `${data.updated} assertion${data.updated !== 1 ? "s" : ""} marked as reviewed` });
        setSelected(new Set());
        fetchAssertions();
      } else {
        setFeedback({ type: "error", message: data.error || "Bulk review failed" });
      }
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message });
    } finally {
      setBulkLoading(false);
    }
  };

  // ── Select all on current page ──
  const allOnPageSelected = assertions.length > 0 && assertions.every((a) => selected.has(a.id));
  const toggleSelectAll = () => {
    if (allOnPageSelected) {
      const next = new Set(selected);
      assertions.forEach((a) => next.delete(a.id));
      setSelected(next);
    } else {
      const next = new Set(selected);
      assertions.forEach((a) => next.add(a.id));
      setSelected(next);
    }
  };
  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  // ── Sort toggle ──
  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortDir("asc");
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  if (sourceLoading) {
    return <div className="csd-loading-center"><div className="hf-spinner" /></div>;
  }

  if (!source) {
    return (
      <div className="csd-error-wrap">
        <p className="csd-error-text">Material not found</p>
        <Link href="/x/content-sources" className="csd-back-link">Back to Materials</Link>
      </div>
    );
  }

  return (
    <div>
      {/* Back link */}
      <Link href="/x/content-sources" className="csd-back-nav">
        <span className="csd-back-arrow">&larr;</span> Back to Materials
      </Link>

      {/* Archived banner */}
      {source.archivedAt && (
        <div className="hf-banner hf-banner-warning csd-archived-banner">
          <span>
            This material was archived on {new Date(source.archivedAt).toLocaleDateString()}.
            It is hidden from pickers but its content remains in the knowledge base.
          </span>
          <button
            className="hf-btn hf-btn-secondary csd-flex-shrink-0"
            onClick={handleUnarchive}
            disabled={archiving}
          >
            {archiving ? "Restoring..." : "Unarchive"}
          </button>
        </div>
      )}

      {/* Source header */}
      <div className="csd-header">
        <div className="csd-header-row">
          <h1 className="hf-page-title">
            {source.name}
          </h1>
          <TrustBadge level={source.trustLevel} />
          {source.documentType && DOCUMENT_TYPES[source.documentType] && (
            <span
              title={source.documentTypeSource ? `Classified by: ${source.documentTypeSource}` : "Default"}
              className="csd-doc-type-badge"
            >
              <span className="csd-doc-type-icon">{DOCUMENT_TYPES[source.documentType].icon}</span>
              {DOCUMENT_TYPES[source.documentType].label}
              {source.documentTypeSource?.startsWith("ai:") && (
                <span className="csd-doc-type-auto">auto</span>
              )}
            </span>
          )}
          {source.archivedAt ? (
            <span className="csd-status-archived">
              Archived
            </span>
          ) : !source.isActive && (
            <span className="csd-status-inactive">
              Inactive
            </span>
          )}
        </div>
        <div className="csd-meta-row">
          <span className="csd-slug">{source.slug}</span>
          {source.publisherOrg && <span>{source.publisherOrg}</span>}
          {source.edition && <span>{source.edition}</span>}
          {source.publicationYear && <span>{source.publicationYear}</span>}
          <span>Created {new Date(source.createdAt).toLocaleDateString()}</span>
        </div>
        {source.description && (
          <p className="csd-description">
            {source.description}
          </p>
        )}

        {/* Aggregate review progress */}
        {(() => {
          const totalItems = (source.assertionCount || 0) + (qTotal || source.questionCount || 0) + (vTotal || source.vocabularyCount || 0);
          const totalReviewed = reviewedCount + (qReviewed || source.questionReviewedCount || 0) + (vReviewed || source.vocabularyReviewedCount || 0);
          const aggPct = totalItems > 0 ? Math.round((totalReviewed / totalItems) * 100) : 0;
          return (
            <div className="csd-progress-wrap">
              <div className="csd-progress-header">
                <span className="csd-progress-label">
                  Review Progress
                </span>
                <span className="csd-progress-counts">
                  {reviewedCount}/{source.assertionCount} points
                  {(source.questionCount || 0) > 0 && <> &middot; {qReviewed || source.questionReviewedCount || 0}/{qTotal || source.questionCount || 0} questions</>}
                  {(source.vocabularyCount || 0) > 0 && <> &middot; {vReviewed || source.vocabularyReviewedCount || 0}/{vTotal || source.vocabularyCount || 0} vocab</>}
                </span>
              </div>
              <div className="csd-progress-track">
                <div
                  className={`csd-progress-fill ${aggPct === 100 ? "csd-progress-fill--complete" : "csd-progress-fill--partial"}`}
                  style={{ width: `${aggPct}%` }}
                />
              </div>
            </div>
          );
        })()}
      </div>

      {/* Feedback banner */}
      {feedback && (
        <div className={`hf-banner ${feedback.type === "error" ? "hf-banner-error" : "hf-banner-success"} csd-feedback`}>
          {feedback.message}
        </div>
      )}

      {/* Tabs */}
      <DraggableTabs
        storageKey="source-detail-tabs"
        tabs={[
          {
            id: "assertions",
            label: <span>Teaching Points <ReviewTabBadge reviewed={reviewedCount} total={total} /></span>,
            count: source.assertionCount || null,
          },
          ...((source.questionCount || 0) > 0 ? [{
            id: "questions",
            label: <span>Questions <ReviewTabBadge reviewed={qReviewed || source.questionReviewedCount || 0} total={qTotal || source.questionCount || 0} /></span>,
            count: source.questionCount || null,
          }] : []),
          ...((source.vocabularyCount || 0) > 0 ? [{
            id: "vocabulary",
            label: <span>Vocabulary <ReviewTabBadge reviewed={vReviewed || source.vocabularyReviewedCount || 0} total={vTotal || source.vocabularyCount || 0} /></span>,
            count: source.vocabularyCount || null,
          }] : []),
          { id: "usage", label: "Usage", count: null },
        ] as TabDefinition[]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        containerStyle={{ marginBottom: 16 }}
      />

      {/* ── Assertions Tab ── */}
      {activeTab === "assertions" && (
        <>
          {/* Controls row */}
          <div className="csd-controls-row">
            <input
              type="text"
              placeholder="Search assertions..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="hf-input csd-search-input"
            />
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="hf-input csd-filter-select"
            >
              <option value="">All categories</option>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <select
              value={filterReview}
              onChange={(e) => setFilterReview(e.target.value)}
              className="hf-input csd-filter-select"
            >
              <option value="">All review status</option>
              <option value="true">Reviewed</option>
              <option value="false">Pending review</option>
            </select>

            {/* Bulk action */}
            {selected.size > 0 && (
              <button
                onClick={handleBulkReview}
                disabled={bulkLoading}
                className="hf-btn hf-btn-primary csd-bulk-btn"
              >
                {bulkLoading ? "Reviewing..." : `Mark ${selected.size} Reviewed`}
              </button>
            )}

            <span className="csd-total-count">
              {total} assertion{total !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Assertions table */}
          {assertionsLoading && assertions.length === 0 ? (
            <div className="csd-loading-center-sm"><div className="hf-spinner" /></div>
          ) : assertions.length === 0 ? (
            <p className="csd-empty-text">
              {search || filterCategory || filterReview ? "No assertions match your filters." : "No assertions extracted yet."}
            </p>
          ) : (
            <>
              <div className="csd-table-wrap">
                <table className="csd-table">
                  <thead>
                    <tr className="csd-thead-row">
                      <th className="csd-th csd-th--checkbox">
                        <input type="checkbox" checked={allOnPageSelected} onChange={toggleSelectAll} />
                      </th>
                      <th className="csd-th">Assertion</th>
                      <SortTh field="category" current={sortBy} dir={sortDir} onClick={handleSort}>Category</SortTh>
                      <SortTh field="chapter" current={sortBy} dir={sortDir} onClick={handleSort}>Location</SortTh>
                      <th className="csd-th csd-th--review">Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assertions.map((a) => (
                      <AssertionRow
                        key={a.id}
                        assertion={a}
                        sourceId={sourceId}
                        isSelected={selected.has(a.id)}
                        isExpanded={expandedId === a.id}
                        isEditing={editId === a.id}
                        onToggleSelect={() => toggleSelect(a.id)}
                        onToggleExpand={() => {
                          setExpandedId(expandedId === a.id ? null : a.id);
                          if (editId === a.id) setEditId(null);
                        }}
                        onStartEdit={() => setEditId(a.id)}
                        onCancelEdit={() => setEditId(null)}
                        onSaved={() => {
                          setEditId(null);
                          setFeedback({ type: "success", message: "Assertion updated" });
                          fetchAssertions();
                        }}
                        onDeleted={() => {
                          setExpandedId(null);
                          setEditId(null);
                          setFeedback({ type: "success", message: "Assertion deleted" });
                          fetchAssertions();
                        }}
                        onReviewed={() => {
                          setFeedback({ type: "success", message: "Marked as reviewed" });
                          fetchAssertions();
                        }}
                        onCategoryChanged={(assertionId, newCat) => {
                          setAssertions((prev) =>
                            prev.map((x) =>
                              x.id === assertionId ? { ...x, category: newCat } : x
                            )
                          );
                        }}
                        onError={(msg) => setFeedback({ type: "error", message: msg })}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="csd-pagination">
                  <button
                    onClick={() => setPage(Math.max(0, page - 1))}
                    disabled={page === 0}
                    className="hf-btn hf-btn-secondary csd-pagination-btn"
                  >
                    Prev
                  </button>
                  <span className="csd-pagination-text">
                    Page {page + 1} of {totalPages}
                  </span>
                  <button
                    onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                    disabled={page >= totalPages - 1}
                    className="hf-btn hf-btn-secondary csd-pagination-btn"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── Questions Tab ── */}
      {activeTab === "questions" && (
        <QuestionsPanel
          sourceId={sourceId}
          onCountChange={(t, r) => { setQTotal(t); setQReviewed(r); }}
        />
      )}

      {/* ── Vocabulary Tab ── */}
      {activeTab === "vocabulary" && (
        <VocabularyPanel
          sourceId={sourceId}
          onCountChange={(t, r) => { setVTotal(t); setVReviewed(r); }}
        />
      )}

      {/* ── Usage Tab ── */}
      {activeTab === "usage" && (
        <UsagePanel sourceId={sourceId} usage={usageData} loading={usageLoading} onLoad={fetchUsage} />
      )}

      {/* ── Danger Zone (archive / delete) ── */}
      {!source.archivedAt && (
        <div className="csd-danger-zone">
          <h3 className="csd-danger-title">
            Danger Zone
          </h3>
          <p className="csd-danger-desc">
            Archiving this material hides it from pickers and the library. Its teaching content remains
            in the knowledge base until permanently deleted by a Super Admin.
          </p>
          {!archiveConfirm ? (
            <button
              className="hf-btn hf-btn-destructive"
              onClick={() => { setArchiveConfirm(true); fetchUsage(); }}
            >
              Archive Material
            </button>
          ) : (
            <div>
              {usageLoading && <p className="csd-danger-checking">Checking usage...</p>}
              {usageData && (usageData.subjects.length > 0 || usageData.curricula.length > 0) && (
                <div className="hf-banner hf-banner-warning csd-danger-usage">
                  <strong>This material is in use:</strong>
                  {usageData.subjects.length > 0 && (
                    <span> {usageData.subjects.length} subject{usageData.subjects.length !== 1 ? "s" : ""} ({usageData.subjects.map((s) => s.name).join(", ")})</span>
                  )}
                  {usageData.curricula.length > 0 && (
                    <span> {usageData.curricula.length} curricul{usageData.curricula.length !== 1 ? "a" : "um"}</span>
                  )}
                  {usageData.totalCallerReach > 0 && (
                    <span> reaching {usageData.totalCallerReach} caller{usageData.totalCallerReach !== 1 ? "s" : ""}</span>
                  )}
                </div>
              )}
              <div className="csd-danger-actions">
                <button
                  className="hf-btn hf-btn-destructive"
                  onClick={() => handleArchive(true)}
                  disabled={archiving}
                >
                  {archiving ? "Archiving..." : "Confirm Archive"}
                </button>
                <button
                  className="hf-btn hf-btn-secondary"
                  onClick={() => setArchiveConfirm(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Usage Panel ──────────────────────────────────────────

function UsagePanel({
  sourceId,
  usage,
  loading,
  onLoad,
}: {
  sourceId: string;
  usage: UsageData | null;
  loading: boolean;
  onLoad: () => void;
}) {
  useEffect(() => {
    if (!usage) onLoad();
  }, [usage, onLoad]);

  if (loading) {
    return <div className="csd-loading-center-sm"><div className="hf-spinner" /></div>;
  }

  if (!usage) {
    return <p className="csd-empty-text--usage">No usage data available.</p>;
  }

  return (
    <div className="csd-usage-grid">
      {/* Subjects */}
      <div className="hf-card">
        <h4 className="csd-usage-section-title">Linked Subjects ({usage.subjects.length})</h4>
        {usage.subjects.length === 0 ? (
          <p className="csd-empty-text--padded">Not linked to any subjects</p>
        ) : (
          usage.subjects.map((s) => (
            <div key={s.id} className="csd-usage-row">
              <Link href={`/x/subjects?id=${s.id}`} className="csd-usage-link">
                {s.name}
              </Link>
              <span className="csd-usage-slug">{s.slug}</span>
            </div>
          ))
        )}
      </div>

      {/* Domains */}
      <div className="hf-card">
        <h4 className="csd-usage-section-title">Institutions ({usage.domains.length})</h4>
        {usage.domains.length === 0 ? (
          <p className="csd-empty-text--padded">Not used by any institutions</p>
        ) : (
          usage.domains.map((d) => (
            <div key={d.id} className="csd-usage-row">
              <Link href={`/x/domains?id=${d.id}`} className="csd-usage-link">
                {d.name}
              </Link>
              <span className="csd-usage-caller-count">
                {d.callerCount} caller{d.callerCount !== 1 ? "s" : ""}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Curricula */}
      {usage.curricula.length > 0 && (
        <div className="hf-card">
          <h4 className="csd-usage-section-title">Curricula ({usage.curricula.length})</h4>
          {usage.curricula.map((c) => (
            <div key={c.id} className="csd-usage-row">
              <span className="csd-usage-name">{c.name}</span>
              <span className="csd-usage-slug">{c.slug}</span>
            </div>
          ))}
        </div>
      )}

      {/* Content stats */}
      <div className="hf-card">
        <h4 className="csd-usage-section-title">Content</h4>
        <div className="csd-usage-row">
          <span className="csd-usage-stat-label">Teaching Points</span>
          <span className="csd-usage-stat-value">{usage.contentStats.assertions}</span>
        </div>
        <div className="csd-usage-row">
          <span className="csd-usage-stat-label">Questions</span>
          <span className="csd-usage-stat-value">{usage.contentStats.questions}</span>
        </div>
        <div className="csd-usage-row">
          <span className="csd-usage-stat-label">Vocabulary</span>
          <span className="csd-usage-stat-value">{usage.contentStats.vocabulary}</span>
        </div>
        <div className="csd-usage-row--last">
          <span className="csd-usage-stat-label">Media Assets</span>
          <span className="csd-usage-stat-value">{usage.contentStats.mediaAssets}</span>
        </div>
        {usage.totalCallerReach > 0 && (
          <div className="csd-usage-reach">
            Total caller reach: <strong>{usage.totalCallerReach}</strong>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sortable Table Header ──────────────────────────────

function SortTh({
  field,
  current,
  dir,
  onClick,
  children,
}: {
  field: string;
  current: string;
  dir: "asc" | "desc";
  onClick: (field: string) => void;
  children: React.ReactNode;
}) {
  const isActive = current === field;
  return (
    <th
      onClick={() => onClick(field)}
      className="csd-th csd-th--sortable"
    >
      {children}
      {isActive && <span className="csd-sort-indicator">{dir === "asc" ? "\u25B2" : "\u25BC"}</span>}
    </th>
  );
}


// ── Assertion Row ──────────────────────────────────────

function AssertionRow({
  assertion: a,
  sourceId,
  isSelected,
  isExpanded,
  isEditing,
  onToggleSelect,
  onToggleExpand,
  onStartEdit,
  onCancelEdit,
  onSaved,
  onDeleted,
  onReviewed,
  onCategoryChanged,
  onError,
}: {
  assertion: Assertion;
  sourceId: string;
  isSelected: boolean;
  isExpanded: boolean;
  isEditing: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  onReviewed: () => void;
  onCategoryChanged: (assertionId: string, newCat: string) => void;
  onError: (msg: string) => void;
}) {
  const isReviewed = !!a.reviewedAt;
  const truncated = a.assertion.length > 120 ? a.assertion.slice(0, 120) + "..." : a.assertion;
  const location = [a.chapter, a.section, a.pageRef].filter(Boolean).join(" / ");

  const rowClasses = [
    "csd-row",
    !isExpanded ? "csd-row--border" : "",
    isSelected ? "csd-row--selected" : isExpanded ? "csd-row--expanded" : "",
  ].filter(Boolean).join(" ");

  return (
    <>
      <tr
        onClick={(e) => {
          // Don't toggle if clicking checkbox, buttons, or select
          if ((e.target as HTMLElement).closest("input, button, select")) return;
          onToggleExpand();
        }}
        className={rowClasses}
      >
        <td className="csd-td-checkbox">
          <input type="checkbox" checked={isSelected} onChange={onToggleSelect} />
        </td>
        <td className="csd-td-assertion">
          {truncated}
          {a.tags.length > 0 && (
            <span className="csd-tags-inline">
              {a.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="csd-tag">
                  {tag}
                </span>
              ))}
              {a.tags.length > 3 && <span className="csd-tag-overflow">+{a.tags.length - 3}</span>}
            </span>
          )}
        </td>
        <td className="csd-td-default">
          <CategorySelect
            category={a.category}
            sourceId={sourceId}
            assertionId={a.id}
            onChanged={(newCat) => onCategoryChanged(a.id, newCat)}
          />
        </td>
        <td className="csd-td-location">
          {location || "-"}
        </td>
        <td className="csd-td-review">
          <ReviewBadge reviewed={isReviewed} />
        </td>
      </tr>

      {/* Expanded detail / edit */}
      {isExpanded && (
        <tr className="csd-row--border">
          <td colSpan={5} className="csd-td-expanded">
            {isEditing ? (
              <EditForm
                assertion={a}
                sourceId={sourceId}
                onSaved={onSaved}
                onCancel={onCancelEdit}
                onDeleted={onDeleted}
                onError={onError}
              />
            ) : (
              <DetailView
                assertion={a}
                sourceId={sourceId}
                onEdit={onStartEdit}
                onReviewed={onReviewed}
                onCategoryChanged={(newCat) => onCategoryChanged(a.id, newCat)}
                onError={onError}
              />
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ── Detail View (expanded, read-only) ──────────────────

function DetailView({
  assertion: a,
  sourceId,
  onEdit,
  onReviewed,
  onCategoryChanged,
  onError,
}: {
  assertion: Assertion;
  sourceId: string;
  onEdit: () => void;
  onReviewed: () => void;
  onCategoryChanged: (newCat: string) => void;
  onError: (msg: string) => void;
}) {
  const [reviewing, setReviewing] = useState(false);

  const handleMarkReviewed = async () => {
    setReviewing(true);
    try {
      const res = await fetch(`/api/content-sources/${sourceId}/assertions/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markReviewed: true }),
      });
      const data = await res.json();
      if (data.ok) {
        onReviewed();
      } else {
        onError(data.error || "Failed to mark reviewed");
      }
    } catch (err: any) {
      onError(err.message);
    } finally {
      setReviewing(false);
    }
  };

  return (
    <div className="csd-detail-wrap">
      {/* Full assertion text */}
      <div className="csd-detail-text">
        {a.assertion}
      </div>

      {/* Metadata grid */}
      <div className="csd-detail-grid">
        <div>
          <div className="csd-detail-label">Category</div>
          <CategorySelect
            category={a.category}
            sourceId={sourceId}
            assertionId={a.id}
            onChanged={onCategoryChanged}
          />
        </div>
        <div>
          <div className="csd-detail-label">Tags</div>
          <div className="csd-detail-tags">
            {a.tags.length > 0
              ? a.tags.map((t) => (
                  <span key={t} className="csd-tag--detail">
                    {t}
                  </span>
                ))
              : <span className="csd-detail-none">none</span>
            }
          </div>
        </div>
        {(a.chapter || a.section || a.pageRef) && (
          <div>
            <div className="csd-detail-label">Location</div>
            <div className="csd-detail-value">{[a.chapter, a.section, a.pageRef].filter(Boolean).join(" / ")}</div>
          </div>
        )}
        {a.taxYear && (
          <div>
            <div className="csd-detail-label">Tax Year</div>
            <div className="csd-detail-value">{a.taxYear}</div>
          </div>
        )}
        {a.examRelevance !== null && (
          <div>
            <div className="csd-detail-label">Exam Relevance</div>
            <div className="csd-detail-value">{Math.round(a.examRelevance * 100)}%</div>
          </div>
        )}
        {a.learningOutcomeRef && (
          <div>
            <div className="csd-detail-label">Learning Outcome</div>
            <div className="csd-detail-value">{a.learningOutcomeRef}</div>
          </div>
        )}
        {a.topicSlug && (
          <div>
            <div className="csd-detail-label">Topic</div>
            <div className="csd-detail-value--mono">{a.topicSlug}</div>
          </div>
        )}
        <div>
          <div className="csd-detail-label">Review Status</div>
          {a.reviewedAt ? (
            <div className="csd-detail-review-info">
              <span className="csd-detail-review-yes">Reviewed</span>
              <span className="csd-detail-review-meta">
                by {a.reviewer?.name || a.reviewer?.email || "unknown"} on {new Date(a.reviewedAt).toLocaleDateString()}
              </span>
            </div>
          ) : (
            <span className="csd-detail-review-pending">Pending</span>
          )}
        </div>
        {a._count.children > 0 && (
          <div>
            <div className="csd-detail-label">Children</div>
            <div className="csd-detail-value">{a._count.children} sub-assertions</div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="csd-detail-actions">
        <button onClick={onEdit} className="hf-btn hf-btn-secondary csd-btn-sm">Edit</button>
        {!a.reviewedAt && (
          <button
            onClick={handleMarkReviewed}
            disabled={reviewing}
            className="hf-btn hf-btn-primary csd-btn-sm csd-btn-reviewed"
          >
            {reviewing ? "..." : "Mark Reviewed"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Edit Form ──────────────────────────────────────────

function EditForm({
  assertion: a,
  sourceId,
  onSaved,
  onCancel,
  onDeleted,
  onError,
}: {
  assertion: Assertion;
  sourceId: string;
  onSaved: () => void;
  onCancel: () => void;
  onDeleted: () => void;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState({
    assertion: a.assertion,
    category: a.category,
    tags: a.tags.join(", "),
    chapter: a.chapter || "",
    section: a.section || "",
    pageRef: a.pageRef || "",
    validFrom: a.validFrom ? a.validFrom.split("T")[0] : "",
    validUntil: a.validUntil ? a.validUntil.split("T")[0] : "",
    taxYear: a.taxYear || "",
    examRelevance: a.examRelevance !== null ? String(a.examRelevance) : "",
    learningOutcomeRef: a.learningOutcomeRef || "",
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleSave = async (markReviewed = false) => {
    setSaving(true);
    try {
      const body: Record<string, any> = {
        assertion: form.assertion,
        category: form.category,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        chapter: form.chapter || null,
        section: form.section || null,
        pageRef: form.pageRef || null,
        validFrom: form.validFrom || null,
        validUntil: form.validUntil || null,
        taxYear: form.taxYear || null,
        learningOutcomeRef: form.learningOutcomeRef || null,
        examRelevance: form.examRelevance ? parseFloat(form.examRelevance) : null,
      };
      if (markReviewed) body.markReviewed = true;

      const res = await fetch(`/api/content-sources/${sourceId}/assertions/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        onSaved();
      } else {
        onError(data.error || "Save failed");
      }
    } catch (err: any) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/content-sources/${sourceId}/assertions/${a.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.ok) {
        onDeleted();
      } else {
        onError(data.error || "Delete failed");
      }
    } catch (err: any) {
      onError(err.message);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="csd-edit-wrap">
      {/* Assertion text */}
      <div className="csd-edit-field">
        <div className="csd-detail-label">Assertion Text</div>
        <textarea
          value={form.assertion}
          onChange={(e) => setForm({ ...form, assertion: e.target.value })}
          rows={3}
          className="hf-input csd-edit-textarea"
        />
      </div>

      {/* Category + Tags row */}
      <div className="csd-edit-grid-cat-tags">
        <div>
          <div className="csd-detail-label">Category</div>
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="hf-input"
          >
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <div className="csd-detail-label">Tags (comma-separated)</div>
          <input
            value={form.tags}
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
            className="hf-input"
            placeholder="tax, isa, allowance"
          />
        </div>
      </div>

      {/* Location row */}
      <div className="csd-edit-grid-location">
        <div>
          <div className="csd-detail-label">Chapter</div>
          <input value={form.chapter} onChange={(e) => setForm({ ...form, chapter: e.target.value })} className="hf-input" placeholder="Chapter 3" />
        </div>
        <div>
          <div className="csd-detail-label">Section</div>
          <input value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} className="hf-input" placeholder="3.2 ISA Allowances" />
        </div>
        <div>
          <div className="csd-detail-label">Page</div>
          <input value={form.pageRef} onChange={(e) => setForm({ ...form, pageRef: e.target.value })} className="hf-input" placeholder="p.47" />
        </div>
      </div>

      {/* Validity + exam row */}
      <div className="csd-edit-grid-validity">
        <div>
          <div className="csd-detail-label">Valid From</div>
          <input type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} className="hf-input" />
        </div>
        <div>
          <div className="csd-detail-label">Valid Until</div>
          <input type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} className="hf-input" />
        </div>
        <div>
          <div className="csd-detail-label">Tax Year</div>
          <input value={form.taxYear} onChange={(e) => setForm({ ...form, taxYear: e.target.value })} className="hf-input" placeholder="2024/25" />
        </div>
        <div>
          <div className="csd-detail-label">Exam Rel.</div>
          <input
            type="number"
            min="0"
            max="1"
            step="0.1"
            value={form.examRelevance}
            onChange={(e) => setForm({ ...form, examRelevance: e.target.value })}
            className="hf-input"
            placeholder="0.0-1.0"
          />
        </div>
        <div>
          <div className="csd-detail-label">LO Reference</div>
          <input value={form.learningOutcomeRef} onChange={(e) => setForm({ ...form, learningOutcomeRef: e.target.value })} className="hf-input" placeholder="R04-LO2-AC2.3" />
        </div>
      </div>

      {/* Actions */}
      <div className="csd-edit-actions">
        <button
          onClick={() => handleSave(false)}
          disabled={saving}
          className="hf-btn hf-btn-primary csd-btn-sm"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {!a.reviewedAt && (
          <button
            onClick={() => handleSave(true)}
            disabled={saving}
            className="hf-btn hf-btn-primary csd-btn-sm csd-btn-reviewed"
          >
            Save & Mark Reviewed
          </button>
        )}
        <button onClick={onCancel} className="hf-btn hf-btn-secondary csd-btn-sm">Cancel</button>

        {/* Delete (with confirmation) */}
        <div className="csd-edit-delete-wrap">
          {confirmDelete ? (
            <span className="csd-delete-confirm">
              <span className="csd-delete-warning">
                {a._count.children > 0 ? `Has ${a._count.children} children` : "Delete permanently?"}
              </span>
              {a._count.children === 0 && (
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="hf-btn hf-btn-destructive csd-btn-sm--xs"
                >
                  {deleting ? "..." : "Confirm"}
                </button>
              )}
              <button
                onClick={() => setConfirmDelete(false)}
                className="hf-btn hf-btn-secondary csd-btn-sm--xs"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="hf-btn hf-btn-secondary csd-btn-sm csd-btn-delete-outline"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
