"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { BookOpen, FileText, Layers } from "lucide-react";

type ContentBreakdown = {
  contentCount: number;
  instructionCount: number;
  subjects: Array<{
    id: string;
    name: string;
    assertionCount: number;
    instructionCount: number;
    sources: Array<{
      id: string;
      name: string;
      documentType: string;
      assertionCount: number;
    }>;
  }>;
};

export function TeachingContentColumn({
  playbookId,
  routePrefix,
}: {
  playbookId: string;
  routePrefix: string;
}) {
  const [data, setData] = useState<ContentBreakdown | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/courses/${playbookId}/content-breakdown?bySubject=true`)
      .then((r) => r.json())
      .then((res) => {
        if (res.ok) setData(res);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [playbookId]);

  const total = data ? data.contentCount + data.instructionCount : 0;

  return (
    <div className="hf-flex-col" style={{ height: "100%", overflowY: "auto" }}>
      <div className="hf-col-header">
        <div>
          <h3 className="hf-flex hf-gap-sm hf-heading-lg">
            <span><BookOpen size={18} /></span> Teaching Content
          </h3>
          <p className="hf-text-xs hf-text-muted hf-mt-xs" style={{ margin: 0 }}>
            What the AI knows & teaches
          </p>
        </div>
      </div>

      {loading ? (
        <div className="hf-text-xs hf-text-muted hf-p-md">Loading content...</div>
      ) : !data || total === 0 ? (
        <div
          className="hf-empty hf-text-center hf-p-lg"
          style={{ background: "var(--status-success-bg)", border: "2px dashed var(--status-success-border)" }}
        >
          <p className="hf-text-bold hf-mb-xs" style={{ color: "var(--status-success-text)" }}>
            No teaching content
          </p>
          <p className="hf-text-xs hf-text-muted">
            Upload content via the Course Setup wizard to extract teaching points
          </p>
        </div>
      ) : (
        <div className="hf-flex-col hf-gap-sm">
          {/* Summary counts */}
          <div
            className="hf-flex hf-gap-md hf-p-sm"
            style={{ background: "var(--status-success-bg)", borderRadius: 8, padding: "8px 12px" }}
          >
            <div className="hf-text-center hf-flex-1">
              <div className="hf-heading-lg" style={{ color: "var(--status-success-text)" }}>
                {data.contentCount}
              </div>
              <div className="hf-text-xs hf-text-muted">content</div>
            </div>
            <div className="hf-text-center hf-flex-1">
              <div className="hf-heading-lg" style={{ color: "var(--accent-primary)" }}>
                {data.instructionCount}
              </div>
              <div className="hf-text-xs hf-text-muted">rules</div>
            </div>
            <div className="hf-text-center hf-flex-1">
              <div className="hf-heading-lg hf-text-secondary">
                {total}
              </div>
              <div className="hf-text-xs hf-text-muted">total</div>
            </div>
          </div>

          {/* Per-subject breakdown with sources */}
          {data.subjects.map((sub) => (
            <div key={sub.id} className="hf-flex-col" style={{ borderLeft: "2px solid var(--status-success-border)", paddingLeft: 10 }}>
              <div className="hf-flex hf-items-center hf-gap-xs hf-mb-xs">
                <Layers size={13} className="hf-text-muted" />
                <span className="hf-text-xs hf-text-bold">{sub.name}</span>
                <span className="hf-text-xs hf-text-muted">
                  {sub.assertionCount} content + {sub.instructionCount} rules
                </span>
              </div>
              {sub.sources.map((src) => (
                <Link
                  key={src.id}
                  href={`${routePrefix}/content-sources/${src.id}`}
                  className="hf-flex hf-items-center hf-gap-xs hf-text-xs hf-link-plain hf-text-muted"
                  style={{ paddingLeft: 8, lineHeight: 1.8 }}
                >
                  <FileText size={11} className="hf-flex-shrink-0" />
                  <span className="hf-truncate">{src.name}</span>
                  <span className="hf-text-placeholder hf-flex-shrink-0">
                    {src.assertionCount} TPs
                  </span>
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
