"use client";

/**
 * CascadeTraceBreadcrumb — Phase 5 of epic #1675.
 *
 * Renders the cascade ancestry chain for a setting:
 *
 *   System → Domain → Course → effective
 *
 * Reads `contract.cascadeSources` to know which layers contribute.
 * Each chip shows the layer label + the path inside that layer.
 *
 * Slice A scope: read-only chips. A Phase 5 Slice B follow-up will
 * make chips clickable to jump to the source-of-truth surface for that
 * layer (e.g. Domain row in Settings tab).
 */

import type { JourneySettingContract } from "@/lib/journey/setting-contracts";

interface CascadeTraceBreadcrumbProps {
  contract: JourneySettingContract;
}

const LAYER_LABEL: Record<string, string> = {
  system: "System",
  domain: "Domain",
  group: "Course",
};

export function CascadeTraceBreadcrumb({
  contract,
}: CascadeTraceBreadcrumbProps) {
  const sources = contract.cascadeSources;
  if (!sources.length) return null;

  return (
    <div
      className="hf-cascade-trace"
      data-testid={`hf-cascade-trace-${contract.id}`}
    >
      <span className="hf-category-label">Cascade:</span>{" "}
      {sources.map((src, i) => (
        <span key={`${src.level}-${i}`}>
          <span
            className="hf-badge hf-badge-muted"
            title={src.storagePath}
            data-testid={`hf-cascade-trace-layer-${src.level}`}
          >
            {LAYER_LABEL[src.level] ?? src.level}
          </span>
          {i < sources.length - 1 ? <span> → </span> : null}
        </span>
      ))}
      <span> → </span>
      <span
        className="hf-badge hf-badge-info"
        title="The currently-effective layer at runtime resolution"
      >
        effective
      </span>
    </div>
  );
}
