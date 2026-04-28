/**
 * Auto-inject structural and survey stops into a lesson plan.
 *
 * Reads SESSION_TYPES_V1 contract for `autoInclude` positions and injects
 * stops that aren't already present.
 *
 * Idempotent: strips existing auto-include stops before re-inserting.
 */

import type { PlaybookConfig } from "@/lib/types/json-fields";
import { isPreSurveyEnabled } from "@/lib/learner/survey-config";
import { getSessionTypeConfig, type SessionTypeEntry } from "./session-ui";

/** Minimal entry shape — compatible with both wizard and PUT route entry types. */
export interface PlanEntry {
  session: number;
  type: string;
  label?: string;
  moduleId?: string | null;
  moduleLabel?: string;
  estimatedDurationMins?: number;
  isOptional?: boolean;
  [key: string]: any;
}

/** Create a structural/survey stop entry. */
function makeStop(typeDef: SessionTypeEntry, overrides?: Partial<PlanEntry>): PlanEntry {
  return {
    session: 0, // renumbered later
    type: typeDef.value,
    moduleId: null,
    moduleLabel: "",
    label: typeDef.educatorLabel || typeDef.label,
    estimatedDurationMins: typeDef.category === "survey" ? 2 : undefined,
    isOptional: typeDef.canSkip,
    ...overrides,
  };
}

/**
 * Inject auto-include stops into a lesson plan.
 *
 * Survey gating:
 *   - pre_survey  → derived from `welcome.{goals,aboutYou,knowledgeCheck}` via
 *     `isPreSurveyEnabled`. The legacy `surveys.pre.enabled` field is no longer
 *     consulted (it is computed-only and any stored value is ignored).
 *   - post_survey → still gated by the legacy `surveys.post.enabled` field.
 *     There is no welcome-side mirror for post-survey at present.
 *
 * @param entries - Teaching session entries (may already contain structural stops)
 * @param pbConfig - Playbook config (welcome + surveys.post drive gating)
 * @returns New array with structural + survey stops injected, renumbered sequentially
 */
export async function applyAutoIncludeStops(
  entries: PlanEntry[],
  pbConfig?: PlaybookConfig | null,
): Promise<PlanEntry[]> {
  const config = await getSessionTypeConfig();
  const typeMap = new Map(config.types.map((t) => [t.value, t]));

  // Collect all types that have autoInclude set
  const autoTypes = config.types.filter((t) => t.autoInclude !== null);
  const autoTypeValues = new Set(autoTypes.map((t) => t.value));

  // Strip existing auto-include stops (idempotency)
  const teaching = entries.filter((e) => !autoTypeValues.has(e.type));

  // Determine which auto-include stops to inject
  const beforeFirst: PlanEntry[] = [];
  const first: PlanEntry[] = [];
  const last: PlanEntry[] = [];
  const afterLast: PlanEntry[] = [];

  const preEnabled = isPreSurveyEnabled(pbConfig ?? null);
  const postEnabled = pbConfig?.surveys?.post?.enabled ?? false;

  for (const typeDef of autoTypes) {
    // Survey stops are gated by playbook config
    if (typeDef.category === "survey") {
      if (typeDef.value === "pre_survey" && !preEnabled) continue;
      if (typeDef.value === "post_survey" && !postEnabled) continue;
    }

    switch (typeDef.autoInclude) {
      case "before_first": beforeFirst.push(makeStop(typeDef)); break;
      case "first": first.push(makeStop(typeDef)); break;
      case "last": last.push(makeStop(typeDef)); break;
      case "after_last": afterLast.push(makeStop(typeDef)); break;
    }
  }

  // Assemble: before_first → first → teaching → last → after_last
  const result: PlanEntry[] = [...beforeFirst, ...first, ...teaching];

  result.push(...last, ...afterLast);

  // Renumber all entries sequentially
  result.forEach((e, i) => { e.session = i + 1; });

  return result;
}
