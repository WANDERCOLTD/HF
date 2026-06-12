/**
 * Keeps the parameter -> AnalysisSpec mapping that
 * `lib/pipeline/specs-loader.ts::batchLoadParameters` drops.
 *
 * #1539 — the existing `batchLoadParameters` returns
 * `Map<parameterId, {parameterId, name, definition}>`, losing the spec
 * association entirely. This loader returns the same shape PLUS the
 * authoritative spec id, slug, and `promptTemplate` so the batched
 * prompt builder can inject the rubric and `writeCallScore` can stamp
 * `analysisSpecId`.
 *
 * ## Multi-spec collision rule
 *
 * A single parameter could in theory receive writes from multiple
 * MEASURE specs (e.g. a generic personality spec and a domain-overlay
 * one). Today every production parameter maps 1:1 to exactly one
 * MEASURE spec — verified via `tests/lib/measurement/parameter-spec-map.test.ts`
 * fixtures. The loader prefers the highest-`priority` spec on collision
 * and logs a warning; the ADR's revisit triggers say to add a join
 * table if this stops being 1:1 in practice.
 */

import type { AnalysisSpec, AnalysisTrigger, AnalysisAction } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/** Per-parameter view that carries spec lineage. */
export interface ParameterWithSpec {
  parameterId: string;
  name: string;
  definition: string | null;
  /** The `AnalysisSpec.id` whose rubric scores this parameter. Always
   *  present — the loader skips parameters whose owning spec is missing
   *  rather than emit a partial row. */
  analysisSpecId: string;
  specSlug: string;
  /** The rubric body. `null` when the spec has no `promptTemplate` set
   *  (legacy / under-specced spec). The prompt builder logs a
   *  `[measure] unspecced parameter` warning when this is null. */
  promptTemplate: string | null;
  /** Higher = wins collisions. */
  specPriority: number;
}

type SpecWithTriggers = AnalysisSpec & {
  triggers: Array<AnalysisTrigger & { actions: AnalysisAction[] }>;
};

/**
 * Build the parameter -> spec map from a list of fully-loaded MEASURE
 * specs (i.e. specs already loaded with `include: { triggers: { include:
 * { actions: true } } }`).
 *
 * Returns a `Map` keyed by `parameterId`. Parameters that don't resolve
 * to any spec are omitted entirely (a parameter with no spec cannot be
 * written via `writeCallScore` anyway — it has no lineage to stamp).
 */
export async function buildParameterSpecMap(
  specs: SpecWithTriggers[],
  options: { log?: (msg: string, meta?: Record<string, unknown>) => void } = {},
): Promise<Map<string, ParameterWithSpec>> {
  const log = options.log ?? (() => undefined);

  const paramToSpec = new Map<string, SpecWithTriggers>();
  const collisions: Array<{ parameterId: string; specSlugs: string[] }> = [];

  for (const spec of specs) {
    for (const trigger of spec.triggers) {
      for (const action of trigger.actions) {
        if (!action.parameterId) continue;

        const existing = paramToSpec.get(action.parameterId);
        if (!existing) {
          paramToSpec.set(action.parameterId, spec);
          continue;
        }
        if (existing.id === spec.id) continue;

        if ((spec.priority ?? 0) > (existing.priority ?? 0)) {
          collisions.push({
            parameterId: action.parameterId,
            specSlugs: [existing.slug, spec.slug],
          });
          paramToSpec.set(action.parameterId, spec);
        } else {
          collisions.push({
            parameterId: action.parameterId,
            specSlugs: [spec.slug, existing.slug],
          });
        }
      }
    }
  }

  if (collisions.length > 0) {
    log(
      `[parameter-spec-map] ${collisions.length} parameter(s) had multi-spec collisions; ` +
        `highest priority wins. See #1539 ADR for the join-table revisit trigger.`,
      { collisions },
    );
  }

  if (paramToSpec.size === 0) {
    return new Map();
  }

  const params = await prisma.parameter.findMany({
    where: { parameterId: { in: Array.from(paramToSpec.keys()) } },
    select: { parameterId: true, name: true, definition: true },
  });

  const out = new Map<string, ParameterWithSpec>();
  for (const param of params) {
    const spec = paramToSpec.get(param.parameterId);
    if (!spec) continue;
    out.set(param.parameterId, {
      parameterId: param.parameterId,
      name: param.name,
      definition: param.definition,
      analysisSpecId: spec.id,
      specSlug: spec.slug,
      promptTemplate: spec.promptTemplate,
      specPriority: spec.priority ?? 0,
    });
  }

  return out;
}
