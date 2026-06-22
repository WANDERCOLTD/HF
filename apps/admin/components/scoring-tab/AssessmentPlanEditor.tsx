"use client";

/**
 * AssessmentPlanEditor — top-level Inspector lens for #2176 S1.
 *
 * Operator UI to author `Playbook.config.assessmentPlan` (typed
 * `CourseAssessmentPlan` from epic #2176 S1 / PR #2180).
 *
 * **Architecture:**
 *  - Mounted via `JourneyField` dispatch when the `assessmentPlan`
 *    contract's `control: "assessment-plan-editor"` resolves (Slice 6
 *    contract registration + Slice 7 dispatcher wiring).
 *  - Reads `playbookConfig.modules[]` from `useJourneySetting()` to
 *    populate the moduleSlug dropdown in each `AssessmentMomentEditor`
 *    (Slice 4 compound primitive).
 *  - Fetches `/api/system/spec-slugs` (Slice 8) for the scoringSpec
 *    typeahead options.
 *  - Single debounced Save via `useCascadeEditField`; per operator
 *    decision 5 the whole plan is one debounced PATCH per edit cycle.
 *
 * **Operator decisions ratified in the build plan:**
 *  - (1) `noAssessmentPlan` is NON-exclusive with declared moments.
 *    On Save with both set, the parent PATCH handler writes
 *    `assessment.plan.contradiction` AppLog (Slice 9). UI surfaces an
 *    inline warning here so operators see the disagreement live.
 *  - (5) Single lens-level Save (debounced + auto via
 *    `useCascadeEditField`).
 *  - (6) Per-moment editor inline-expands; not modal.
 *  - (7) `[↑]/[↓]` reorder buttons on `midpoints[]` rows.
 *  - (10) Empty-modules-list affordance ("Author modules in the
 *    Modules tab first") inside `AssessmentMomentEditor`.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  type AssessmentKind,
  type AssessmentMoment,
  type AuthoredModule,
  type AuthoredModuleMode,
  type CourseAssessmentPlan,
} from "@/lib/types/json-fields";
import { useCascadeEditField } from "@/lib/journey/use-cascade-edit-field";
import { useJourneySetting } from "@/components/shared/preview-renderers/_journey-setting-context";

import { _FieldShell, _firstCascadeSource } from "@/components/journey-controls/_FieldShell";
import {
  AssessmentMomentEditor,
  type MomentModuleOption,
  type MomentSpecOption,
} from "./AssessmentMomentEditor";
import type { JourneyFieldProps } from "@/components/journey-controls/JourneyField";

// ────────────────────────────────────────────────────────────────────
// Empty-state factory + helpers
// ────────────────────────────────────────────────────────────────────

function emptyMoment(kind: AssessmentKind): AssessmentMoment {
  return {
    kind,
    moduleSlug: "",
    samplingPolicy: {
      scope: "cross-curriculum",
      count: { min: 1, target: 1, max: 1 },
      contentKind: "mcq",
    },
    shellKind: "exam",
    scoringSpec: "",
  };
}

function asPlan(value: unknown): CourseAssessmentPlan {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return value as CourseAssessmentPlan;
  }
  return {};
}

function hasAnyMoment(p: CourseAssessmentPlan): boolean {
  return Boolean(
    p.upfront || (p.midpoints && p.midpoints.length > 0) || p.end,
  );
}

// ────────────────────────────────────────────────────────────────────
// Module options — read from `playbookConfig.modules[]` via context
// ────────────────────────────────────────────────────────────────────

function readModuleOptions(
  playbookConfig: Record<string, unknown> | null | undefined,
): ReadonlyArray<MomentModuleOption> {
  if (!playbookConfig) return [];
  const modules = (playbookConfig as { modules?: unknown }).modules;
  if (!Array.isArray(modules)) return [];
  const out: MomentModuleOption[] = [];
  for (const raw of modules) {
    if (!raw || typeof raw !== "object") continue;
    // `AuthoredModule.id` is the canonical per-Playbook slug. The
    // AssessmentMoment.moduleSlug field cites this same id.
    const m = raw as Partial<AuthoredModule>;
    if (typeof m.id !== "string" || !m.id) continue;
    const mode: AuthoredModuleMode =
      typeof m.mode === "string" ? (m.mode as AuthoredModuleMode) : "tutor";
    out.push({
      slug: m.id,
      mode,
      label: typeof m.label === "string" ? m.label : undefined,
    });
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────

export function AssessmentPlanEditor({
  contract,
  value,
  onSave,
  disabled,
}: JourneyFieldProps): ReactNode {
  const initial = asPlan(value);
  const f = useCascadeEditField<CourseAssessmentPlan>({
    contract,
    value: initial,
    onSave: async (next) => onSave(next),
  });

  // ── Course modules from context ──────────────────────────────────
  const { playbookConfig } = useJourneySetting();
  const moduleOptions = useMemo(
    () => readModuleOptions(playbookConfig),
    [playbookConfig],
  );

  // ── Spec slugs from /api/system/spec-slugs ──────────────────────
  const [specOptions, setSpecOptions] = useState<ReadonlyArray<MomentSpecOption>>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/system/spec-slugs?role=MEASURE");
        if (!res.ok) return;
        const body = (await res.json()) as {
          specs?: Array<{ slug?: unknown; role?: unknown }>;
        };
        if (cancelled) return;
        const out: MomentSpecOption[] = [];
        for (const raw of body.specs ?? []) {
          if (raw && typeof raw.slug === "string") {
            out.push({
              slug: raw.slug,
              role: typeof raw.role === "string" ? raw.role : undefined,
            });
          }
        }
        setSpecOptions(out);
      } catch {
        // Best-effort — operator can still type a slug. The Coverage
        // gate at save time + the runtime sampling engine surface
        // unresolved-slug errors via AppLog (`assessment.moment.fired`).
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const plan = f.draftValue;
  const contradiction = plan.noAssessmentPlan === true && hasAnyMoment(plan);

  // ── Patch helpers ────────────────────────────────────────────────
  const patch = useCallback(
    (next: CourseAssessmentPlan): void => {
      f.setDraftValue(next);
      f.commitDebounced();
    },
    [f],
  );

  const setUpfront = (m: AssessmentMoment | undefined): void =>
    patch({ ...plan, upfront: m });
  const setEnd = (m: AssessmentMoment | undefined): void =>
    patch({ ...plan, end: m });

  const setMidpoint = (i: number, m: AssessmentMoment): void => {
    const next = [...(plan.midpoints ?? [])];
    next[i] = m;
    patch({ ...plan, midpoints: next });
  };
  const addMidpoint = (): void => {
    const next = [...(plan.midpoints ?? []), emptyMoment("midpoint-check")];
    patch({ ...plan, midpoints: next });
  };
  const removeMidpoint = (i: number): void => {
    const next = [...(plan.midpoints ?? [])];
    next.splice(i, 1);
    patch({ ...plan, midpoints: next.length > 0 ? next : undefined });
  };
  const moveMidpoint = (i: number, dir: -1 | 1): void => {
    const next = [...(plan.midpoints ?? [])];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    const a = next[i];
    const b = next[j];
    if (!a || !b) return;
    next[i] = b;
    next[j] = a;
    patch({ ...plan, midpoints: next });
  };
  const setNoAssessmentPlan = (on: boolean): void => {
    if (on) {
      patch({ ...plan, noAssessmentPlan: true });
    } else {
      const { noAssessmentPlan: _drop, ...rest } = plan;
      patch(rest);
    }
  };

  // ── Render ───────────────────────────────────────────────────────
  return (
    <_FieldShell
      contract={contract}
      effectiveSource={_firstCascadeSource(contract)}
      isDirty={f.isDirty}
      isActive={f.glow.isActive}
    >
      <div className="hf-ape-root" data-testid={`hf-ape-${contract.id}`}>
        {/* ── Upfront ─────────────────────────────────────────────── */}
        <section className="hf-ape-section" aria-labelledby={`${contract.id}-upfront-h`}>
          <h4 id={`${contract.id}-upfront-h`} className="hf-ape-subhead">
            Upfront baseline
          </h4>
          {plan.upfront ? (
            <div className="hf-ape-moment-card">
              <AssessmentMomentEditor
                rowId="upfront"
                value={plan.upfront}
                onChange={(m) => setUpfront(m)}
                moduleOptions={moduleOptions}
                specOptions={specOptions}
                disabled={disabled}
              />
              <div className="hf-ape-moment-actions">
                <button
                  type="button"
                  className="hf-btn"
                  disabled={disabled}
                  onClick={() => setUpfront(undefined)}
                  data-testid="hf-ape-upfront-clear"
                >
                  Clear
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="hf-btn"
              disabled={disabled}
              onClick={() => setUpfront(emptyMoment("upfront-baseline"))}
              data-testid="hf-ape-upfront-add"
            >
              + Declare upfront moment
            </button>
          )}
        </section>

        {/* ── Midpoints ──────────────────────────────────────────── */}
        <section className="hf-ape-section" aria-labelledby={`${contract.id}-mid-h`}>
          <h4 id={`${contract.id}-mid-h`} className="hf-ape-subhead">
            Midpoints
          </h4>
          {(plan.midpoints ?? []).length === 0 ? (
            <div className="hf-jf-help" data-testid="hf-ape-midpoints-empty">
              No midpoints declared.
            </div>
          ) : (
            <ol className="hf-ape-midpoints">
              {(plan.midpoints ?? []).map((m, i, arr) => (
                <li
                  key={i}
                  className="hf-ape-moment-card"
                  data-testid={`hf-ape-midpoint-${i}`}
                >
                  <AssessmentMomentEditor
                    rowId={`midpoint-${i}`}
                    value={m}
                    onChange={(next) => setMidpoint(i, next)}
                    moduleOptions={moduleOptions}
                    specOptions={specOptions}
                    disabled={disabled}
                  />
                  <div className="hf-ape-moment-actions">
                    <button
                      type="button"
                      className="hf-btn"
                      aria-label="Move up"
                      disabled={disabled || i === 0}
                      onClick={() => moveMidpoint(i, -1)}
                      data-testid={`hf-ape-midpoint-${i}-up`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="hf-btn"
                      aria-label="Move down"
                      disabled={disabled || i === arr.length - 1}
                      onClick={() => moveMidpoint(i, 1)}
                      data-testid={`hf-ape-midpoint-${i}-down`}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="hf-btn"
                      disabled={disabled}
                      onClick={() => removeMidpoint(i)}
                      data-testid={`hf-ape-midpoint-${i}-remove`}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <button
            type="button"
            className="hf-btn"
            disabled={disabled}
            onClick={addMidpoint}
            data-testid="hf-ape-midpoint-add"
          >
            + Add midpoint
          </button>
        </section>

        {/* ── End ─────────────────────────────────────────────────── */}
        <section className="hf-ape-section" aria-labelledby={`${contract.id}-end-h`}>
          <h4 id={`${contract.id}-end-h`} className="hf-ape-subhead">
            End of curriculum
          </h4>
          {plan.end ? (
            <div className="hf-ape-moment-card">
              <AssessmentMomentEditor
                rowId="end"
                value={plan.end}
                onChange={(m) => setEnd(m)}
                moduleOptions={moduleOptions}
                specOptions={specOptions}
                disabled={disabled}
              />
              <div className="hf-ape-moment-actions">
                <button
                  type="button"
                  className="hf-btn"
                  disabled={disabled}
                  onClick={() => setEnd(undefined)}
                  data-testid="hf-ape-end-clear"
                >
                  Clear
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="hf-btn"
              disabled={disabled}
              onClick={() => setEnd(emptyMoment("end-mock"))}
              data-testid="hf-ape-end-add"
            >
              + Declare end moment
            </button>
          )}
        </section>

        {/* ── No assessment plan toggle ──────────────────────────── */}
        <section
          className="hf-ape-section hf-ape-section-noplan"
          aria-labelledby={`${contract.id}-noplan-h`}
        >
          <h4 id={`${contract.id}-noplan-h`} className="hf-ape-subhead">
            No formal assessment plan
          </h4>
          <label className="hf-jf-help" htmlFor={`${contract.id}-noplan`}>
            <input
              id={`${contract.id}-noplan`}
              type="checkbox"
              checked={plan.noAssessmentPlan === true}
              disabled={disabled}
              data-testid="hf-ape-noplan"
              onChange={(e) => setNoAssessmentPlan(e.target.checked)}
            />{" "}
            This course has no formal assessment plan by design
            (coaching-led / continuous-only).
          </label>
          {contradiction ? (
            <div
              className="hf-jf-help"
              role="alert"
              data-testid="hf-ape-contradiction"
            >
              ⚠ You have moments declared AND the no-plan flag set. The
              Coverage gate treats the flag as STALE and prefers the
              moments. Server-side AppLog
              (`assessment.plan.contradiction`) will record the dual
              state on save.
            </div>
          ) : null}
        </section>

        {/* ── Save state hint ─────────────────────────────────────── */}
        {f.isSaving ? (
          <div className="hf-jf-help" data-testid="hf-ape-saving">
            Saving…
          </div>
        ) : null}
      </div>
    </_FieldShell>
  );
}
