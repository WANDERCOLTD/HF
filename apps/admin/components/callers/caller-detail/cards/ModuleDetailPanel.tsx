"use client";

import { useState, useEffect } from "react";
import { ChevronDown } from "lucide-react";

// ─── Types ───────────────────────────────────────────

type Assertion = {
  id: string;
  assertion: string;
  category: string;
  chapter: string | null;
  trustLevel: string | null;
  examRelevance: number | null;
  tags: string[];
  depth: number | null;
};

type LearningObjective = {
  id: string;
  ref: string;
  description: string;
  sortOrder: number;
  mastery: number | null;
  assertionCount: number;
  assertions: Assertion[];
};

type ModuleLoData = {
  moduleId: string;
  moduleSlug: string;
  moduleTitle: string;
  mastery: number;
  learningObjectives: LearningObjective[];
};

// ─── Category + trust styling (from shared lib) ─────
import { getCategoryStyle, getTrustLevel } from '@/lib/content-categories';

// ─── Main Component ──────────────────────────────────

export function ModuleDetailPanel({
  callerId,
  moduleSlug,
  moduleTitle,
  moduleMastery,
  onClose,
}: {
  callerId: string;
  moduleSlug: string;
  moduleTitle: string;
  moduleMastery: number;
  onClose: () => void;
}) {
  const [data, setData] = useState<ModuleLoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeLo, setActiveLo] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setActiveLo(null);
    fetch(`/api/callers/${callerId}/lo-progress?moduleId=${moduleSlug}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.ok && res.modules?.length > 0) {
          setData(res.modules[0]);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [callerId, moduleSlug]);

  if (loading) {
    return (
      <div className="hf-lo-panel">
        <div className="hf-lo-panel-header">
          <div className="hf-text-sm hf-text-bold hf-text-primary">{moduleTitle}</div>
          <button onClick={onClose} className="hf-lo-close">&times;</button>
        </div>
        <div className="hf-lo-loading">
          <div className="hf-spinner hf-spinner-sm" />
        </div>
      </div>
    );
  }

  if (!data || data.learningObjectives.length === 0) {
    return (
      <div className="hf-lo-panel">
        <div className="hf-lo-panel-header">
          <div className="hf-text-sm hf-text-bold hf-text-primary">{moduleTitle}</div>
          <button onClick={onClose} className="hf-lo-close">&times;</button>
        </div>
        <div className="hf-lo-empty">
          No learning objectives linked yet. Assertions will appear here after content extraction.
        </div>
      </div>
    );
  }

  const los = data.learningObjectives;
  const scoredCount = los.filter((lo) => lo.mastery !== null).length;
  const totalAssertions = los.reduce((sum, lo) => sum + lo.assertionCount, 0);

  return (
    <div className="hf-lo-panel">
      {/* Header */}
      <div className="hf-lo-panel-header">
        <div className="hf-flex-1">
          <div className="hf-text-sm hf-text-bold hf-text-primary">{moduleTitle}</div>
          <div className="hf-text-xxs hf-text-muted">
            {scoredCount}/{los.length} outcomes assessed · {totalAssertions} teaching points
          </div>
        </div>
        <button onClick={onClose} className="hf-lo-close">&times;</button>
      </div>

      {/* LO Grid — one row per LO, compact */}
      <div className="hf-lo-grid">
        {los.map((lo) => {
          const isActive = activeLo === lo.id;
          const mastery = lo.mastery;
          const masteryColor = mastery === null
            ? "var(--text-placeholder)"
            : mastery >= 0.7
              ? "var(--status-success-text)"
              : mastery >= 0.4
                ? "var(--status-warning-text)"
                : "var(--status-error-text)";

          return (
            <div key={lo.id}>
              {/* LO Row — always visible */}
              <button
                className={`hf-lo-row ${isActive ? "hf-lo-row-active" : ""}`}
                onClick={() => setActiveLo(isActive ? null : lo.id)}
              >
                {/* Mastery indicator */}
                <div className="hf-lo-score" style={{ color: masteryColor }}>
                  {mastery !== null ? `${Math.round(mastery * 100)}` : "—"}
                </div>

                {/* LO description */}
                <div className="hf-lo-desc">
                  <span className="hf-lo-ref">{lo.ref}</span>
                  <span className="hf-lo-text">{lo.description}</span>
                </div>

                {/* Assertion count + expand hint */}
                <div className="hf-lo-meta">
                  {lo.assertionCount > 0 && (
                    <span className="hf-lo-count">{lo.assertionCount}</span>
                  )}
                  <ChevronDown
                    size={12}
                    className={`hf-lo-chevron ${isActive ? "hf-lo-chevron-open" : ""}`}
                  />
                </div>
              </button>

              {/* Assertion chips — revealed on click, flows naturally */}
              {isActive && lo.assertions.length > 0 && (
                <div className="hf-lo-assertions">
                  {lo.assertions.map((a) => (
                    <AssertionChip key={a.id} assertion={a} />
                  ))}
                </div>
              )}

              {isActive && lo.assertions.length === 0 && (
                <div className="hf-lo-assertions">
                  <span className="hf-text-xxs hf-text-muted">
                    No assertions linked to this outcome
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Assertion Chip ──────────────────────────────────

function AssertionChip({ assertion }: { assertion: Assertion }) {
  const catStyle = getCategoryStyle(assertion.category);
  const trust = assertion.trustLevel ? getTrustLevel(assertion.trustLevel) : null;

  return (
    <div
      className="hf-assertion-chip"
      style={{ background: catStyle.bg, color: catStyle.color }}
    >
      {/* Trust dot */}
      {trust && (
        <span
          className="hf-assertion-trust-dot"
          style={{ background: trust.color }}
          title={trust.label}
        />
      )}

      {/* Category micro-label */}
      <span className="hf-assertion-cat">{catStyle.label}</span>

      {/* Assertion text — truncated with title for full text */}
      <span className="hf-assertion-text" title={assertion.assertion}>
        {assertion.assertion}
      </span>

      {/* Exam relevance indicator */}
      {assertion.examRelevance !== null && assertion.examRelevance >= 0.7 && (
        <span className="hf-assertion-exam" title={`Exam relevance: ${Math.round(assertion.examRelevance * 100)}%`}>
          ★
        </span>
      )}
    </div>
  );
}
