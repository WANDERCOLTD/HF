"use client";

// ── ChipSelect ────────────────────────────────────────
//
// Single-select chip group. Extracted from the duplicated
// ChipButton in DemoTeachWizard + LessonPlanStep.
// Uses hf-chip / hf-chip-selected from globals.css.

export interface ChipSelectOption<T extends string = string> {
  value: T;
  label: string;
}

export interface ChipSelectProps<T extends string = string> {
  options: ChipSelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Label above the chips (hf-label) */
  label?: string;
  /** Hint text below the chips (hf-hint) */
  hint?: string;
}

export function ChipSelect<T extends string = string>({
  options,
  value,
  onChange,
  label,
  hint,
}: ChipSelectProps<T>) {
  return (
    <div>
      {label && (
        <div className="hf-label" style={{ marginBottom: 8 }}>
          {label}
        </div>
      )}
      <div className="hf-flex" style={{ gap: 6, flexWrap: "wrap" }}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={"hf-chip" + (value === o.value ? " hf-chip-selected" : "")}
          >
            {o.label}
          </button>
        ))}
      </div>
      {hint && <div className="hf-hint">{hint}</div>}
    </div>
  );
}
