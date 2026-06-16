"use client";

/**
 * _FieldShell — internal shared wrapper for every JourneyField primitive.
 *
 * Renders the row of: label + cascade chip + dirty indicator + glow
 * border. Children = the control surface itself (rendered by the
 * primitive). Centralised so changes to the visual frame land in one
 * place.
 *
 * Underscore-prefixed = internal export; not part of the public barrel.
 */

import type { ReactNode } from "react";

import type {
  CascadeSource,
  JourneySettingContract,
} from "@/lib/journey/setting-contracts";

interface FieldShellProps {
  contract: JourneySettingContract;
  /** Cascade source whose value is currently effective. Empty cascadeSources
   *  on the contract → null here. */
  effectiveSource: CascadeSource | null;
  /** Caller passes glow + dirty flags so the shell visualises them. */
  isDirty: boolean;
  isActive: boolean;
  /** The control surface. */
  children: ReactNode;
  /** Optional override label suffix (e.g. "(unchanged)"). */
  labelSuffix?: ReactNode;
}

export function _FieldShell({
  contract,
  effectiveSource,
  isDirty,
  isActive,
  children,
  labelSuffix,
}: FieldShellProps): ReactNode {
  const className = [
    "hf-jf-row",
    isDirty ? "hf-jf-row-dirty" : "",
    isActive ? "hf-glow-active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className} data-testid={`hf-jf-row-${contract.id}`}>
      <div className="hf-jf-label-row">
        <label className="hf-jf-label" htmlFor={`hf-jf-${contract.id}`}>
          {contract.educatorLabel}
          {labelSuffix}
        </label>
        <div className="hf-jf-meta">
          {effectiveSource ? (
            <span className="hf-category-label" title={effectiveSource.storagePath}>
              from {effectiveSource.level}
            </span>
          ) : null}
          {isActive ? (
            <span
              className="hf-jf-saved-flash"
              aria-live="polite"
              data-testid={`hf-jf-saved-${contract.id}`}
            >
              ✓ Saved
            </span>
          ) : null}
          {isDirty && !isActive ? (
            <span className="hf-jf-dirty-dot" aria-label="unsaved">
              • Unsaved
            </span>
          ) : null}
        </div>
      </div>
      {children}
      {contract.helpText ? (
        <div className="hf-jf-help">{contract.helpText}</div>
      ) : null}
    </div>
  );
}

/** Helper — resolve the effective cascade source for display. Phase 1
 *  uses a simple first-listed approach; Phase 2 will plumb the real
 *  resolveEffective envelope through and pick the WINNING source. */
export function _firstCascadeSource(
  contract: JourneySettingContract,
): CascadeSource | null {
  return contract.cascadeSources[0] ?? null;
}
