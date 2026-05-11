"use client";

/**
 * /x/lo-review — LO audience review queue (#317).
 *
 * Surfaces LO classifications that the AI-to-DB guard queued for human
 * review (confidence < 0.8 OR LLM failure). For each row the operator sees
 * the LO description, the classifier's proposed audience, confidence, and
 * rationale; can approve (apply proposal + stamp humanOverriddenAt) or
 * reject (keep current + stamp humanOverriddenAt).
 *
 * Either decision exits the row from the queue — humanOverriddenAt is the
 * sentinel. Classifier re-runs respect it.
 */

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, X, RefreshCw } from "lucide-react";

interface QueueItem {
  classificationId: string;
  lo: {
    id: string;
    ref: string;
    description: string;
    originalText: string | null;
    learnerVisible: boolean;
    performanceStatement: string | null;
    systemRole: string;
  };
  proposal: {
    proposedLearnerVisible: boolean;
    proposedPerformanceStatement: string | null;
    proposedSystemRole: string;
    confidence: number;
    rationale: string | null;
    classifierVersion: string;
    runAt: string;
  };
  module: { id: string; slug: string; title: string } | null;
  curriculum: { id: string; name: string } | null;
}

function audienceLabel(role: string, learnerVisible: boolean): string {
  if (learnerVisible && role === "NONE") return "learner";
  switch (role) {
    case "ASSESSOR_RUBRIC": return "hidden · rubric";
    case "ITEM_GENERATOR_SPEC": return "hidden · item gen";
    case "SCORE_EXPLAINER": return "hidden · score explainer";
    default: return "hidden";
  }
}

function audienceBadgeClass(role: string, learnerVisible: boolean): string {
  if (learnerVisible && role === "NONE") return "hf-badge hf-badge-xs hf-badge-success";
  if (role === "ITEM_GENERATOR_SPEC") return "hf-badge hf-badge-xs hf-badge-info";
  return "hf-badge hf-badge-xs hf-badge-muted";
}

export default function LoReviewPage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/curricula/lo-review-queue?limit=100");
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error ?? `Status ${res.status}`);
      setItems(data.items as QueueItem[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const decide = useCallback(async (classificationId: string, action: "approve" | "reject") => {
    setDecidingId(classificationId);
    try {
      const res = await fetch(`/api/curricula/lo-review-queue/${classificationId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error ?? "Decision failed");
      // Optimistic remove from list.
      setItems((prev) => prev.filter((i) => i.classificationId !== classificationId));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Decision failed");
    } finally {
      setDecidingId(null);
    }
  }, []);

  return (
    <div className="hf-stack-md" style={{ padding: 24 }}>
      <header className="hf-stack-xs">
        <h1 className="hf-page-title">LO Audience Review Queue</h1>
        <p className="hf-page-subtitle">
          Learning Objectives the audience classifier flagged as low-confidence
          or ambiguous. Approve to apply the classifier's proposal; reject to
          keep the current state. Either action stamps a human override so
          future classifier re-runs leave the row alone.
        </p>
      </header>

      <div className="hf-flex hf-items-center hf-gap-sm">
        <button
          type="button"
          className="hf-btn hf-btn-secondary hf-btn-sm"
          onClick={load}
          disabled={loading}
        >
          <RefreshCw size={13} className={loading ? "hf-glow-active" : ""} />{" "}
          Refresh
        </button>
        <span className="hf-text-sm hf-text-muted">
          {loading ? "Loading…" : `${items.length} item${items.length === 1 ? "" : "s"} in queue`}
        </span>
      </div>

      {error && (
        <div className="hf-banner hf-banner-error">
          <strong>Failed to load:</strong> {error}
        </div>
      )}

      {!loading && items.length === 0 && !error && (
        <div className="hf-empty">
          <p>Nothing to review — every LO classification is either applied or human-overridden.</p>
        </div>
      )}

      <div className="hf-stack-md">
        {items.map((item) => {
          const isDeciding = decidingId === item.classificationId;
          const currentLabel = audienceLabel(item.lo.systemRole, item.lo.learnerVisible);
          const proposedLabel = audienceLabel(
            item.proposal.proposedSystemRole,
            item.proposal.proposedLearnerVisible,
          );
          return (
            <article key={item.classificationId} className="hf-card">
              <header className="hf-flex hf-items-center hf-gap-sm" style={{ marginBottom: 12 }}>
                <code className="hf-text-sm">
                  {item.curriculum?.name ?? "(no curriculum)"} ·{" "}
                  {item.module?.title ?? "(no module)"} ·{" "}
                  <strong>{item.lo.ref}</strong>
                </code>
                <span
                  className="hf-badge hf-badge-xs hf-badge-warning"
                  title="Classifier confidence below the 0.8 auto-apply threshold."
                >
                  conf {(item.proposal.confidence * 100).toFixed(0)}%
                </span>
                <span className="hf-text-xs hf-text-muted">
                  {item.proposal.classifierVersion}
                </span>
              </header>

              <div className="hf-text-sm" style={{ marginBottom: 12 }}>
                <strong>Description:</strong> {item.lo.description}
              </div>

              {item.lo.originalText && item.lo.originalText !== item.lo.description && (
                <div className="hf-text-xs hf-text-muted" style={{ marginBottom: 12 }}>
                  <strong>Verbatim source:</strong> {item.lo.originalText}
                </div>
              )}

              <div
                className="hf-flex hf-gap-md"
                style={{ marginBottom: 12, alignItems: "stretch", flexWrap: "wrap" }}
              >
                <div className="hf-stack-xs" style={{ flex: 1, minWidth: 280 }}>
                  <div className="hf-text-xs hf-text-muted">Current</div>
                  <div>
                    <span className={audienceBadgeClass(item.lo.systemRole, item.lo.learnerVisible)}>
                      {currentLabel}
                    </span>
                  </div>
                  {item.lo.performanceStatement && (
                    <div className="hf-text-xs">
                      Performance statement: <em>{item.lo.performanceStatement}</em>
                    </div>
                  )}
                </div>

                <div className="hf-stack-xs" style={{ flex: 1, minWidth: 280 }}>
                  <div className="hf-text-xs hf-text-muted">Classifier proposes</div>
                  <div>
                    <span
                      className={audienceBadgeClass(
                        item.proposal.proposedSystemRole,
                        item.proposal.proposedLearnerVisible,
                      )}
                    >
                      {proposedLabel}
                    </span>
                  </div>
                  {item.proposal.proposedPerformanceStatement && (
                    <div className="hf-text-xs">
                      Performance statement: <em>{item.proposal.proposedPerformanceStatement}</em>
                    </div>
                  )}
                  {item.proposal.rationale && (
                    <div className="hf-text-xs hf-text-muted">
                      Rationale: {item.proposal.rationale}
                    </div>
                  )}
                </div>
              </div>

              <div className="hf-flex hf-gap-sm">
                <button
                  type="button"
                  className="hf-btn hf-btn-primary hf-btn-sm"
                  onClick={() => decide(item.classificationId, "approve")}
                  disabled={isDeciding}
                >
                  <CheckCircle2 size={13} /> Approve proposal
                </button>
                <button
                  type="button"
                  className="hf-btn hf-btn-secondary hf-btn-sm"
                  onClick={() => decide(item.classificationId, "reject")}
                  disabled={isDeciding}
                >
                  <X size={13} /> Keep current
                </button>
                {isDeciding && <RefreshCw size={13} className="hf-glow-active" />}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
