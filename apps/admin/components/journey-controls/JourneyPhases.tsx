"use client";

import { useCascadeEditField } from "@/lib/journey/use-cascade-edit-field";
import { useJourneySetting } from "@/components/shared/preview-renderers/_journey-setting-context";

import { _FieldShell, _firstCascadeSource } from "./_FieldShell";
import type { JourneyFieldProps } from "./JourneyField";

interface PhaseDraft {
  phase: string;
  duration: string;
  goals: string[];
  /** Preserve `content`, `surveySteps` (and any future fields) across saves. */
  extra: Record<string, unknown>;
}

interface PhasesDraft {
  phases: PhaseDraft[];
  /** Preserve `successMetrics` (OnboardingFlowPhases) / `triggerAfterCalls`
   *  / `bannerMessage` (OffboardingConfig) across saves. */
  extra: Record<string, unknown>;
}

/** Compound phase-builder primitive — Phase 3 of epic #1675 (#1693).
 *
 *  Used for `onboardingFlowPhases` + `offboardingFlowPhases`. The stored
 *  value is a wrapper object (`OnboardingFlowPhases` /
 *  `OffboardingConfig`) whose `phases` slot is an array of
 *  `OnboardingPhase = { phase, duration, goals, content?, surveySteps? }`.
 *
 *  Educator sees a row per phase with three editable fields:
 *    - Phase name (text)
 *    - Duration (text — free-form, e.g. "5 minutes")
 *    - Goals (multi-line — one goal per line)
 *
 *  Plus add / remove / reorder buttons per row. Auto-commit debounced
 *  for text changes (matches JourneyText), immediate for structural
 *  changes (matches JourneyArrayEditor).
 *
 *  Extras at the wrapper level (`successMetrics` / `triggerAfterCalls` /
 *  `bannerMessage`) AND per-phase (`content` / `surveySteps`) are
 *  preserved across saves — the editor only exposes the 3 fields above
 *  but never drops the other shape.
 *
 *  Falls back to a read-only placeholder when no provider is mounted.
 */
export function JourneyPhases({ contract, value }: JourneyFieldProps) {
  const ctx = useJourneySetting();
  const initialDraft = parsePhases(value);

  const saveDraft = async (next: PhasesDraft) => {
    await ctx.saveSetting(contract.id, serializePhases(next));
  };

  const f = useCascadeEditField<PhasesDraft>({
    contract,
    value: initialDraft,
    onSave: saveDraft,
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
          data-testid={`hf-jf-phases-${contract.id}`}
        >
          {initialDraft.phases.length === 0 ? (
            <div className="hf-jf-compound-empty">
              <strong>No phases configured.</strong>
            </div>
          ) : (
            <div className="hf-jf-compound-summary">
              <strong>
                {initialDraft.phases.length} phase
                {initialDraft.phases.length === 1 ? "" : "s"}:
              </strong>{" "}
              <span>
                {initialDraft.phases.map((p) => p.phase || "(unnamed)").join(" → ")}
              </span>
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

  function commitImmediate(next: PhasesDraft) {
    // Structural changes (add / remove / reorder) commit directly with
    // the new draft rather than via f.commit(), which reads draftRef
    // and would see the stale pre-setDraftValue snapshot synchronously.
    // Mirrors JourneyArrayEditor's pattern.
    f.setDraftValue(next);
    void saveDraft(next);
  }

  function updateDebounced(next: PhasesDraft) {
    f.setDraftValue(next);
    f.commitDebounced();
  }

  function addPhase() {
    commitImmediate({
      ...f.draftValue,
      phases: [
        ...f.draftValue.phases,
        { phase: "", duration: "", goals: [], extra: {} },
      ],
    });
  }

  function removePhase(index: number) {
    commitImmediate({
      ...f.draftValue,
      phases: f.draftValue.phases.filter((_, i) => i !== index),
    });
  }

  function movePhase(index: number, delta: -1 | 1) {
    const next = [...f.draftValue.phases];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    commitImmediate({ ...f.draftValue, phases: next });
  }

  function setPhaseField(
    index: number,
    field: "phase" | "duration" | "goalsRaw",
    raw: string,
  ) {
    const next = [...f.draftValue.phases];
    const current = next[index];
    if (field === "goalsRaw") {
      next[index] = {
        ...current,
        goals: raw
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.length > 0),
      };
    } else {
      next[index] = { ...current, [field]: raw };
    }
    updateDebounced({ ...f.draftValue, phases: next });
  }

  return (
    <_FieldShell
      contract={contract}
      effectiveSource={_firstCascadeSource(contract)}
      isDirty={f.isDirty}
      isActive={f.glow.isActive}
    >
      <div className="hf-jf-array-editor" data-testid={`hf-jf-phases-${contract.id}`}>
        {f.draftValue.phases.length === 0 ? (
          <div className="hf-jf-array-empty">No phases yet.</div>
        ) : (
          <ol className="hf-jf-array-rows">
            {f.draftValue.phases.map((p, index) => (
              <li
                key={index}
                className="hf-jf-array-row"
                data-testid={`hf-jf-phase-${contract.id}-${index}`}
              >
                <div className="hf-jf-array-row-header">
                  <span className="hf-jf-array-row-title">
                    Phase {index + 1}
                  </span>
                  <div className="hf-jf-array-row-actions">
                    <button
                      type="button"
                      className="hf-btn hf-btn-ghost hf-btn-icon"
                      aria-label="Move up"
                      disabled={f.isSaving || index === 0}
                      onClick={() => movePhase(index, -1)}
                      data-testid={`hf-jf-phase-up-${contract.id}-${index}`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="hf-btn hf-btn-ghost hf-btn-icon"
                      aria-label="Move down"
                      disabled={f.isSaving || index === f.draftValue.phases.length - 1}
                      onClick={() => movePhase(index, 1)}
                      data-testid={`hf-jf-phase-down-${contract.id}-${index}`}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="hf-btn hf-btn-ghost hf-btn-icon hf-btn-danger"
                      aria-label="Remove"
                      disabled={f.isSaving}
                      onClick={() => removePhase(index)}
                      data-testid={`hf-jf-phase-remove-${contract.id}-${index}`}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div className="hf-jf-array-row-fields">
                  <label className="hf-jf-array-field">
                    <span className="hf-jf-array-field-label">Name</span>
                    <input
                      type="text"
                      className="hf-input hf-jf-input"
                      value={p.phase}
                      disabled={f.isSaving}
                      onChange={(e) => setPhaseField(index, "phase", e.target.value)}
                      onBlur={() => void f.commit()}
                      data-testid={`hf-jf-phase-${contract.id}-${index}-name`}
                    />
                  </label>
                  <label className="hf-jf-array-field">
                    <span className="hf-jf-array-field-label">Duration</span>
                    <input
                      type="text"
                      className="hf-input hf-jf-input"
                      value={p.duration}
                      placeholder="e.g. 5 minutes"
                      disabled={f.isSaving}
                      onChange={(e) =>
                        setPhaseField(index, "duration", e.target.value)
                      }
                      onBlur={() => void f.commit()}
                      data-testid={`hf-jf-phase-${contract.id}-${index}-duration`}
                    />
                  </label>
                  <label className="hf-jf-array-field">
                    <span className="hf-jf-array-field-label">Goals</span>
                    <textarea
                      className="hf-input hf-jf-input"
                      rows={3}
                      value={p.goals.join("\n")}
                      disabled={f.isSaving}
                      onChange={(e) =>
                        setPhaseField(index, "goalsRaw", e.target.value)
                      }
                      onBlur={() => void f.commit()}
                      data-testid={`hf-jf-phase-${contract.id}-${index}-goals`}
                    />
                    <span className="hf-jf-help hf-jf-array-field-hint">
                      One goal per line.
                    </span>
                  </label>
                </div>
              </li>
            ))}
          </ol>
        )}
        <div className="hf-jf-array-add-row">
          <button
            type="button"
            className="hf-btn hf-btn-secondary"
            disabled={f.isSaving}
            onClick={addPhase}
            data-testid={`hf-jf-phases-add-${contract.id}`}
          >
            + Add phase
          </button>
        </div>
      </div>
    </_FieldShell>
  );
}

function parsePhases(value: unknown): PhasesDraft {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { phases: [], extra: {} };
  }
  const obj = value as Record<string, unknown>;
  const { phases: rawPhases, ...extra } = obj;
  const phases = Array.isArray(rawPhases)
    ? rawPhases
        .filter((p): p is Record<string, unknown> => !!p && typeof p === "object" && !Array.isArray(p))
        .map(parsePhase)
    : [];
  return { phases, extra };
}

function parsePhase(raw: Record<string, unknown>): PhaseDraft {
  const { phase, duration, goals, ...extra } = raw;
  return {
    phase: typeof phase === "string" ? phase : "",
    duration: typeof duration === "string" ? duration : "",
    goals: Array.isArray(goals)
      ? goals.filter((g): g is string => typeof g === "string")
      : [],
    extra,
  };
}

function serializePhases(draft: PhasesDraft): Record<string, unknown> {
  return {
    ...draft.extra,
    phases: draft.phases.map((p) => ({
      ...p.extra,
      phase: p.phase,
      duration: p.duration,
      goals: p.goals,
    })),
  };
}
