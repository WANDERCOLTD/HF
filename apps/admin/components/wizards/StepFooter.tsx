"use client";

import { ArrowRight } from "lucide-react";
import type { StepFooterProps } from "./types";

// ── StepFooter ────────────────────────────────────────
//
// Standardized wizard step navigation footer.
// Left: Back/Cancel. Right: Skip + Secondary + Primary.
// Uses hf-step-footer from globals.css.

export function StepFooter({
  onBack,
  backLabel,
  onSkip,
  skipLabel,
  onNext,
  nextLabel,
  nextIcon,
  nextDisabled,
  nextLoading,
  secondaryAction,
}: StepFooterProps) {
  return (
    <div className="hf-step-footer">
      {onBack ? (
        <button type="button" className="hf-btn-ghost" onClick={onBack}>
          {backLabel || "Back"}
        </button>
      ) : (
        <div />
      )}
      <div className="hf-flex hf-gap-md hf-items-center">
        {onSkip && (
          <button type="button" className="hf-btn-ghost" onClick={onSkip}>
            {skipLabel || "Skip"}
          </button>
        )}
        {secondaryAction && (
          <button
            type="button"
            className="hf-btn hf-btn-secondary"
            onClick={secondaryAction.onClick}
            disabled={secondaryAction.disabled}
          >
            {secondaryAction.label}
          </button>
        )}
        <button
          type="button"
          className="hf-btn hf-btn-primary"
          onClick={onNext}
          disabled={nextDisabled || nextLoading}
        >
          {nextLoading && (
            <span
              className="hf-spinner"
              style={{ width: 16, height: 16, borderWidth: 2 }}
            />
          )}
          {nextLabel || "Next"}
          {!nextLoading && (nextIcon ?? <ArrowRight style={{ width: 16, height: 16 }} />)}
        </button>
      </div>
    </div>
  );
}
