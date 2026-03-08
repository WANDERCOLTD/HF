"use client";

import { useState, useEffect } from "react";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useErrorCapture } from "@/contexts/ErrorCaptureContext";
import type { StepProps } from "../types";

type Assertion = {
  id: string;
  assertionText: string;
  category: string;
  tags: string[];
  chapterRef: string | null;
  sectionRef: string | null;
  pageRef: string | null;
  reviewedAt: string | null;
};

const CATEGORY_COLORS: Record<string, string> = {
  fact: "var(--accent-primary)", definition: "var(--accent-secondary, #8b5cf6)", threshold: "var(--status-error-text)",
  rule: "var(--badge-orange-text, #ea580c)", process: "var(--badge-cyan-text, #0891b2)", example: "var(--status-success-text)",
  principle: "var(--accent-primary)", formula: "var(--badge-pink-text, #be185d)",
};

export default function ReviewStep({ setData, getData, onNext, onPrev }: StepProps) {
  const { reportError } = useErrorCapture();
  const sourceId = getData<string>("sourceId");
  const sourceName = getData<string>("sourceName");

  const [assertions, setAssertions] = useState<Assertion[]>([]);
  const [total, setTotal] = useState(0);
  const [reviewed, setReviewed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [questionCount, setQuestionCount] = useState(0);
  const [vocabCount, setVocabCount] = useState(0);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [reviewFilter, setReviewFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [bulkReviewing, setBulkReviewing] = useState(false);
  const limit = 50;

  async function fetchAssertions() {
    if (!sourceId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (search) params.set("search", search);
      if (categoryFilter) params.set("category", categoryFilter);
      if (reviewFilter === "reviewed") params.set("reviewed", "true");
      if (reviewFilter === "pending") params.set("reviewed", "false");
      const res = await fetch(`/api/content-sources/${sourceId}/assertions?${params}`);
      const data = await res.json();
      setAssertions(data.assertions || []);
      setTotal(data.total || 0);
      setReviewed(data.reviewedCount || 0);
    } catch {
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAssertions();
  }, [sourceId, search, categoryFilter, reviewFilter, offset]);

  // Fetch Q&V counts on mount
  useEffect(() => {
    if (!sourceId) return;
    Promise.all([
      fetch(`/api/content-sources/${sourceId}/questions?limit=1`).then((r) => r.json()),
      fetch(`/api/content-sources/${sourceId}/vocabulary?limit=1`).then((r) => r.json()),
    ]).then(([qData, vData]) => {
      setQuestionCount(qData.total || 0);
      setVocabCount(vData.total || 0);
    }).catch((err: unknown) => { reportError(err instanceof Error ? err : String(err), { source: "wizard", step: "review" }); });
  }, [sourceId]);

  async function handleMarkReviewed(id: string) {
    await fetch(`/api/content-sources/${sourceId}/assertions/${id}?markReviewed=true`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    fetchAssertions();
  }

  async function handleBulkReview() {
    if (selected.size === 0) return;
    setBulkReviewing(true);
    try {
      await fetch(`/api/content-sources/${sourceId}/assertions/bulk-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assertionIds: Array.from(selected) }),
      });
      setSelected(new Set());
      fetchAssertions();
    } finally {
      setBulkReviewing(false);
    }
  }

  function handleContinue() {
    setData("reviewedCount", reviewed);
    onNext();
  }

  const reviewPct = total > 0 ? Math.round((reviewed / total) * 100) : 0;

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", margin: "0 0 8px" }}>
        Check what we found
      </h2>
      <p style={{ fontSize: 14, color: "var(--text-muted)", margin: "0 0 16px" }}>
        Review extracted assertions from <strong>{sourceName}</strong>. You can skip this step if you trust the extraction.
      </p>

      {/* Extraction summary */}
      {(questionCount > 0 || vocabCount > 0) && (
        <div style={{
          display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 8,
          background: "color-mix(in srgb, var(--accent-primary) 5%, transparent)",
          border: "1px solid color-mix(in srgb, var(--accent-primary) 15%, transparent)",
          marginBottom: 12, fontSize: 13, color: "var(--text-secondary)",
        }}>
          <span>{total} teaching points</span>
          {questionCount > 0 && <span>&middot; {questionCount} questions</span>}
          {vocabCount > 0 && <span>&middot; {vocabCount} vocabulary terms</span>}
          <Link
            href={`/x/content-sources/${sourceId}`}
            style={{ marginLeft: "auto", fontSize: 12, color: "var(--accent-primary)", textDecoration: "none", fontWeight: 600 }}
          >
            Review All &rarr;
          </Link>
        </div>
      )}

      {/* Review progress bar */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
            {reviewed}/{total} reviewed ({reviewPct}%)
          </span>
          {reviewPct === 100 && <span style={{ fontSize: 12, color: "var(--status-success-text, #16a34a)", fontWeight: 600 }}>{"\u2713"} All reviewed</span>}
        </div>
        <div style={{ height: 6, borderRadius: 3, background: "var(--surface-tertiary)", overflow: "hidden" }}>
          <div style={{
            height: "100%", borderRadius: 3,
            background: reviewPct === 100
              ? "var(--status-success-text, #16a34a)"
              : "linear-gradient(90deg, var(--accent-primary), var(--accent-primary))",
            width: `${reviewPct}%`, transition: "width 0.3s ease-out",
          }} />
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input type="text" placeholder="Search assertions..." value={search}
          onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
          style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border-default)", backgroundColor: "var(--surface-secondary)", color: "var(--text-primary)", fontSize: 13, width: 200 }}
        />
        <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setOffset(0); }}
          style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border-default)", backgroundColor: "var(--surface-secondary)", color: "var(--text-primary)", fontSize: 13 }}>
          <option value="">All categories</option>
          {Object.keys(CATEGORY_COLORS).map((cat) => (<option key={cat} value={cat}>{cat}</option>))}
        </select>
        <select value={reviewFilter} onChange={(e) => { setReviewFilter(e.target.value); setOffset(0); }}
          style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border-default)", backgroundColor: "var(--surface-secondary)", color: "var(--text-primary)", fontSize: 13 }}>
          <option value="">All</option>
          <option value="reviewed">Reviewed</option>
          <option value="pending">Pending</option>
        </select>
        {selected.size > 0 && (
          <button onClick={handleBulkReview} disabled={bulkReviewing}
            style={{
              padding: "6px 16px", borderRadius: 6, border: "none",
              background: "var(--accent-primary)", color: "var(--button-primary-text, #fff)", fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >
            {bulkReviewing ? "Marking..." : `Mark ${selected.size} Reviewed`}
          </button>
        )}
        <Link
          href={`/x/content-sources/${sourceId}`}
          style={{ marginLeft: "auto", fontSize: 12, color: "var(--accent-primary)", textDecoration: "none" }}
        >
          Full review page &rarr;
        </Link>
      </div>

      {/* Assertions table */}
      {loading ? (
        <p style={{ color: "var(--text-muted)" }}>Loading assertions...</p>
      ) : assertions.length === 0 ? (
        <p style={{ color: "var(--text-muted)" }}>No assertions found.</p>
      ) : (
        <div style={{ borderRadius: 8, border: "1px solid var(--border-default)", overflow: "hidden", marginBottom: 16 }}>
          {assertions.map((a) => {
            const isExpanded = expandedId === a.id;
            const isSelected = selected.has(a.id);
            const isReviewed = !!a.reviewedAt;
            return (
              <div key={a.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <div
                  style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                    cursor: "pointer", background: isExpanded ? "var(--surface-secondary)" : "transparent",
                  }}
                  onClick={() => setExpandedId(isExpanded ? null : a.id)}
                >
                  <div className={`hf-chevron--sm${isExpanded ? " hf-chevron--open" : ""}`}>
                    <ChevronRight size={14} />
                  </div>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) => {
                      e.stopPropagation();
                      const next = new Set(selected);
                      isSelected ? next.delete(a.id) : next.add(a.id);
                      setSelected(next);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    style={{ flexShrink: 0 }}
                  />
                  <span style={{
                    display: "inline-block", padding: "2px 6px", borderRadius: 3, fontSize: 10, fontWeight: 600,
                    color: CATEGORY_COLORS[a.category] || "var(--text-muted)",
                    background: `color-mix(in srgb, ${CATEGORY_COLORS[a.category] || "var(--text-muted)"} 10%, transparent)`,
                    textTransform: "uppercase",
                  }}>
                    {a.category}
                  </span>
                  <span style={{
                    flex: 1, fontSize: 13, color: "var(--text-primary)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {a.assertionText.length > 120 ? a.assertionText.slice(0, 120) + "..." : a.assertionText}
                  </span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, flexShrink: 0,
                    color: isReviewed ? "var(--status-success-text, #16a34a)" : "var(--text-muted)",
                  }}>
                    {isReviewed ? "Reviewed" : "Pending"}
                  </span>
                </div>
                {isExpanded && (
                  <div style={{ padding: "12px 14px 14px 44px", background: "var(--surface-secondary)" }}>
                    <pre style={{ fontSize: 13, color: "var(--text-primary)", whiteSpace: "pre-wrap", margin: "0 0 10px", lineHeight: 1.5 }}>
                      {a.assertionText}
                    </pre>
                    <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
                      {a.chapterRef && <span>Ch: {a.chapterRef}</span>}
                      {a.sectionRef && <span>Sec: {a.sectionRef}</span>}
                      {a.pageRef && <span>Pg: {a.pageRef}</span>}
                      {a.tags.length > 0 && <span>Tags: {a.tags.join(", ")}</span>}
                    </div>
                    {!isReviewed && (
                      <button onClick={() => handleMarkReviewed(a.id)}
                        style={{
                          padding: "6px 16px", borderRadius: 6, border: "none",
                          background: "var(--accent-primary)", color: "var(--button-primary-text, #fff)", fontSize: 12, fontWeight: 600, cursor: "pointer",
                        }}
                      >
                        Mark Reviewed
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {total > limit && (
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 16 }}>
          <button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0}
            style={{ padding: "6px 12px", borderRadius: 4, border: "1px solid var(--border-default)", background: "transparent", color: offset === 0 ? "var(--text-muted)" : "var(--text-primary)", fontSize: 12, cursor: offset === 0 ? "default" : "pointer" }}>
            Previous
          </button>
          <span style={{ fontSize: 12, color: "var(--text-muted)", padding: "6px 8px" }}>
            {offset + 1}-{Math.min(offset + limit, total)} of {total}
          </span>
          <button onClick={() => setOffset(offset + limit)} disabled={offset + limit >= total}
            style={{ padding: "6px 12px", borderRadius: 4, border: "1px solid var(--border-default)", background: "transparent", color: offset + limit >= total ? "var(--text-muted)" : "var(--text-primary)", fontSize: 12, cursor: offset + limit >= total ? "default" : "pointer" }}>
            Next
          </button>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={handleContinue}
          style={{
            padding: "12px 32px", borderRadius: 8, border: "none",
            background: "var(--accent-primary)", color: "var(--button-primary-text, #fff)", fontSize: 15, fontWeight: 700, cursor: "pointer",
          }}
        >
          Continue to Plan Sessions
        </button>
        <button onClick={() => { setData("reviewedCount", reviewed); onNext(); }}
          style={{
            padding: "12px 24px", borderRadius: 8, border: "1px solid var(--border-default)",
            background: "transparent", color: "var(--text-secondary)", fontSize: 14, cursor: "pointer",
          }}
        >
          Skip Review
        </button>
        <button onClick={onPrev}
          style={{
            padding: "12px 24px", borderRadius: 8, border: "1px solid var(--border-default)",
            background: "transparent", color: "var(--text-secondary)", fontSize: 14, cursor: "pointer",
          }}
        >
          Back
        </button>
      </div>
    </div>
  );
}
