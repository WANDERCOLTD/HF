"use client";

/**
 * PrereqsSoftWarningModal — #495 E4 Slice 4.5.
 *
 * Soft nudge shown when a learner clicks a module whose suggested
 * prereqs are not yet mastered, AND the course's
 * `strictPrerequisites` flag is `false` (the default — tutor advises
 * but never gates, per the v2.2 IELTS spec).
 *
 * Slice 4.6 will add a hard-lock variant for `strictPrerequisites=true`;
 * until that ships, the picker falls through to this modal so the
 * learner is never silently blocked. The "Continue anyway" affordance
 * is intentionally the secondary action — friendly, not punitive — so
 * the recommended path stays "Cancel and go back" without taking away
 * the learner's agency.
 *
 * Accessibility:
 *   - `role="dialog"` + `aria-modal="true"`
 *   - `aria-labelledby` points at the heading
 *   - Backdrop click and Escape both dismiss
 *   - Auto-focus the Cancel button so screen readers land on the
 *     least-destructive choice
 */

import { useEffect, useRef } from "react";
import type { AuthoredModule } from "@/lib/types/json-fields";

export interface UnmetPrereq {
  /** Module slug / AuthoredModule.id (same key the picker passes back). */
  slug: string;
  /** Human-readable label for the bulleted list. */
  title: string;
}

interface PrereqsSoftWarningModalProps {
  module: AuthoredModule;
  unmetPrereqs: UnmetPrereq[];
  onContinue: () => void;
  onCancel: () => void;
}

export function PrereqsSoftWarningModal({
  module: mod,
  unmetPrereqs,
  onContinue,
  onCancel,
}: PrereqsSoftWarningModalProps) {
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);

  // Focus the safe choice on mount so keyboard / SR users land on
  // "Cancel" rather than "Continue anyway".
  useEffect(() => {
    cancelBtnRef.current?.focus();
  }, []);

  // Escape dismisses. Bound at the document level so the handler still
  // fires when focus has moved off the modal's own subtree (rare, but
  // possible if a screen reader virtualises the focus).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="picker-prereq-soft-warning-title"
      className="learner-picker-page__prereq-modal-backdrop"
      onClick={onCancel}
    >
      <div
        className="learner-picker-page__prereq-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="picker-prereq-soft-warning-title"
          className="learner-picker-page__prereq-modal-title"
        >
          Heads up — you haven&apos;t completed the prereqs
        </h2>
        <p className="learner-picker-page__prereq-modal-body">
          <strong>{mod.label}</strong> works best after you&apos;ve mastered:
        </p>
        <ul className="learner-picker-page__prereq-modal-list">
          {unmetPrereqs.map((p) => (
            <li key={p.slug}>{p.title}</li>
          ))}
        </ul>
        <p className="learner-picker-page__prereq-modal-body">
          You can still try it now, but you&apos;ll get more out of it if you
          complete those first.
        </p>
        <div className="learner-picker-page__prereq-modal-actions">
          <button
            type="button"
            ref={cancelBtnRef}
            className="learner-picker-page__prereq-modal-btn learner-picker-page__prereq-modal-btn--primary"
            onClick={onCancel}
            aria-label="Cancel — go back to the picker"
          >
            Cancel
          </button>
          <button
            type="button"
            className="learner-picker-page__prereq-modal-btn learner-picker-page__prereq-modal-btn--secondary"
            onClick={onContinue}
            aria-label={`Start ${mod.label} anyway`}
          >
            Continue anyway
          </button>
        </div>
      </div>
    </div>
  );
}
