'use client';

/**
 * AssertionDetailDrawer — read-only detail panel for a ContentAssertion.
 *
 * First consumer of HFDrawer. Fetches full assertion detail on open,
 * renders metadata in a two-column grid. No editing — the source detail
 * page owns editing.
 */

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ExternalLink, ChevronDown, ChevronRight } from 'lucide-react';
import { HFDrawer } from './HFDrawer';
import { getCategoryStyle, getTrustLevel } from '@/lib/content-categories';

// ── Types ──────────────────────────────────────────

type AssertionChild = {
  id: string;
  assertion: string;
  category: string;
  depth: number | null;
};

type AssertionQuestion = {
  id: string;
  questionText: string;
  questionType: string;
};

type AssertionVocab = {
  id: string;
  term: string;
  definition: string | null;
};

type AssertionDetail = {
  id: string;
  assertion: string;
  category: string;
  tags: string[];
  chapter: string | null;
  section: string | null;
  pageRef: string | null;
  taxYear: string | null;
  examRelevance: number | null;
  learningOutcomeRef: string | null;
  topicSlug: string | null;
  depth: number | null;
  trustLevel: string | null;
  teachMethod: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  source: { id: string; name: string };
  reviewer: { id: string; name: string | null; email: string } | null;
  _count: { children: number; questions: number; vocabulary: number; mediaLinks: number };
  children: AssertionChild[];
  questions: AssertionQuestion[];
  vocabulary: AssertionVocab[];
};

// ── Component ──────────────────────────────────────

export function AssertionDetailDrawer({
  courseId,
  assertionId,
  onClose,
  onNavigate,
}: {
  courseId: string;
  assertionId: string | null;
  onClose: () => void;
  /** Navigate to a different assertion (e.g. child drill-down) */
  onNavigate?: (assertionId: string) => void;
}): React.ReactElement {
  const [detail, setDetail] = useState<AssertionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!assertionId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`/api/courses/${courseId}/assertions/${assertionId}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.ok) setDetail(res.assertion);
        else setError(res.error || 'Failed to load');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Network error'))
      .finally(() => setLoading(false));
  }, [assertionId, courseId]);

  const catStyle = detail ? getCategoryStyle(detail.category) : null;
  const trustLevel = detail?.trustLevel ? getTrustLevel(detail.trustLevel) : null;

  const location = detail
    ? [detail.chapter, detail.section, detail.pageRef].filter(Boolean).join(' / ')
    : '';

  return (
    <HFDrawer
      open={assertionId !== null}
      onClose={onClose}
      title="Teaching Point"
      description="Full detail for a teaching point extracted from course content"
      footer={
        detail ? (
          <Link
            href={`/x/content-sources/${detail.source.id}`}
            className="hf-btn hf-btn-secondary hf-btn-sm"
            target="_blank"
          >
            <ExternalLink size={13} />
            Open in Source
          </Link>
        ) : undefined
      }
    >
      {loading && (
        <div className="hf-flex hf-items-center hf-justify-center" style={{ minHeight: 120 }}>
          <div className="hf-spinner" />
        </div>
      )}

      {error && (
        <div className="hf-banner hf-banner-error">{error}</div>
      )}

      {detail && !loading && (
        <>
          {/* ── Full assertion text ─────────────────── */}
          <p className="hf-text-sm hf-mb-md" style={{ lineHeight: 1.6 }}>
            {detail.assertion}
          </p>

          {/* ── Category badge ─────────────────────── */}
          {catStyle && (
            <div className="hf-mb-md">
              <span
                className="hf-badge hf-badge-sm"
                style={{ color: catStyle.color, background: catStyle.bg }}
              >
                {catStyle.label}
              </span>
            </div>
          )}

          {/* ── Tags ───────────────────────────────── */}
          {detail.tags.length > 0 && (
            <div className="hf-flex hf-gap-xs hf-flex-wrap hf-mb-md">
              {detail.tags.map((tag, i) => (
                <span key={i} className="hf-badge hf-badge-sm hf-badge-neutral">{tag}</span>
              ))}
            </div>
          )}

          {/* ── Metadata grid ──────────────────────── */}
          <div className="hf-drawer-field-grid">
            <span className="hf-drawer-field-label">Source</span>
            <span className="hf-drawer-field-value">{detail.source.name}</span>

            {location && (
              <>
                <span className="hf-drawer-field-label">Location</span>
                <span className="hf-drawer-field-value">{location}</span>
              </>
            )}

            {detail.learningOutcomeRef && (
              <>
                <span className="hf-drawer-field-label">Learning Outcome</span>
                <span className="hf-drawer-field-value">{detail.learningOutcomeRef}</span>
              </>
            )}

            {detail.teachMethod && (
              <>
                <span className="hf-drawer-field-label">Teach Method</span>
                <span className="hf-drawer-field-value">{detail.teachMethod.replace(/_/g, ' ')}</span>
              </>
            )}

            {trustLevel && (
              <>
                <span className="hf-drawer-field-label">Trust Level</span>
                <span className="hf-drawer-field-value">
                  <span
                    className="hf-badge hf-badge-sm"
                    style={{ color: trustLevel.color, background: trustLevel.bg }}
                  >
                    {trustLevel.label}
                  </span>
                </span>
              </>
            )}

            {detail.examRelevance != null && (
              <>
                <span className="hf-drawer-field-label">Exam Relevance</span>
                <span className="hf-drawer-field-value">{Math.round(detail.examRelevance * 100)}%</span>
              </>
            )}

            {detail.topicSlug && (
              <>
                <span className="hf-drawer-field-label">Topic</span>
                <span className="hf-drawer-field-value hf-text-mono">{detail.topicSlug}</span>
              </>
            )}

            {detail.taxYear && (
              <>
                <span className="hf-drawer-field-label">Tax Year</span>
                <span className="hf-drawer-field-value">{detail.taxYear}</span>
              </>
            )}

            {detail.depth != null && (
              <>
                <span className="hf-drawer-field-label">Depth</span>
                <span className="hf-drawer-field-value">{detail.depth}</span>
              </>
            )}

            <span className="hf-drawer-field-label">Review</span>
            <span className="hf-drawer-field-value">
              {detail.reviewedAt && detail.reviewer
                ? `Reviewed by ${detail.reviewer.name || detail.reviewer.email} on ${new Date(detail.reviewedAt).toLocaleDateString()}`
                : <span className="hf-text-muted">Pending review</span>
              }
            </span>

          </div>

          {/* ── What's under this TP ──────────────── */}
          {(detail._count.children > 0 || detail._count.questions > 0 || detail._count.vocabulary > 0 || detail._count.mediaLinks > 0) && (
            <UnderSection detail={detail} onNavigate={onNavigate} />
          )}
        </>
      )}
    </HFDrawer>
  );
}

// ---------------------------------------------------------------------------
// Expandable "What's under this TP" section
// ---------------------------------------------------------------------------

function UnderSection({ detail, onNavigate }: { detail: AssertionDetail; onNavigate?: (id: string) => void }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggle = (key: string) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const sections: { key: string; label: string; count: number }[] = [
    { key: "children", label: "Sub-assertions", count: detail._count.children },
    { key: "questions", label: "Questions", count: detail._count.questions },
    { key: "vocabulary", label: "Vocabulary", count: detail._count.vocabulary },
    { key: "media", label: "Media", count: detail._count.mediaLinks },
  ].filter((s) => s.count > 0);

  return (
    <div className="hf-mt-md" style={{ borderTop: "1px solid var(--border-default)", paddingTop: 12 }}>
      <span className="hf-text-xs hf-text-muted" style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        What&apos;s under this TP
      </span>
      <div className="hf-mt-sm">
        {sections.map(({ key, label, count }) => (
          <div key={key}>
            <button
              className="hf-flex hf-items-center hf-gap-xs hf-text-sm"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "6px 0",
                width: "100%",
                color: "var(--text-primary)",
              }}
              onClick={() => toggle(key)}
            >
              {expanded[key]
                ? <ChevronDown size={14} />
                : <ChevronRight size={14} />
              }
              <span style={{ fontWeight: 500 }}>{label}</span>
              <span className="hf-badge hf-badge-sm hf-badge-neutral">{count}</span>
            </button>
            {expanded[key] && key === "children" && (
              <div className="hf-ml-md hf-mb-sm">
                {detail.children.map((c) => (
                  <div
                    key={c.id}
                    className="hf-text-xs hf-py-xs"
                    style={{
                      borderBottom: "1px solid var(--border-default)",
                      cursor: onNavigate ? "pointer" : "default",
                    }}
                    onClick={() => onNavigate?.(c.id)}
                    role={onNavigate ? "button" : undefined}
                  >
                    <span className="hf-badge hf-badge-sm hf-badge-neutral hf-mr-xs">{c.category}</span>
                    {c.assertion}
                  </div>
                ))}
              </div>
            )}
            {expanded[key] && key === "questions" && (
              <div className="hf-ml-md hf-mb-sm">
                {detail.questions.map((q) => (
                  <div key={q.id} className="hf-text-xs hf-py-xs" style={{ borderBottom: "1px solid var(--border-default)" }}>
                    <span className="hf-badge hf-badge-sm hf-badge-neutral hf-mr-xs">{q.questionType}</span>
                    {q.questionText}
                  </div>
                ))}
              </div>
            )}
            {expanded[key] && key === "vocabulary" && (
              <div className="hf-ml-md hf-mb-sm">
                {detail.vocabulary.map((v) => (
                  <div key={v.id} className="hf-text-xs hf-py-xs" style={{ borderBottom: "1px solid var(--border-default)" }}>
                    <strong>{v.term}</strong>
                    {v.definition && <span className="hf-text-muted"> — {v.definition}</span>}
                  </div>
                ))}
              </div>
            )}
            {expanded[key] && key === "media" && (
              <div className="hf-ml-md hf-mb-sm hf-text-xs hf-text-muted hf-py-xs">
                {detail._count.mediaLinks} linked media asset{detail._count.mediaLinks !== 1 ? "s" : ""}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
