"use client";

import { useState } from "react";

import "./cascade.css";

import type { Layer } from "@/lib/cascade/layer-types";

export interface ScopePickerOption {
  layer: "PLAYBOOK" | "DOMAIN" | "SEGMENT" | "CALLER";
  /** Pre-selected scope id for this radio (e.g. the active playbookId / domainId / callerId). */
  scopeId: string | null;
  /** Human label rendered next to the radio. */
  scopeLabel: string;
  /** Optional disabling reason — used for SEGMENT in Sprint 1. */
  disabledReason?: string;
}

export interface ScopePickerProps {
  /** Knob being written, used in the modal title. */
  knobLabel: string;
  /** Value being written. Used in the modal title and the audit reason. */
  value: unknown;
  options: ScopePickerOption[];
  /** Initial selected layer. */
  initialLayer?: ScopePickerOption["layer"];
  /** Called when operator clicks Stage override. */
  onStage: (selection: {
    layer: ScopePickerOption["layer"];
    scopeId: string | null;
    scopeLabel: string;
  }) => void;
  /** Called when operator cancels. */
  onCancel: () => void;
}

const DOMAIN_WARNING =
  "Affects every course in this domain. All enrolled learners across the domain will receive updated settings on their next call.";

const CALLER_WARNING =
  "Caller-scope overrides are persistent. They survive re-enrollment and stay in effect on every future call until explicitly reset.";

const SEGMENT_DEFAULT_DISABLED =
  "Segment-scope overrides are not available in this sprint.";

/**
 * Modal that asks the operator which scope to write an override at.
 * Renders PLAYBOOK / DOMAIN / SEGMENT / CALLER radios with exact warning
 * copy from ADR §3.4. SEGMENT is rendered but disabled in Sprint 1.
 *
 * Routes the choice back to the parent via `onStage` — the parent is
 * expected to push the change through the AI-write tray (#878) so the
 * audit trail is preserved.
 */
export function ScopePicker({
  knobLabel,
  value,
  options,
  initialLayer = "PLAYBOOK",
  onStage,
  onCancel,
}: ScopePickerProps) {
  const [selected, setSelected] = useState<ScopePickerOption["layer"]>(
    initialLayer,
  );

  function isDisabled(opt: ScopePickerOption): boolean {
    if (opt.layer === "SEGMENT") return true;
    if (opt.disabledReason) return true;
    return false;
  }

  function warningFor(layer: ScopePickerOption["layer"]): string | null {
    if (layer === "DOMAIN") return DOMAIN_WARNING;
    if (layer === "CALLER") return CALLER_WARNING;
    return null;
  }

  function valueLabel(): string {
    if (value === null) return "(unset)";
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return JSON.stringify(value);
  }

  const selectedOption = options.find((o) => o.layer === selected);

  return (
    <div
      className="hf-cascade-scopepicker-backdrop"
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="hf-cascade-scopepicker"
        role="dialog"
        aria-label={`Pick scope for ${knobLabel}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="hf-cascade-scopepicker-title">
          Override {knobLabel} = {valueLabel()} at which scope?
        </div>

        <div className="hf-cascade-scopepicker-options" role="radiogroup">
          {options.map((opt) => {
            const disabled = isDisabled(opt);
            const cls = [
              "hf-cascade-scopepicker-option",
              selected === opt.layer && "hf-cascade-scopepicker-option--selected",
              disabled && "hf-cascade-scopepicker-option--disabled",
            ]
              .filter(Boolean)
              .join(" ");
            const reason = opt.disabledReason ??
              (opt.layer === "SEGMENT" ? SEGMENT_DEFAULT_DISABLED : undefined);

            return (
              <label
                key={opt.layer}
                className={cls}
                title={reason}
                data-layer={opt.layer.toLowerCase()}
              >
                <div className="hf-cascade-scopepicker-option-label">
                  <input
                    type="radio"
                    name="scope"
                    value={opt.layer}
                    checked={selected === opt.layer}
                    onChange={() => setSelected(opt.layer)}
                    disabled={disabled}
                  />
                  <span>
                    {opt.layer === "PLAYBOOK" && "Course"}
                    {opt.layer === "DOMAIN" && "Domain"}
                    {opt.layer === "SEGMENT" && "Segment"}
                    {opt.layer === "CALLER" && "Caller"} — {opt.scopeLabel}
                  </span>
                </div>
                {warningFor(opt.layer) && selected === opt.layer ? (
                  <div
                    className="hf-cascade-scopepicker-option-warn"
                    role="note"
                  >
                    ⚠ {warningFor(opt.layer)}
                  </div>
                ) : null}
                {reason && opt.layer === "SEGMENT" ? (
                  <div
                    className="hf-cascade-scopepicker-option-warn"
                    role="note"
                  >
                    {reason}
                  </div>
                ) : null}
              </label>
            );
          })}
        </div>

        <div className="hf-cascade-scopepicker-actions">
          <button type="button" className="hf-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="hf-btn hf-btn-primary"
            disabled={!selectedOption || isDisabled(selectedOption)}
            onClick={() => {
              if (!selectedOption || isDisabled(selectedOption)) return;
              onStage({
                layer: selectedOption.layer,
                scopeId: selectedOption.scopeId,
                scopeLabel: selectedOption.scopeLabel,
              });
            }}
          >
            Stage override
          </button>
        </div>
      </div>
    </div>
  );
}

/** Exported for tests that pin exact copy. */
export const SCOPE_PICKER_WARNINGS = {
  DOMAIN: DOMAIN_WARNING,
  CALLER: CALLER_WARNING,
  SEGMENT_DISABLED: SEGMENT_DEFAULT_DISABLED,
} as const;

/** Layer type re-export — sugars consumer imports. */
export type ScopePickerLayer = Exclude<Layer, "SYSTEM" | "CALL">;
