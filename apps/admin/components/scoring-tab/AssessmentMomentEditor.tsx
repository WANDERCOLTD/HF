"use client";

/**
 * AssessmentMomentEditor — one AssessmentMoment row.
 *
 * Renders the field set for ONE `AssessmentMoment`:
 *   - kind (select from ASSESSMENT_KIND_VALUES)
 *   - moduleSlug (select typeahead from playbook modules)
 *   - shellKind (select from LEARNER_SHELL_KIND_VALUES)
 *   - scoringSpec (select typeahead from `/api/system/spec-slugs`)
 *   - samplingPolicy.scope (select from ASSESSMENT_SAMPLING_SCOPE_VALUES)
 *   - samplingPolicy.contentKind (select from ASSESSMENT_CONTENT_KIND_VALUES)
 *   - samplingPolicy.count.{min,target,max} (3 numbers, validated min≤target≤max)
 *   - samplingPolicy.stratification.{perCriterion,perLO} (optional)
 *
 * Cross-checks `module.mode` against `KIND_MODE_COMPATIBILITY` and
 * renders a non-blocking warning when the operator picks a moduleSlug
 * whose mode isn't in the kind's allow-list. Same matrix the Coverage
 * gate reads (`lib/assessment/kind-mode-compatibility.ts`).
 *
 * Story: #2176 S1 — CourseAssessmentPlan editor lens.
 *
 * Editing model:
 *  - Controlled component. Parent (`AssessmentPlanEditor`) owns the
 *    draft `AssessmentMoment` and threads `value` + `onChange`.
 *  - This component does NOT call any save API directly. The parent
 *    debounces the merged plan via `useCascadeEditField` and dispatches
 *    a single PATCH per debounce window (operator decision 5).
 */

import { type ReactNode } from "react";

import {
  ASSESSMENT_KIND_VALUES,
  ASSESSMENT_SAMPLING_SCOPE_VALUES,
  ASSESSMENT_CONTENT_KIND_VALUES,
  LEARNER_SHELL_KIND_VALUES,
  type AssessmentKind,
  type AssessmentMoment,
  type AssessmentSamplingPolicy,
  type AssessmentSamplingScope,
  type AssessmentContentKind,
  type AuthoredModuleMode,
  type LearnerShellKind,
} from "@/lib/types/json-fields";
import { KIND_MODE_COMPATIBILITY } from "@/lib/assessment/kind-mode-compatibility";

/** A module entry as the editor needs it — `{slug, mode}` + optional
 *  human-readable label for the dropdown. Sourced from
 *  `Playbook.config.modules[]`. */
export interface MomentModuleOption {
  slug: string;
  mode: AuthoredModuleMode;
  /** Optional display label; falls back to slug. */
  label?: string;
}

/** A spec-slug entry as the editor needs it. Sourced from the
 *  `/api/system/spec-slugs` endpoint (Slice 8). */
export interface MomentSpecOption {
  slug: string;
  /** Optional role hint (e.g. `MEASURE`); used as a faint suffix. */
  role?: string;
}

export interface AssessmentMomentEditorProps {
  /** Stable id for accessibility / testid suffixing. */
  rowId: string;
  /** The moment being edited. Controlled by the parent. */
  value: AssessmentMoment;
  /** Called with the next moment whenever the operator changes anything.
   *  Parent debounces + commits via useCascadeEditField. */
  onChange: (next: AssessmentMoment) => void;
  /** The course's module list — used to populate the moduleSlug dropdown
   *  + cross-check `module.mode` against `kind`. */
  moduleOptions: ReadonlyArray<MomentModuleOption>;
  /** Available scoring-spec slugs from `/api/system/spec-slugs`. */
  specOptions: ReadonlyArray<MomentSpecOption>;
  /** Optional disabled flag. */
  disabled?: boolean;
}

function clampInt(n: number, min: number): number {
  return Number.isFinite(n) && n >= min ? Math.floor(n) : min;
}

function emptyPolicy(): AssessmentSamplingPolicy {
  return {
    scope: "cross-curriculum",
    count: { min: 1, target: 1, max: 1 },
    contentKind: "mcq",
  };
}

/** Best-effort cleanup — when the operator types min > target > max,
 *  preserve their last edit and let the validation chip surface the
 *  inconsistency rather than silently re-ordering values. */
function isCountValid(count: { min: number; target: number; max: number }): boolean {
  return (
    Number.isFinite(count.min) &&
    Number.isFinite(count.target) &&
    Number.isFinite(count.max) &&
    count.min >= 1 &&
    count.min <= count.target &&
    count.target <= count.max
  );
}

export function AssessmentMomentEditor({
  rowId,
  value,
  onChange,
  moduleOptions,
  specOptions,
  disabled,
}: AssessmentMomentEditorProps): ReactNode {
  const policy = value.samplingPolicy ?? emptyPolicy();

  // ── Mode-compatibility cross-check ───────────────────────────────
  const selectedModule = moduleOptions.find((m) => m.slug === value.moduleSlug);
  const allowedModes = KIND_MODE_COMPATIBILITY[value.kind];
  const modeMismatch =
    selectedModule != null && !allowedModes.includes(selectedModule.mode);

  // ── Count validity ────────────────────────────────────────────────
  const countOk = isCountValid(policy.count);

  // ── Stratification (optional) ────────────────────────────────────
  const strat = policy.stratification ?? {};

  // ── Handlers ─────────────────────────────────────────────────────
  const patchPolicy = (next: Partial<AssessmentSamplingPolicy>): void => {
    onChange({ ...value, samplingPolicy: { ...policy, ...next } });
  };
  const patchCount = (next: Partial<typeof policy.count>): void => {
    patchPolicy({ count: { ...policy.count, ...next } });
  };
  const patchStrat = (
    next: Partial<NonNullable<AssessmentSamplingPolicy["stratification"]>>,
  ): void => {
    const merged = { ...strat, ...next };
    // Drop undefined-or-zero entries to keep the JSON clean.
    const cleaned: NonNullable<AssessmentSamplingPolicy["stratification"]> = {};
    if (typeof merged.perCriterion === "number" && merged.perCriterion > 0)
      cleaned.perCriterion = merged.perCriterion;
    if (typeof merged.perLO === "number" && merged.perLO > 0)
      cleaned.perLO = merged.perLO;
    if (
      typeof merged.minSkillCoverage === "number" &&
      merged.minSkillCoverage > 0
    )
      cleaned.minSkillCoverage = merged.minSkillCoverage;
    patchPolicy({
      stratification: Object.keys(cleaned).length > 0 ? cleaned : undefined,
    });
  };

  const id = (suffix: string): string => `hf-mom-${rowId}-${suffix}`;
  const tid = (suffix: string): string => `hf-mom-${rowId}-${suffix}`;

  return (
    <div
      className="hf-mom-editor"
      data-testid={`hf-mom-editor-${rowId}`}
      aria-disabled={disabled || undefined}
    >
      {/* ── kind ─────────────────────────────────────────────────── */}
      <div className="hf-jf-control">
        <label className="hf-jf-label" htmlFor={id("kind")}>
          Kind
        </label>
        <select
          id={id("kind")}
          className="hf-input"
          value={value.kind}
          disabled={disabled}
          data-testid={tid("kind")}
          onChange={(e) =>
            onChange({ ...value, kind: e.target.value as AssessmentKind })
          }
        >
          {ASSESSMENT_KIND_VALUES.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>

      {/* ── moduleSlug ──────────────────────────────────────────── */}
      <div className="hf-jf-control">
        <label className="hf-jf-label" htmlFor={id("module")}>
          Module
        </label>
        {moduleOptions.length === 0 ? (
          <div className="hf-jf-help" data-testid={tid("module-empty")}>
            No modules defined on this course. Author modules in the Modules
            tab first.
          </div>
        ) : (
          <select
            id={id("module")}
            className="hf-input"
            value={value.moduleSlug}
            disabled={disabled}
            data-testid={tid("module")}
            onChange={(e) =>
              onChange({ ...value, moduleSlug: e.target.value })
            }
          >
            <option value="">(none — pick a module)</option>
            {moduleOptions.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.label ?? m.slug} — mode: {m.mode}
              </option>
            ))}
          </select>
        )}
        {modeMismatch ? (
          <div
            className="hf-jf-help"
            role="alert"
            data-testid={tid("mode-mismatch")}
          >
            ⚠ Mode mismatch — "{selectedModule?.slug}" has mode "
            {selectedModule?.mode}"; "{value.kind}" expects a module in mode{" "}
            [{allowedModes.join(", ")}].
          </div>
        ) : null}
      </div>

      {/* ── shellKind ───────────────────────────────────────────── */}
      <div className="hf-jf-control">
        <label className="hf-jf-label" htmlFor={id("shell")}>
          Learner shell
        </label>
        <select
          id={id("shell")}
          className="hf-input"
          value={value.shellKind}
          disabled={disabled}
          data-testid={tid("shell")}
          onChange={(e) =>
            onChange({ ...value, shellKind: e.target.value as LearnerShellKind })
          }
        >
          {LEARNER_SHELL_KIND_VALUES.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>

      {/* ── scoringSpec ─────────────────────────────────────────── */}
      <div className="hf-jf-control">
        <label className="hf-jf-label" htmlFor={id("spec")}>
          Scoring spec
        </label>
        <select
          id={id("spec")}
          className="hf-input"
          value={value.scoringSpec}
          disabled={disabled}
          data-testid={tid("spec")}
          onChange={(e) =>
            onChange({ ...value, scoringSpec: e.target.value })
          }
        >
          <option value="">(none — pick a spec)</option>
          {specOptions.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.slug}
              {s.role ? ` (${s.role})` : ""}
            </option>
          ))}
        </select>
      </div>

      {/* ── samplingPolicy.scope ─────────────────────────────── */}
      <div className="hf-jf-control">
        <label className="hf-jf-label" htmlFor={id("scope")}>
          Sampling scope
        </label>
        <select
          id={id("scope")}
          className="hf-input"
          value={policy.scope}
          disabled={disabled}
          data-testid={tid("scope")}
          onChange={(e) =>
            patchPolicy({ scope: e.target.value as AssessmentSamplingScope })
          }
        >
          {ASSESSMENT_SAMPLING_SCOPE_VALUES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {/* ── samplingPolicy.contentKind ─────────────────────── */}
      <div className="hf-jf-control">
        <label className="hf-jf-label" htmlFor={id("contentKind")}>
          Content kind
        </label>
        <select
          id={id("contentKind")}
          className="hf-input"
          value={policy.contentKind}
          disabled={disabled}
          data-testid={tid("contentKind")}
          onChange={(e) =>
            patchPolicy({ contentKind: e.target.value as AssessmentContentKind })
          }
        >
          {ASSESSMENT_CONTENT_KIND_VALUES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {/* ── samplingPolicy.count (min / target / max) ─────── */}
      <div className="hf-jf-control hf-mom-count-row">
        <label className="hf-jf-label">Item count (min / target / max)</label>
        <input
          id={id("count-min")}
          className="hf-input"
          type="number"
          min={1}
          value={policy.count.min}
          disabled={disabled}
          data-testid={tid("count-min")}
          onChange={(e) => patchCount({ min: clampInt(Number(e.target.value), 1) })}
        />
        <input
          id={id("count-target")}
          className="hf-input"
          type="number"
          min={1}
          value={policy.count.target}
          disabled={disabled}
          data-testid={tid("count-target")}
          onChange={(e) =>
            patchCount({ target: clampInt(Number(e.target.value), 1) })
          }
        />
        <input
          id={id("count-max")}
          className="hf-input"
          type="number"
          min={1}
          value={policy.count.max}
          disabled={disabled}
          data-testid={tid("count-max")}
          onChange={(e) => patchCount({ max: clampInt(Number(e.target.value), 1) })}
        />
        {!countOk ? (
          <div
            className="hf-jf-help"
            role="alert"
            data-testid={tid("count-invalid")}
          >
            ⚠ Count must satisfy min ≤ target ≤ max and all ≥ 1.
          </div>
        ) : null}
      </div>

      {/* ── samplingPolicy.stratification (optional) ──────── */}
      <div className="hf-jf-control">
        <label className="hf-jf-label">Stratification (optional)</label>
        <div className="hf-mom-strat-row">
          <label className="hf-jf-help" htmlFor={id("strat-criterion")}>
            ≥N per criterion
          </label>
          <input
            id={id("strat-criterion")}
            className="hf-input"
            type="number"
            min={0}
            value={strat.perCriterion ?? 0}
            disabled={disabled}
            data-testid={tid("strat-criterion")}
            onChange={(e) =>
              patchStrat({ perCriterion: clampInt(Number(e.target.value), 0) })
            }
          />
          <label className="hf-jf-help" htmlFor={id("strat-lo")}>
            ≥N per LO
          </label>
          <input
            id={id("strat-lo")}
            className="hf-input"
            type="number"
            min={0}
            value={strat.perLO ?? 0}
            disabled={disabled}
            data-testid={tid("strat-lo")}
            onChange={(e) =>
              patchStrat({ perLO: clampInt(Number(e.target.value), 0) })
            }
          />
        </div>
      </div>
    </div>
  );
}
