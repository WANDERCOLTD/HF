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
import { ExternalLink } from 'lucide-react';
import { HFDrawer } from './HFDrawer';
import { getCategoryStyle, getTrustLevel } from '@/lib/content-categories';

// ── Types ──────────────────────────────────────────

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
  _count: { children: number };
};

// ── Component ──────────────────────────────────────

export function AssertionDetailDrawer({
  courseId,
  assertionId,
  onClose,
}: {
  courseId: string;
  assertionId: string | null;
  onClose: () => void;
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

            {detail._count.children > 0 && (
              <>
                <span className="hf-drawer-field-label">Sub-assertions</span>
                <span className="hf-drawer-field-value">{detail._count.children}</span>
              </>
            )}
          </div>
        </>
      )}
    </HFDrawer>
  );
}
