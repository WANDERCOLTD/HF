"use client";

import { useCascadeEditField } from "@/lib/journey/use-cascade-edit-field";

import { _FieldShell, _firstCascadeSource } from "./_FieldShell";
import type { JourneyFieldProps } from "./JourneyField";

/**
 * JourneyArrayEditor — generic array-of-structs editor for module-scoped
 * list settings.
 *
 * The dispatcher (`JourneyField`) is a non-generic React component, so the
 * primitive can't take a `<T>` type parameter at the dispatch site. We use
 * the `contract.id` to pick a row schema from a small static lookup table.
 *
 * Phase 1b shapes:
 *
 *   - `moduleCueCardPool` → `{ topic: string, bullets: string[] }` (one
 *     entry per cue card; bullets are bullet-list lines authored as a
 *     newline-separated string in the UI).
 *   - `moduleScheduledCues` → `{ at: number, text: string }` (one entry
 *     per scheduled cue; `at` is seconds-from-session-start).
 *   - `moduleTopicPool` → `{ topic: string, questions: string[] }` (one
 *     entry per topic frame; questions are authored as a newline-separated
 *     string in the UI — same shape pattern as cueCardPool's bullets).
 *     Added #2225 A2.
 *   - `moduleProfileFieldsToCapture` → `{ key: string, prompt: string,
 *     type: "text" | "number" | "band" }` (one entry per profile field
 *     the EXTRACT routine should capture; see Theme 10 / #1704).
 *
 * Each row provides add / remove / move-up / move-down. The editor
 * commits whenever a row changes; the cascade-edit hook handles debounce
 * + glow state.
 */

type RowFieldType = "string" | "string-multiline" | "number" | "select";

interface RowField {
  key: string;
  label: string;
  type: RowFieldType;
  /** For `select` only — the allowed option list. */
  options?: ReadonlyArray<{ value: string; label: string }>;
  /** Optional default for new rows. */
  default?: string | number;
  /** Optional helper text under the input. */
  hint?: string;
}

interface RowSchema {
  fields: RowField[];
  /** Shown above the rows list, e.g. "Card 1". */
  itemTitle: (index: number) => string;
}

const ROW_SCHEMAS: Record<string, RowSchema> = {
  moduleCueCardPool: {
    itemTitle: (i) => `Card ${i + 1}`,
    fields: [
      {
        key: "topic",
        label: "Topic",
        type: "string",
        default: "",
        hint: "e.g. \"Describe a memorable holiday\"",
      },
      {
        key: "bullets",
        label: "Bullets",
        type: "string-multiline",
        default: "",
        hint: "One bullet per line.",
      },
    ],
  },
  moduleScheduledCues: {
    itemTitle: (i) => `Cue ${i + 1}`,
    fields: [
      {
        key: "at",
        label: "At (seconds)",
        type: "number",
        default: 0,
      },
      {
        key: "text",
        label: "Text",
        type: "string",
        default: "",
        hint: 'e.g. "15 seconds left"',
      },
    ],
  },
  moduleTopicPool: {
    itemTitle: (i) => `Topic ${i + 1}`,
    fields: [
      {
        key: "topic",
        label: "Topic",
        type: "string",
        default: "",
        hint: 'e.g. "Work or studies", "Hometown"',
      },
      {
        key: "questions",
        label: "Questions",
        type: "string-multiline",
        default: "",
        hint: "One question per line. Tutor asks them one at a time.",
      },
    ],
  },
  moduleProfileFieldsToCapture: {
    itemTitle: (i) => `Field ${i + 1}`,
    fields: [
      {
        key: "key",
        label: "Key",
        type: "string",
        default: "",
        hint: "e.g. target_band — becomes `profile:<key>` in CallerAttribute.",
      },
      {
        key: "prompt",
        label: "Prompt",
        type: "string-multiline",
        default: "",
        hint: "What the tutor asks the learner.",
      },
      {
        key: "type",
        label: "Type",
        type: "select",
        options: [
          { value: "text", label: "Text" },
          { value: "number", label: "Number" },
          { value: "band", label: "Band" },
        ],
        default: "text",
      },
    ],
  },
};

type Row = Record<string, string | number | string[]>;

function coerce(value: unknown): Row[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is Row => !!v && typeof v === "object" && !Array.isArray(v))
    .map((v) => ({ ...v }));
}

function defaultRow(schema: RowSchema): Row {
  const row: Row = {};
  for (const f of schema.fields) {
    row[f.key] = f.default ?? (f.type === "number" ? 0 : "");
  }
  return row;
}

function rowFieldToInput(value: string | number | string[] | undefined, type: RowFieldType): string {
  if (value === undefined) return "";
  if (Array.isArray(value)) return value.join("\n");
  return String(value);
}

function inputToRowField(raw: string, type: RowFieldType): string | number | string[] {
  if (type === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  if (type === "string-multiline") {
    // Preserve newline-separated → string[] for `bullets`. Empty lines pruned.
    return raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  }
  return raw;
}

export function JourneyArrayEditor({
  contract,
  value,
  onSave,
  disabled,
}: JourneyFieldProps) {
  const schema = ROW_SCHEMAS[contract.id];

  const f = useCascadeEditField<Row[]>({
    contract,
    value: coerce(value),
    onSave: async (next) => onSave(next),
  });

  if (!schema) {
    return (
      <_FieldShell
        contract={contract}
        effectiveSource={_firstCascadeSource(contract)}
        isDirty={false}
        isActive={false}
      >
        <div className="hf-jf-help" role="alert">
          No row schema registered for <code>{contract.id}</code>. Add an entry to{" "}
          <code>ROW_SCHEMAS</code> in <code>JourneyArrayEditor.tsx</code>.
        </div>
      </_FieldShell>
    );
  }

  function commitImmediate(rows: Row[]) {
    f.setDraftValue(rows);
    // Click-driven structural changes (add / remove / reorder) commit
    // immediately — debounce is only useful for text inputs that emit
    // a stream of change events.
    void onSave(rows);
  }

  function updateDebounced(rows: Row[]) {
    f.setDraftValue(rows);
    f.commitDebounced();
  }

  function addRow() {
    commitImmediate([...f.draftValue, defaultRow(schema!)]);
  }

  function removeRow(index: number) {
    commitImmediate(f.draftValue.filter((_, i) => i !== index));
  }

  function moveRow(index: number, delta: -1 | 1) {
    const next = [...f.draftValue];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    commitImmediate(next);
  }

  function setRowField(index: number, fieldKey: string, raw: string, type: RowFieldType) {
    const next = [...f.draftValue];
    next[index] = { ...next[index], [fieldKey]: inputToRowField(raw, type) };
    updateDebounced(next);
  }

  return (
    <_FieldShell
      contract={contract}
      effectiveSource={_firstCascadeSource(contract)}
      isDirty={f.isDirty}
      isActive={f.glow.isActive}
    >
      <div className="hf-jf-array-editor">
        {f.draftValue.length === 0 ? (
          <div className="hf-jf-array-empty">No entries yet.</div>
        ) : (
          <ol className="hf-jf-array-rows">
            {f.draftValue.map((row, index) => (
              <li key={index} className="hf-jf-array-row" data-testid={`hf-jf-row-${contract.id}-${index}`}>
                <div className="hf-jf-array-row-header">
                  <span className="hf-jf-array-row-title">{schema.itemTitle(index)}</span>
                  <div className="hf-jf-array-row-actions">
                    <button
                      type="button"
                      className="hf-btn hf-btn-ghost hf-btn-icon"
                      aria-label="Move up"
                      disabled={disabled || f.isSaving || index === 0}
                      onClick={() => moveRow(index, -1)}
                      data-testid={`hf-jf-row-up-${contract.id}-${index}`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="hf-btn hf-btn-ghost hf-btn-icon"
                      aria-label="Move down"
                      disabled={disabled || f.isSaving || index === f.draftValue.length - 1}
                      onClick={() => moveRow(index, 1)}
                      data-testid={`hf-jf-row-down-${contract.id}-${index}`}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="hf-btn hf-btn-ghost hf-btn-icon hf-btn-danger"
                      aria-label="Remove"
                      disabled={disabled || f.isSaving}
                      onClick={() => removeRow(index)}
                      data-testid={`hf-jf-row-remove-${contract.id}-${index}`}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div className="hf-jf-array-row-fields">
                  {schema.fields.map((field) => {
                    const raw = rowFieldToInput(row[field.key] as string | number | string[] | undefined, field.type);
                    const inputId = `hf-jf-${contract.id}-${index}-${field.key}`;
                    return (
                      <label key={field.key} className="hf-jf-array-field">
                        <span className="hf-jf-array-field-label">{field.label}</span>
                        {field.type === "string-multiline" ? (
                          <textarea
                            id={inputId}
                            className="hf-input hf-jf-input"
                            rows={3}
                            value={raw}
                            disabled={disabled || f.isSaving}
                            data-testid={`hf-jf-field-${contract.id}-${index}-${field.key}`}
                            onChange={(e) => setRowField(index, field.key, e.target.value, field.type)}
                            onBlur={() => void f.commit()}
                          />
                        ) : field.type === "select" ? (
                          <select
                            id={inputId}
                            className="hf-input hf-jf-input"
                            value={raw}
                            disabled={disabled || f.isSaving}
                            data-testid={`hf-jf-field-${contract.id}-${index}-${field.key}`}
                            onChange={(e) => {
                              setRowField(index, field.key, e.target.value, field.type);
                              void f.commit();
                            }}
                          >
                            {field.options?.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            id={inputId}
                            type={field.type === "number" ? "number" : "text"}
                            className="hf-input hf-jf-input"
                            value={raw}
                            disabled={disabled || f.isSaving}
                            data-testid={`hf-jf-field-${contract.id}-${index}-${field.key}`}
                            onChange={(e) => setRowField(index, field.key, e.target.value, field.type)}
                            onBlur={() => void f.commit()}
                          />
                        )}
                        {field.hint ? (
                          <span className="hf-jf-help hf-jf-array-field-hint">{field.hint}</span>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
              </li>
            ))}
          </ol>
        )}
        <div className="hf-jf-array-add-row">
          <button
            type="button"
            className="hf-btn hf-btn-secondary"
            disabled={disabled || f.isSaving}
            onClick={addRow}
            data-testid={`hf-jf-array-add-${contract.id}`}
          >
            + Add row
          </button>
        </div>
      </div>
    </_FieldShell>
  );
}
