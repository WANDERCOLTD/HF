"use client";

/**
 * FieldHint — Gold UI contextual help popover for wizard labels.
 *
 * Renders a label with an inline (?) icon. On hover/tap, shows a structured
 * popover with Why? / Effect / Examples. CSS lives in globals.css (hf-field-hint-*).
 *
 * Usage:
 *   <FieldHint label="Session Goal" hint={WIZARD_HINTS["teach.goal"]} />
 *   <FieldHint label="Join Link" hint={hint} labelClass="wiz-section-label" />
 */

import { useState, useCallback } from "react";
import { HelpCircle } from "lucide-react";

export interface FieldHintContent {
  /** What is this for? */
  why: string;
  /** How it affects the AI / system */
  effect: string;
  /** Example values */
  examples: string[];
}

interface FieldHintProps {
  label: string;
  hint: FieldHintContent;
  /** CSS class for the outer label div. Defaults to "dtw-section-label". */
  labelClass?: string;
}

export function FieldHint({ label, hint, labelClass = "dtw-section-label" }: FieldHintProps) {
  const [tapped, setTapped] = useState(false);

  const handleTap = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setTapped((prev) => !prev);
  }, []);

  const handleBlur = useCallback(() => setTapped(false), []);

  return (
    <div className={labelClass}>
      <span className="hf-field-hint-wrap">
        {label}
        <button
          type="button"
          className={`hf-field-hint-trigger${tapped ? " hf-field-hint-trigger--active" : ""}`}
          onClick={handleTap}
          onBlur={handleBlur}
          aria-label={`Help: ${label}`}
        >
          <HelpCircle size={13} />
        </button>
        <span className="hf-field-hint-popover" role="tooltip">
          <span className="hf-field-hint-row">
            <span className="hf-field-hint-key">Why?</span>
            <span className="hf-field-hint-val">{hint.why}</span>
          </span>
          <span className="hf-field-hint-row">
            <span className="hf-field-hint-key">Effect</span>
            <span className="hf-field-hint-val">{hint.effect}</span>
          </span>
          {hint.examples.length > 0 && (
            <span className="hf-field-hint-row">
              <span className="hf-field-hint-key">Examples</span>
              <span className="hf-field-hint-val hf-field-hint-examples">
                {hint.examples.join(", ")}
              </span>
            </span>
          )}
        </span>
      </span>
    </div>
  );
}
