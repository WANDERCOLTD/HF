"use client";

/**
 * AssessmentPlanBadge — at-a-glance plan resolution status on the
 * Course Overview tab.
 *
 * Reads `Playbook.config.assessmentPlan` (per #2176 S1, PR #2254) and
 * classifies it via the shared resolver at
 * `lib/assessment/classify-plan-resolution.ts`. The same classifier
 * powers the Coverage gate at
 * `tests/lib/assessment/course-assessment-plan-coverage.test.ts`, so
 * the badge and the gate cannot disagree (per
 * `feedback_canonical_source_discipline.md` — derive, don't duplicate).
 *
 * Story: #2176 S13 — AssessmentPlan resolution status badge.
 *
 * ## States surfaced
 *
 * | State    | Banner class              | Headline |
 * |---|---|---|
 * | Resolved | `hf-banner hf-banner-success` | "Assessment plan resolved" |
 * | Partial  | `hf-banner hf-banner-warning` | "Assessment plan partial" + reason list |
 * | No plan  | `hf-banner hf-banner-info`    | "No assessment plan (by design)" |
 * | Missing  | `hf-banner hf-banner-warning` | "Assessment plan not declared" + how to fix |
 *
 * The badge is INFORMATIONAL — it never blocks save / publish. The
 * Coverage gate is the structural backstop at PR time. This is the
 * runtime educator surface so operators can spot drift without
 * navigating to the Scoring tab.
 */

import { classifyPlanResolution } from "@/lib/assessment/classify-plan-resolution";
import type {
  CourseAssessmentPlan,
  PlaybookConfig,
} from "@/lib/types/json-fields";

export interface AssessmentPlanBadgeProps {
  /**
   * The course's `Playbook.config` JSON. The badge reads
   * `assessmentPlan` + `modules` + `firstCallMode` to classify.
   */
  config: PlaybookConfig | null | undefined;
}

const RESOLVED_HEADLINE = "Assessment plan resolved";
const PARTIAL_HEADLINE = "Assessment plan partial";
const NO_PLAN_HEADLINE = "No assessment plan (by design)";
const MISSING_HEADLINE = "Assessment plan not declared";

export function AssessmentPlanBadge({
  config,
}: AssessmentPlanBadgeProps): React.ReactElement {
  const plan: CourseAssessmentPlan | undefined = config?.assessmentPlan;
  const modules = config?.modules ?? [];
  const firstCallMode = config?.firstCallMode;

  // Project the modules to the narrow shape the classifier needs.
  // Skip modules with non-string slugs or modes — the classifier
  // requires AuthoredModuleMode literals and rejects unknown shapes.
  const moduleRefs = modules
    .filter((m) => typeof m.id === "string" && typeof m.mode === "string")
    .map((m) => ({ slug: m.id, mode: m.mode }));

  const status = classifyPlanResolution({
    plan,
    modules: moduleRefs,
    firstCallMode,
    // knownSpecSlugs intentionally omitted — see classifier docs.
    // The Coverage gate enforces spec-slug existence at PR time;
    // the badge runs in the browser without filesystem access.
  });

  if (status.kind === "resolved") {
    return (
      <div
        className="hf-banner hf-banner-success"
        role="status"
        data-testid="assessment-plan-badge-resolved"
      >
        <strong>{RESOLVED_HEADLINE}</strong>
        <span>
          Every declared assessment moment resolves end-to-end (module
          present, mode compatible, intake setting consistent).
        </span>
      </div>
    );
  }

  if (status.kind === "no-plan") {
    return (
      <div
        className="hf-banner hf-banner-info"
        role="status"
        data-testid="assessment-plan-badge-no-plan"
      >
        <strong>{NO_PLAN_HEADLINE}</strong>
        <span>
          This course explicitly opts out of formal assessment moments
          (coaching-led or continuous-only).
        </span>
      </div>
    );
  }

  if (status.kind === "missing") {
    return (
      <div
        className="hf-banner hf-banner-warning"
        role="status"
        data-testid="assessment-plan-badge-missing"
      >
        <strong>{MISSING_HEADLINE}</strong>
        <span>
          The course has no assessment plan declared. Open the Scoring
          tab to declare one, or mark the course as having no formal
          assessment by design.
        </span>
      </div>
    );
  }

  // status.kind === "partial"
  return (
    <div
      className="hf-banner hf-banner-warning hf-banner-column"
      role="status"
      data-testid="assessment-plan-badge-partial"
    >
      <strong>{PARTIAL_HEADLINE}</strong>
      <span>
        The plan is declared but at least one reference doesn&apos;t
        resolve. Fix in the Scoring tab.
      </span>
      <ul className="hf-mt-sm">
        {status.reasons.map((reason, i) => (
          <li key={i}>{reason}</li>
        ))}
      </ul>
    </div>
  );
}
