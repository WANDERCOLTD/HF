/**
 * classify-plan-resolution — single source of truth for
 * CourseAssessmentPlan resolution status.
 *
 * Used by both the build-time Coverage gate
 * (`tests/lib/assessment/course-assessment-plan-coverage.test.ts`)
 * AND the runtime Course Overview badge
 * (`components/overview-tab/AssessmentPlanBadge.tsx`).
 *
 * One source-of-truth so the badge and the gate cannot disagree —
 * per `feedback_canonical_source_discipline.md` (derive, don't
 * duplicate).
 *
 * Story: #2176 S13 — AssessmentPlan resolution status badge.
 *
 * ## Resolution states
 *
 * | State       | Meaning |
 * |---|---|
 * | `resolved`  | Plan declares at least one moment AND every declared moment resolves end-to-end (module exists, mode matches kind, FirstCallMode consistent, spec slug resolves when known). |
 * | `partial`   | Plan declares moments BUT at least one reference is broken (module missing, mode mismatch, FirstCallMode drift, spec slug unknown when corpus provided). |
 * | `no-plan`   | Plan declares `noAssessmentPlan: true` — explicit operator opt-out. |
 * | `missing`   | Neither plan declared nor opt-out — operator hasn't decided. |
 *
 * ## Input shape — keep narrow on purpose
 *
 * The classifier intentionally takes a NARROW input shape (just the
 * fields it inspects) so:
 *   - The badge can construct it from `PlaybookConfig` without
 *     pulling the entire Prisma row.
 *   - The Coverage test can construct it from its curated manifest
 *     without translating to `PlaybookConfig`.
 *   - Unit tests synthesise the shape directly.
 *
 * ## Spec-slug cross-check is OPTIONAL
 *
 * The Coverage gate runs in Node with filesystem access to
 * `docs-archive/bdd-specs/`. It passes `knownSpecSlugs` so unknown
 * slugs classify as `partial`.
 *
 * The badge runs in the browser. It has no filesystem access and
 * leaves `knownSpecSlugs` undefined — the build-time Coverage gate
 * is the enforcer of "every cited spec slug exists in the corpus".
 * The badge's job is the live-data half: module reference + mode
 * compatibility + FirstCallMode consistency + opt-out detection.
 */

import {
  ASSESSMENT_KIND_VALUES,
  LEARNER_SHELL_KIND_VALUES,
  type AssessmentMoment,
  type AuthoredModuleMode,
  type CourseAssessmentPlan,
} from "@/lib/types/json-fields";
import { KIND_MODE_COMPATIBILITY } from "@/lib/assessment/kind-mode-compatibility";

/**
 * Discriminated union returned by {@link classifyPlanResolution}.
 *
 * `partial` carries the per-reason diagnostic list so consumers
 * (badge tooltip / gate failure message) can surface specifics.
 */
export type PlanResolutionStatus =
  | { kind: "resolved" }
  | { kind: "partial"; reasons: string[] }
  | { kind: "no-plan" }
  | { kind: "missing" };

/**
 * The minimal module shape the resolver inspects per moment.
 * Mirrors `AuthoredModule` but only `{slug, mode}` — keep narrow.
 */
export interface PlanModuleRef {
  slug: string;
  mode: AuthoredModuleMode;
}

/** First-call mode mirror — see PlaybookConfig.firstCallMode. */
export type PlanFirstCallMode =
  | "onboarding"
  | "teach_immediately"
  | "baseline_assessment";

/** Input to the pure classifier. */
export interface PlanResolutionInput {
  /** The declared plan from `Playbook.config.assessmentPlan`. May be undefined. */
  plan?: CourseAssessmentPlan;
  /** Modules from `Playbook.config.modules[]`. */
  modules: ReadonlyArray<PlanModuleRef>;
  /** From `Playbook.config.firstCallMode`. */
  firstCallMode?: PlanFirstCallMode;
  /**
   * Optional set of known AnalysisSpec slugs. When provided, an
   * `AssessmentMoment.scoringSpec` not in the set classifies the
   * plan as `partial`. When omitted, scoringSpec existence is NOT
   * checked at this layer — the build-time Coverage gate enforces
   * it instead.
   */
  knownSpecSlugs?: ReadonlySet<string>;
}

/**
 * Walks every declared moment and accumulates reasons it doesn't
 * resolve. Empty array → moment is clean.
 */
function classifyMoment(
  moment: AssessmentMoment,
  modules: ReadonlyArray<PlanModuleRef>,
  knownSpecSlugs: ReadonlySet<string> | undefined,
): string[] {
  const errors: string[] = [];

  // (a) moduleSlug exists in modules[]
  const moduleRef = modules.find((m) => m.slug === moment.moduleSlug);
  if (!moduleRef) {
    errors.push(
      `moment.moduleSlug "${moment.moduleSlug}" not found in modules[]`,
    );
  } else {
    // (b) module.mode is compatible with the moment's kind
    const allowed = KIND_MODE_COMPATIBILITY[moment.kind];
    if (!allowed.includes(moduleRef.mode)) {
      errors.push(
        `moment.kind "${moment.kind}" requires module mode in [${allowed.join(
          ", ",
        )}] but module "${moduleRef.slug}" has mode "${moduleRef.mode}"`,
      );
    }
  }

  // (c) scoringSpec resolves (only when corpus provided)
  if (knownSpecSlugs && !knownSpecSlugs.has(moment.scoringSpec)) {
    errors.push(
      `scoringSpec "${moment.scoringSpec}" not found in known spec slugs`,
    );
  }

  // (d) shellKind is a valid LearnerShellKind
  if (!LEARNER_SHELL_KIND_VALUES.includes(moment.shellKind as never)) {
    errors.push(
      `shellKind "${moment.shellKind}" is not a valid LearnerShellKind`,
    );
  }

  // (e) kind is a valid AssessmentKind (drift guard)
  if (!ASSESSMENT_KIND_VALUES.includes(moment.kind as never)) {
    errors.push(`moment.kind "${moment.kind}" is not a valid AssessmentKind`);
  }

  return errors;
}

/**
 * Pure classifier. Walks the plan, returns a discriminated status.
 *
 * Order of evaluation:
 *   1. `plan` undefined → `missing`.
 *   2. `noAssessmentPlan: true` + concrete moments → `partial`
 *      (contradiction surfaced; gate AND badge agree).
 *   3. `noAssessmentPlan: true` + no moments → `no-plan`.
 *   4. Plan declared but empty (no upfront / midpoints / end) →
 *      `partial` (operator declared the field but no moments).
 *   5. Every moment clean AND FirstCallMode consistent → `resolved`.
 *   6. Otherwise → `partial` with reasons.
 */
export function classifyPlanResolution(
  input: PlanResolutionInput,
): PlanResolutionStatus {
  const { plan, modules, firstCallMode, knownSpecSlugs } = input;

  // Step 1 — no plan declared
  if (!plan) {
    return { kind: "missing" };
  }

  const hasAnyMoment =
    plan.upfront !== undefined ||
    (plan.midpoints !== undefined && plan.midpoints.length > 0) ||
    plan.end !== undefined;

  // Step 2 — contradiction: opt-out AND moments
  if (plan.noAssessmentPlan === true && hasAnyMoment) {
    return {
      kind: "partial",
      reasons: [
        "plan declares noAssessmentPlan:true alongside concrete moments (contradiction)",
      ],
    };
  }

  // Step 3 — explicit opt-out
  if (plan.noAssessmentPlan === true) {
    return { kind: "no-plan" };
  }

  // Step 4 — plan object exists but no moments declared
  if (!hasAnyMoment) {
    return {
      kind: "partial",
      reasons: [
        "plan declared but no upfront / midpoints / end specified (use noAssessmentPlan:true to opt out)",
      ],
    };
  }

  const reasons: string[] = [];

  // FirstCallMode ↔ plan.upfront cross-check
  const hasUpfrontBaseline = plan.upfront?.kind === "upfront-baseline";
  if (firstCallMode === "baseline_assessment" && !hasUpfrontBaseline) {
    reasons.push(
      'firstCallMode is "baseline_assessment" but plan.upfront is missing or not kind "upfront-baseline"',
    );
  }
  if (hasUpfrontBaseline && firstCallMode !== "baseline_assessment") {
    reasons.push(
      `plan.upfront.kind is "upfront-baseline" but firstCallMode is "${
        firstCallMode ?? "(unset)"
      }"`,
    );
  }

  // Walk each moment
  if (plan.upfront) {
    for (const err of classifyMoment(plan.upfront, modules, knownSpecSlugs)) {
      reasons.push(`upfront: ${err}`);
    }
  }
  const midpoints = plan.midpoints ?? [];
  for (let i = 0; i < midpoints.length; i++) {
    const moment = midpoints[i]!;
    for (const err of classifyMoment(moment, modules, knownSpecSlugs)) {
      reasons.push(`midpoints[${i}]: ${err}`);
    }
  }
  if (plan.end) {
    for (const err of classifyMoment(plan.end, modules, knownSpecSlugs)) {
      reasons.push(`end: ${err}`);
    }
  }

  if (reasons.length > 0) {
    return { kind: "partial", reasons };
  }

  return { kind: "resolved" };
}
