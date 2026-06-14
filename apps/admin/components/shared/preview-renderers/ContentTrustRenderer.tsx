"use client";

/**
 * ContentTrustRenderer — A.8 of Epic #1606 (Designer Renderers v2).
 *
 * Shows source freshness warnings as amber/red chips. Data is the
 * `FreshnessWarning[]` produced by
 * `lib/prompt/composition/transforms/trust.ts::checkFreshness` —
 * fetched via the new `GET /api/courses/:id/content-trust` route in
 * `DesignTab` and dispatched into the renderer.
 *
 * Empty state: when the warnings array is empty AND the course has
 * sources, render a "All sources fresh" green chip. When the course
 * has zero sources, render a muted "No content sources attached" chip.
 */

import { registerPreviewRenderer } from "@/components/shared/designer-shell/section-registry";
import type { PreviewRendererProps } from "@/components/shared/designer-shell/section-registry";

export interface FreshnessWarning {
  message: string;
  severity: "expired" | "expiring" | "info";
}

export interface ContentTrustRendererData {
  warnings: FreshnessWarning[];
  sourceCount: number;
}

function badgeVariantFor(severity: FreshnessWarning["severity"]): string {
  if (severity === "expired") return "hf-badge-error";
  if (severity === "expiring") return "hf-badge-warning";
  return "hf-badge-info";
}

export function ContentTrustRenderer({
  data,
}: PreviewRendererProps<ContentTrustRendererData>) {
  if (data.sourceCount === 0) {
    return (
      <div className="hf-card-compact">
        <div className="hf-category-label">Content trust</div>
        <span className="hf-badge hf-badge-muted">
          No content sources attached
        </span>
      </div>
    );
  }
  if (data.warnings.length === 0) {
    return (
      <div className="hf-card-compact">
        <div className="hf-category-label">Content trust</div>
        <span className="hf-badge hf-badge-success">
          All {data.sourceCount} source{data.sourceCount === 1 ? "" : "s"} fresh
        </span>
      </div>
    );
  }
  return (
    <div className="hf-card-compact">
      <div className="hf-category-label">
        Content trust — {data.warnings.length} warning
        {data.warnings.length === 1 ? "" : "s"}
      </div>
      <ol className="hf-list-row">
        {data.warnings.map((w, i) => (
          <li key={i}>
            <span className={`hf-badge ${badgeVariantFor(w.severity)}`}>
              {w.severity}
            </span>{" "}
            <span className="hf-text-sm">{w.message}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

registerPreviewRenderer<"contentTrust", ContentTrustRendererData>(
  "contentTrust",
  ContentTrustRenderer,
);
