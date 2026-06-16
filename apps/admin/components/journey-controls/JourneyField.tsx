"use client";

/**
 * JourneyField — typed control dispatcher for Phase 1 of epic #1675.
 *
 * Reads `contract.control` and mounts the right primitive. Every
 * primitive shares the same shell (label + cascade chip + FieldHint
 * + glow flash). Phase 2 mounts these inside Inspector renderers; from
 * Phase 2 onward, no Inspector code ever instantiates a raw `<input>`.
 *
 * Wraps each primitive in `<FieldRow>`-equivalent shell so the visual
 * style of every setting is identical regardless of control kind. Spec
 * pinned by `tests/components/journey-controls/JourneyField.test.tsx`.
 */

import { type ReactNode } from "react";

import type { JourneySettingContract } from "@/lib/journey/setting-contracts";

import "./journey-controls.css";

import { JourneyToggle } from "./JourneyToggle";
import { JourneySelect } from "./JourneySelect";
import { JourneyMultiSelect } from "./JourneyMultiSelect";
import { JourneyText } from "./JourneyText";
import { JourneyNumber } from "./JourneyNumber";
import { JourneySlider } from "./JourneySlider";
import { JourneyDuration } from "./JourneyDuration";
import { JourneyJsonFallback } from "./JourneyJsonFallback";
import { JourneyPhases } from "./JourneyPhases";
import { JourneyTargets } from "./JourneyTargets";
import { JourneyBanding } from "./JourneyBanding";
import { JourneyVoicePicker } from "./JourneyVoicePicker";
import { JourneyStop } from "./JourneyStop";
import { JourneyMinTarget } from "./JourneyMinTarget";
import { JourneyArrayEditor } from "./JourneyArrayEditor";

export interface JourneyFieldProps {
  contract: JourneySettingContract;
  /** Current effective value (post-cascade). Type narrows per control. */
  value: unknown;
  /** Save handler — Phase 2 typically threads this from the Inspector. */
  onSave: (next: unknown) => Promise<void>;
  /** Optional extra options for select-like primitives (passed straight
   *  through). Phase 2's Inspector renderer supplies these from its
   *  own resolved schema. */
  options?: ReadonlyArray<{ value: string; label: string }>;
  /** Optional cascade-source label override (display only). */
  cascadeSourceLabel?: string;
  /** Optional disabled flag — used when an auto-enable link grays out
   *  this control. */
  disabled?: boolean;
  /** Inspector renderer can decline default shell wrapping and own its
   *  own layout. Default false. */
  bare?: boolean;
}

/** Internal dispatch table — keyed off `ControlType`. */
const PRIMITIVES = {
  toggle: JourneyToggle,
  select: JourneySelect,
  "multi-select": JourneyMultiSelect,
  text: JourneyText,
  number: JourneyNumber,
  slider: JourneySlider,
  duration: JourneyDuration,
  "json-fallback": JourneyJsonFallback,
  phases: JourneyPhases,
  targets: JourneyTargets,
  banding: JourneyBanding,
  "voice-picker": JourneyVoicePicker,
  stop: JourneyStop,
  "min-target": JourneyMinTarget,
  "array-editor": JourneyArrayEditor,
} as const;

export function JourneyField(props: JourneyFieldProps): ReactNode {
  const { contract } = props;
  const Component = PRIMITIVES[contract.control];
  if (!Component) {
    // Defensive — completeness vitest pins that contracts use a valid
    // ControlType, but a type-narrowing escape hatch is safer than a
    // runtime crash in development if a NEW control kind lands without
    // a primitive.
    return (
      <div className="hf-jf-compound-placeholder">
        Unknown control kind: <code>{contract.control}</code>
      </div>
    );
  }
  return <Component {...props} />;
}
