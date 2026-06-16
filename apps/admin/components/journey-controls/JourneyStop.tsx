"use client";

import { useCascadeEditField } from "@/lib/journey/use-cascade-edit-field";
import { useJourneySetting } from "@/components/shared/preview-renderers/_journey-setting-context";

import { _FieldShell, _firstCascadeSource } from "./_FieldShell";
import type { JourneyFieldProps } from "./JourneyField";

/** Trigger discriminated-union types — mirror of `JourneyStopTrigger`
 *  in `lib/types/json-fields.ts`. The editor only commits one of these. */
const TRIGGER_TYPES = [
  { value: "first_session", label: "On the first session" },
  { value: "before_session", label: "Before session N" },
  { value: "after_session", label: "After session N" },
  { value: "midpoint", label: "At journey midpoint" },
  { value: "mastery_reached", label: "When mastery threshold reached" },
  { value: "session_count", label: "After N sessions" },
  { value: "course_complete", label: "When course completes" },
] as const;

type TriggerType = (typeof TRIGGER_TYPES)[number]["value"];

interface TriggerWithIndex {
  type: "before_session" | "after_session";
  index: number;
}
interface TriggerWithThreshold {
  type: "mastery_reached";
  threshold: number;
}
interface TriggerWithCount {
  type: "session_count";
  count: number;
}
interface TriggerSimple {
  type: "first_session" | "midpoint" | "course_complete";
}
type Trigger = TriggerSimple | TriggerWithIndex | TriggerWithThreshold | TriggerWithCount;

interface StopDraft {
  enabled: boolean;
  trigger: Trigger;
  /** Preserved from the existing value so we don't drop `id`, `kind`,
   *  `delivery`, `payload` etc. on save. */
  extra: Record<string, unknown>;
}

/** JourneyStop primitive — typed compound editor for the discriminated-
 *  union shape `{kind, enabled, trigger, …}`. Saves the full object via
 *  the journey-setting PATCH route.
 *
 *  Educator sees:
 *    - Enabled toggle
 *    - Trigger type dropdown (7 options)
 *    - Conditional sub-fields (index / threshold / count) based on type
 *
 *  Edits auto-commit debounced (matches JourneyText / JourneyNumber).
 *  Any extra fields on the stored value (`id`, `kind`, `delivery`,
 *  `payload`) are preserved across saves.
 *
 *  Falls back to a read-only placeholder when there is no course context
 *  (legacy callers, Preview tab read-only window). */
export function JourneyStop({ contract, value }: JourneyFieldProps) {
  const ctx = useJourneySetting();
  const initialDraft = parseStopValue(value);

  const f = useCascadeEditField<StopDraft>({
    contract,
    value: initialDraft,
    onSave: async (next) => {
      const fullValue = serializeStop(next);
      await ctx.saveSetting(contract.id, fullValue);
    },
  });

  if (!ctx.courseId || ctx.readonly) {
    return (
      <_FieldShell
        contract={contract}
        effectiveSource={_firstCascadeSource(contract)}
        isDirty={false}
        isActive={false}
      >
        <div
          className="hf-jf-compound-placeholder"
          data-testid={`hf-jf-stop-${contract.id}`}
        >
          {isEmptyStop(value) ? (
            <div className="hf-jf-compound-empty">
              <strong>Not configured.</strong>
            </div>
          ) : (
            <div className="hf-jf-compound-summary">
              <strong>{initialDraft.enabled ? "Enabled" : "Disabled"}</strong>
              <span> · {describeTrigger(initialDraft.trigger)}</span>
            </div>
          )}
          <div className="hf-jf-help">
            {!ctx.courseId
              ? "Editor mounts when course context is available."
              : "Read-only mode."}
          </div>
        </div>
      </_FieldShell>
    );
  }

  const onEnabledChange = (next: boolean) => {
    f.setDraftValue({ ...f.draftValue, enabled: next });
    f.commitDebounced();
  };

  const onTypeChange = (next: TriggerType) => {
    f.setDraftValue({
      ...f.draftValue,
      trigger: defaultTriggerForType(next),
    });
    f.commitDebounced();
  };

  const onIndexChange = (n: number) => {
    const t = f.draftValue.trigger;
    if (t.type !== "before_session" && t.type !== "after_session") return;
    f.setDraftValue({ ...f.draftValue, trigger: { ...t, index: n } });
    f.commitDebounced();
  };

  const onThresholdChange = (n: number) => {
    const t = f.draftValue.trigger;
    if (t.type !== "mastery_reached") return;
    f.setDraftValue({ ...f.draftValue, trigger: { ...t, threshold: n } });
    f.commitDebounced();
  };

  const onCountChange = (n: number) => {
    const t = f.draftValue.trigger;
    if (t.type !== "session_count") return;
    f.setDraftValue({ ...f.draftValue, trigger: { ...t, count: n } });
    f.commitDebounced();
  };

  const draft = f.draftValue;
  const trigger = draft.trigger;

  return (
    <_FieldShell
      contract={contract}
      effectiveSource={_firstCascadeSource(contract)}
      isDirty={f.isDirty}
      isActive={f.glow.isActive}
    >
      <div
        className="hf-jf-control hf-jf-stop-editor"
        data-testid={`hf-jf-stop-${contract.id}`}
      >
        <div className="hf-jf-stop-row">
          <label
            className="hf-jf-stop-sub-label"
            htmlFor={`hf-jf-${contract.id}-enabled`}
          >
            Enabled
          </label>
          <button
            id={`hf-jf-${contract.id}-enabled`}
            type="button"
            role="switch"
            aria-checked={draft.enabled}
            disabled={f.isSaving}
            onClick={() => onEnabledChange(!draft.enabled)}
            className="hf-jf-toggle"
            data-testid={`hf-jf-stop-${contract.id}-enabled`}
          />
        </div>

        <div className="hf-jf-stop-row">
          <label
            className="hf-jf-stop-sub-label"
            htmlFor={`hf-jf-${contract.id}-trigger-type`}
          >
            Trigger
          </label>
          <select
            id={`hf-jf-${contract.id}-trigger-type`}
            className="hf-input hf-jf-select"
            value={trigger.type}
            disabled={f.isSaving}
            onChange={(e) => onTypeChange(e.target.value as TriggerType)}
            data-testid={`hf-jf-stop-${contract.id}-trigger-type`}
          >
            {TRIGGER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {(trigger.type === "before_session" || trigger.type === "after_session") && (
          <div className="hf-jf-stop-row">
            <label
              className="hf-jf-stop-sub-label"
              htmlFor={`hf-jf-${contract.id}-trigger-index`}
            >
              Session N
            </label>
            <input
              id={`hf-jf-${contract.id}-trigger-index`}
              type="number"
              className="hf-input hf-jf-input"
              min={1}
              step={1}
              value={trigger.index}
              disabled={f.isSaving}
              onChange={(e) => onIndexChange(Number(e.target.value))}
              onBlur={() => void f.commit()}
              data-testid={`hf-jf-stop-${contract.id}-trigger-index`}
            />
          </div>
        )}

        {trigger.type === "mastery_reached" && (
          <div className="hf-jf-stop-row">
            <label
              className="hf-jf-stop-sub-label"
              htmlFor={`hf-jf-${contract.id}-trigger-threshold`}
            >
              Threshold (0–1)
            </label>
            <input
              id={`hf-jf-${contract.id}-trigger-threshold`}
              type="number"
              className="hf-input hf-jf-input"
              min={0}
              max={1}
              step={0.05}
              value={trigger.threshold}
              disabled={f.isSaving}
              onChange={(e) => onThresholdChange(Number(e.target.value))}
              onBlur={() => void f.commit()}
              data-testid={`hf-jf-stop-${contract.id}-trigger-threshold`}
            />
          </div>
        )}

        {trigger.type === "session_count" && (
          <div className="hf-jf-stop-row">
            <label
              className="hf-jf-stop-sub-label"
              htmlFor={`hf-jf-${contract.id}-trigger-count`}
            >
              Sessions
            </label>
            <input
              id={`hf-jf-${contract.id}-trigger-count`}
              type="number"
              className="hf-input hf-jf-input"
              min={1}
              step={1}
              value={trigger.count}
              disabled={f.isSaving}
              onChange={(e) => onCountChange(Number(e.target.value))}
              onBlur={() => void f.commit()}
              data-testid={`hf-jf-stop-${contract.id}-trigger-count`}
            />
          </div>
        )}
      </div>
    </_FieldShell>
  );
}

function parseStopValue(value: unknown): StopDraft {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      enabled: false,
      trigger: { type: "first_session" },
      extra: {},
    };
  }
  const obj = value as Record<string, unknown>;
  const { enabled: rawEnabled, trigger: rawTrigger, ...extra } = obj;
  return {
    enabled: typeof rawEnabled === "boolean" ? rawEnabled : false,
    trigger: parseTrigger(rawTrigger),
    extra,
  };
}

function parseTrigger(raw: unknown): Trigger {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { type: "first_session" };
  }
  const t = raw as Record<string, unknown>;
  const type = typeof t.type === "string" ? t.type : "first_session";
  switch (type) {
    case "before_session":
    case "after_session":
      return {
        type,
        index: typeof t.index === "number" && t.index > 0 ? t.index : 1,
      };
    case "mastery_reached":
      return {
        type,
        threshold:
          typeof t.threshold === "number" && t.threshold >= 0 && t.threshold <= 1
            ? t.threshold
            : 0.7,
      };
    case "session_count":
      return {
        type,
        count: typeof t.count === "number" && t.count > 0 ? t.count : 3,
      };
    case "first_session":
    case "midpoint":
    case "course_complete":
      return { type };
    default:
      return { type: "first_session" };
  }
}

function defaultTriggerForType(type: TriggerType): Trigger {
  switch (type) {
    case "before_session":
    case "after_session":
      return { type, index: 1 };
    case "mastery_reached":
      return { type, threshold: 0.7 };
    case "session_count":
      return { type, count: 3 };
    case "first_session":
    case "midpoint":
    case "course_complete":
      return { type };
  }
}

function serializeStop(draft: StopDraft): Record<string, unknown> {
  return {
    ...draft.extra,
    enabled: draft.enabled,
    trigger: draft.trigger,
  };
}

function describeTrigger(t: Trigger): string {
  switch (t.type) {
    case "first_session":
      return "On the first session";
    case "before_session":
      return `Before session ${t.index}`;
    case "after_session":
      return `After session ${t.index}`;
    case "midpoint":
      return "At journey midpoint";
    case "mastery_reached":
      return `When mastery reaches ${Math.round(t.threshold * 100)}%`;
    case "session_count":
      return `After ${t.count} sessions`;
    case "course_complete":
      return "When course completes";
  }
}

function isEmptyStop(v: unknown): boolean {
  return (
    typeof v !== "object" ||
    v === null ||
    Object.keys(v as Record<string, unknown>).length === 0
  );
}
