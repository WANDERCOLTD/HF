"use client";

/**
 * FieldHint — Gold UI contextual help for wizard labels.
 *
 * Renders a label with:
 *   1. Always-visible "why" helper text below the label (subtle, 12px muted)
 *   2. A (?) icon that toggles an inline expansion showing Effect + Examples
 *      (accordion-style, pushes content down — never overlays the input)
 *
 * Optional `aiEnhanced` prop adds a sparkles icon to indicate the field has
 * AI auto-suggest (e.g. on blur). Pass `aiLoading` to animate it during fetch.
 *
 * Usage:
 *   <FieldHint label="Session Goal" hint={WIZARD_HINTS["teach.goal"]} />
 *   <FieldHint label="Session Goal" hint={WIZARD_HINTS["teach.goal"]} aiEnhanced aiLoading={loading} />
 *   <FieldHint label="Join Link" hint={hint} labelClass="wiz-section-label" />
 */

import { useState, useCallback } from "react";
import { HelpCircle, ChevronDown, Sparkles } from "lucide-react";

export interface FieldHintContent {
  /** What is this for? */
  why: string;
  /** How it affects the AI / system */
  effect: string;
  /** Example values */
  examples: string[] | string;
}

interface FieldHintProps {
  label: string;
  hint: FieldHintContent;
  /** CSS class for the outer label div. Defaults to "dtw-section-label". */
  labelClass?: string;
  /** Show sparkles icon to indicate AI auto-suggest on this field. */
  aiEnhanced?: boolean;
  /** Animate the sparkles icon while AI is fetching suggestions. */
  aiLoading?: boolean;
}

export function FieldHint({ label, hint, labelClass = "dtw-section-label", aiEnhanced, aiLoading }: FieldHintProps) {
  const [open, setOpen] = useState(false);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen((prev) => !prev);
  }, []);

  const examples = Array.isArray(hint.examples) ? hint.examples : [hint.examples];
  const hasExamples = examples.length > 0 && examples[0] !== "";

  return (
    <div className={labelClass}>
      <span className="hf-field-hint-wrap">
        {label}
        {aiEnhanced && (
          <span
            className={`hf-field-hint-ai${aiLoading ? " hf-field-hint-ai--loading" : ""}`}
            title="AI-enhanced — suggestions appear when you leave this field"
          >
            <Sparkles size={13} />
          </span>
        )}
        <button
          type="button"
          className={`hf-field-hint-trigger${open ? " hf-field-hint-trigger--active" : ""}`}
          onClick={handleToggle}
          aria-label={`Help: ${label}`}
          aria-expanded={open}
        >
          {open ? <ChevronDown size={13} /> : <HelpCircle size={13} />}
        </button>
      </span>
      <span className="hf-field-hint-why">{hint.why}</span>
      {open && (
        <div className="hf-field-hint-detail" role="region" aria-label={`Details: ${label}`}>
          <div className="hf-field-hint-row">
            <span className="hf-field-hint-key">Effect</span>
            <span className="hf-field-hint-val">{hint.effect}</span>
          </div>
          {hasExamples && (
            <div className="hf-field-hint-row">
              <span className="hf-field-hint-key">Examples</span>
              <span className="hf-field-hint-val hf-field-hint-examples">
                {examples.join(", ")}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
