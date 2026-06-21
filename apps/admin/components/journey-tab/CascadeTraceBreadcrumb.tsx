"use client";

/**
 * CascadeTraceBreadcrumb — Phase 5 of epic #1675, Slice C2 (#1737)
 * cascade-honesty integration.
 *
 * Slice A (pre-C2) rendered a static "System → Domain → Course → effective"
 * chip strip derived from `contract.cascadeSources`. That was a
 * **Cascade-pillar Lattice gap** — operators saw the resolved value
 * downstream (in JourneyField) but had no provenance: which layer set
 * it, what fallback applied, what would override.
 *
 * Slice C2 routes the breadcrumb through `useEffectiveValue` →
 * `<CascadeValue>` so the chip shows the LIVE winning layer + a
 * clickable inspector affordance. Settings whose knob key has no
 * registered cascade family (~half the 51 entries — pure course-only
 * fields, runtime/scoring knobs, etc.) still render the static chain
 * derived from `cascadeSources` as a graceful fallback. The hook's
 * `unresolvable` flag is the structural gate.
 *
 * Reuse pattern (see `.claude/rules/cascade-reuse.md`):
 *   useEffectiveValue(knobKey, scope) → Effective<T>
 *     ↓
 *   <CascadeValue envelope={…}>{stringifiedValue}</CascadeValue>
 */

import type { JourneySettingContract } from "@/lib/journey/setting-contracts";
import { CascadeValue } from "@/components/shared/CascadeValue";
import { useEffectiveValue } from "@/lib/cascade/use-effective-value";
import { useJourneySetting } from "@/components/shared/preview-renderers/_journey-setting-context";

interface CascadeTraceBreadcrumbProps {
  contract: JourneySettingContract;
}

const LAYER_LABEL: Record<string, string> = {
  system: "System",
  domain: "Domain",
  group: "Course",
};

/** Stringify the cascade winner for the inline display. Short strings
 *  + numbers + booleans render directly; objects/arrays render as JSON
 *  preview truncated to ~40 chars to keep the chip line tight. */
function displayValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "On" : "Off";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v.length > 60 ? `${v.slice(0, 57)}…` : v;
  try {
    const json = JSON.stringify(v);
    return json.length > 40 ? `${json.slice(0, 37)}…` : json;
  } catch {
    return String(v);
  }
}

function StaticChain({ contract }: CascadeTraceBreadcrumbProps) {
  const sources = contract.cascadeSources;
  if (!sources.length) {
    // A3 of epic #2225 — intrinsically course-only contract (no
    // Domain/System ancestor declared, no resolvable cascade family).
    // Pre-A3 this branch silently rendered nothing — 73 contracts in
    // the Inspector left operators wondering why the cascade chip was
    // missing. Now we name the absence explicitly.
    return (
      <div
        className="hf-cascade-trace"
        data-testid={`hf-cascade-trace-${contract.id}-course-only`}
      >
        <span className="hf-category-label">Cascade:</span>{" "}
        <span
          className="hf-badge hf-badge-muted"
          title="This setting is configured per course — no Domain or System default applies"
        >
          Course-only
        </span>
      </div>
    );
  }

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

export function CascadeTraceBreadcrumb({
  contract,
}: CascadeTraceBreadcrumbProps) {
  const ctx = useJourneySetting();
  const knobKey = contract.cascadeKnobKey ?? contract.id;
  const { envelope, loading, unresolvable, error } = useEffectiveValue<unknown>(
    knobKey,
    { courseId: ctx.courseId },
  );

  // Course context missing — no scope to resolve against; fall back.
  if (!ctx.courseId) {
    return <StaticChain contract={contract} />;
  }

  // The knob has no registered cascade resolver — fall back to the
  // static `cascadeSources` chain. This is the structural gate (the
  // route returned 400 "Unknown cascade knob key …").
  if (unresolvable) {
    return <StaticChain contract={contract} />;
  }

  if (loading) {
    return (
      <div
        className="hf-cascade-trace"
        data-testid={`hf-cascade-trace-${contract.id}-loading`}
      >
        <span className="hf-category-label">Cascade:</span>{" "}
        <span className="hf-cascade-trace-loading" aria-hidden>
          resolving…
        </span>
      </div>
    );
  }

  if (error || !envelope) {
    // Soft failure — render the static chain so the operator still gets
    // some attribution. The error message is logged via the route's
    // server-side error handler.
    return <StaticChain contract={contract} />;
  }

  return (
    <div
      className="hf-cascade-trace"
      data-testid={`hf-cascade-trace-${contract.id}`}
    >
      <span className="hf-category-label">Cascade:</span>{" "}
      <CascadeValue
        envelope={envelope}
        knobKey={knobKey}
        ariaLabel={`Cascade provenance for ${contract.educatorLabel}`}
      >
        {displayValue(envelope.value)}
      </CascadeValue>
    </div>
  );
}
