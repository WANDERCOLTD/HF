"use client";

/**
 * PrereqsHardLockModal — #495 E4 Slice 4.6.
 *
 * Hard-lock variant of {@link PrereqsSoftWarningModal}. Shown when a
 * learner clicks a module whose suggested prereqs are not yet mastered
 * AND the course's `strictPrerequisites` flag is `true`. Unlike the
 * soft-warning modal, there is NO "Continue anyway" escape hatch — the
 * single primary action just dismisses the dialog so the learner can
 * pick one of the highlighted prerequisites instead.
 *
 * Microcopy is intentionally educator-friendly: the word "locked" is
 * kept out of the title (it appears as a quiet badge on the tile), and
 * the body redirects the learner toward the next concrete step rather
 * than berating them for choosing wrong.
 *
 * Accessibility:
 *   - `role="dialog"` + `aria-modal="true"`
 *   - `aria-labelledby` points at the heading
 *   - Backdrop click and Escape both dismiss
 *   - Auto-focus the dismiss button so screen readers land on the only
 *     actionable affordance
 */

import { useEffect, useRef } from "react";
import type { AuthoredModule } from "@/lib/types/json-fields";
import type { UnmetPrereq } from "./PrereqsSoftWarningModal";

interface PrereqsHardLockModalProps {
  module: AuthoredModule;
  unmetPrereqs: UnmetPrereq[];
  onDismiss: () => void;
}

export function PrereqsHardLockModal({
  module: mod,
  unmetPrereqs,
  onDismiss,
}: PrereqsHardLockModalProps) {
  const dismissBtnRef = useRef<HTMLButtonElement | null>(null);

  // Focus the single action on mount so keyboard / SR users land on
  // the only affordance the modal offers.
  useEffect(() => {
    dismissBtnRef.current?.focus();
  }, []);

  // Escape dismisses. Bound at the document level so the handler still
  // fires when focus has moved off the modal's own subtree.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onDismiss();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onDismiss]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="picker-prereq-hard-lock-title"
      className="learner-picker-page__hardlock-modal-backdrop"
      onClick={onDismiss}
    >
      <div
        className="learner-picker-page__hardlock-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="picker-prereq-hard-lock-title"
          className="learner-picker-page__hardlock-modal-title"
        >
          Complete these first
        </h2>
        <p className="learner-picker-page__hardlock-modal-body">
          <strong>{mod.label}</strong> is locked until you&apos;ve completed:
        </p>
        <ul className="learner-picker-page__hardlock-modal-list">
          {unmetPrereqs.map((p) => (
            <li key={p.slug}>{p.title}</li>
          ))}
        </ul>
        <p className="learner-picker-page__hardlock-modal-body">
          Click one of those to start there.
        </p>
        <div className="learner-picker-page__hardlock-modal-actions">
          <button
            type="button"
            ref={dismissBtnRef}
            className="learner-picker-page__hardlock-modal-btn learner-picker-page__hardlock-modal-btn--primary"
            onClick={onDismiss}
            aria-label="OK, take me back to the picker"
          >
            OK, take me back
          </button>
        </div>
      </div>
    </div>
  );
}
