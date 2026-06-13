"use client";

import { Lock } from "lucide-react";

import "./variant-preset-pill.css";

/**
 * Identifies which of the 3 variant-intrinsic mastery knobs the pill
 * describes. These knobs are NOT cascade-eligible by design (see
 * `lib/cascade/resolvers/mastery-policy.ts` for the rationale):
 *
 *   - `useFreshMastery` — Exam Assessment variant identity (isolated mastery)
 *   - `maxMasteryTier`  — Pop Quiz variant identity (low-stakes cap)
 *   - `scoringMode`     — evidence-first opt-in (no institutional precedent)
 *
 * The Rubric Calibration lens (SP3-A) renders these with this pill instead
 * of a `<CascadeValue>` chip so the educator sees "this knob is identity
 * to the variant" — there's no Domain default to override.
 */
export type VariantPresetKnob =
  | "useFreshMastery"
  | "maxMasteryTier"
  | "scoringMode";

export interface VariantPresetPillProps {
  knob: VariantPresetKnob;
  /**
   * The raw value from `Playbook.config`. `null` means "knob not set" —
   * the pill renders the default-state label so the educator sees what
   * the runtime will do.
   */
  value: boolean | string | null;
}

interface KnobSpec {
  /** Human-readable label of the knob. */
  label: string;
  /** Renders the value-half of the pill caption. */
  formatValue: (value: boolean | string | null) => string;
}

const KNOB_SPECS: Record<VariantPresetKnob, KnobSpec> = {
  useFreshMastery: {
    label: "Fresh mastery",
    formatValue: (v) => {
      if (v === true) return "on (Exam Assessment)";
      if (v === false) return "off";
      return "off (default)";
    },
  },
  maxMasteryTier: {
    label: "Mastery cap",
    formatValue: (v) => {
      if (typeof v === "string" && v.length > 0) {
        return v[0].toUpperCase() + v.slice(1);
      }
      return "none (default)";
    },
  },
  scoringMode: {
    label: "Scoring mode",
    formatValue: (v) => {
      if (v === "evidence-first") return "evidence-first";
      if (typeof v === "string" && v.length > 0) return v;
      return "score-first (default)";
    },
  },
};

/**
 * Inline pill marking one of the 3 variant-intrinsic mastery knobs.
 *
 * Visual distinct from `<CascadeValue>` / `<LayerBadge>`: a small lock
 * icon + caption with a subtler border, no clickable inspector tray.
 * Communicates "variant identity, no Domain override possible".
 */
export function VariantPresetPill({ knob, value }: VariantPresetPillProps) {
  const spec = KNOB_SPECS[knob];
  return (
    <span
      className="hf-variant-preset-pill"
      title={`${spec.label} is intrinsic to the variant — no cascade.`}
      aria-label={`${spec.label}: ${spec.formatValue(value)} (variant-intrinsic)`}
    >
      <Lock size={10} aria-hidden />
      <span className="hf-variant-preset-pill-label">{spec.label}:</span>
      <span className="hf-variant-preset-pill-value">
        {spec.formatValue(value)}
      </span>
    </span>
  );
}
