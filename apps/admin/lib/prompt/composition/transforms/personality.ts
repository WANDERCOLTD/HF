/**
 * Personality Transforms - FULLY DYNAMIC
 * NO HARDCODING - All personality/trait data comes from database
 *
 * Extracted from route.ts lines 1671-1725, 2017-2075
 * Rewritten Feb 2026 to be data-driven
 */

import { registerTransform } from "../TransformRegistry";
import { classifyValue } from "../types";
import type { AssembledContext, PersonalityData } from "../types";

/**
 * Map personality data into structured traits with scores, levels, descriptions.
 * Returns the personality section for llmPrompt.
 *
 * FULLY DYNAMIC - works with ANY personality parameters from database
 */
registerTransform("mapPersonalityTraits", (
  rawData: PersonalityData | null,
  context: AssembledContext,
) => {
  if (!rawData) return null;

  const personality = rawData;
  const { thresholds } = context.sharedState;

  // Build dynamic traits object from all parameterValues
  const traits: Record<string, {
    score: number | null;
    level: string | null;
    parameterId?: string;
  }> = {};

  // Process ALL parameters dynamically (not just Big Five!)
  for (const [key, value] of Object.entries(personality)) {
    // Skip non-parameter fields
    if (['preferredTone', 'preferredLength', 'technicalLevel', 'confidenceScore', 'lastUpdatedAt'].includes(key)) {
      continue;
    }

    if (typeof value === 'number' || value === null) {
      traits[key] = {
        score: value,
        level: value !== null ? classifyValue(value, thresholds) : null,
        parameterId: key,
      };
    }
  }

  return {
    traits,
    preferences: {
      tone: personality.preferredTone,
      responseLength: personality.preferredLength,
      technicalLevel: personality.technicalLevel,
    },
    confidence: personality.confidenceScore,
    parameterCount: Object.keys(traits).length,
  };
});

/**
 * Compute personality-based adaptation instructions.
 * Used by the instructions transform.
 *
 * FULLY DYNAMIC - adapts to ANY personality parameters from database
 */
export function computePersonalityAdaptation(
  personality: PersonalityData | null,
  thresholds: { high: number; low: number },
): string[] {
  if (!personality) {
    return ["No personality data available - observe and adapt during conversation"];
  }

  const adaptations: string[] = [];

  // Process ALL personality parameters dynamically
  for (const [key, value] of Object.entries(personality)) {
    // Skip non-parameter fields
    if (['preferredTone', 'preferredLength', 'technicalLevel', 'confidenceScore', 'lastUpdatedAt'].includes(key)) {
      continue;
    }

    if (typeof value !== 'number' || value === null) continue;

    // Generate adaptation based on parameter value relative to thresholds
    const paramLabel = key.replace(/_/g, ' ').replace(/^b5-/i, '').replace(/^pers-/i, '').toUpperCase();

    if (value >= thresholds.high) {
      adaptations.push(`HIGH ${paramLabel}: Lean into this trait - value is ${(value * 100).toFixed(0)}%`);
    } else if (value <= thresholds.low) {
      adaptations.push(`LOW ${paramLabel}: Accommodate this trait - value is ${(value * 100).toFixed(0)}%`);
    }
    // Skip moderate values to keep adaptations concise
  }

  return adaptations.length > 0
    ? adaptations
    : ["No strong personality traits detected - use balanced approach"];
}

/**
 * #2083 (epic #2078 S1) — Big Five → personality-adaptation directives.
 *
 * Wires the 5 producer-only `BEH-*-ADAPTATION` parameters into the compose
 * read path. For each ADAPTATION param, look up the matching Big Five score
 * from `CallerPersonalityProfile.parameterValues` (EMA 30d half-life) and
 * emit a strong directive citing the parameter's
 * `interpretationHigh` / `interpretationLow` text.
 *
 * The 5 wired parameters:
 *   - BEH-OPENNESS-ADAPTATION         ← caller's BEH-B5-O
 *   - BEH-CONSCIENTIOUSNESS-ADAPTATION ← caller's BEH-B5-C
 *   - BEH-EXTRAVERSION-ADAPTATION     ← caller's BEH-B5-E
 *   - BEH-AGREEABLENESS-ADAPTATION    ← caller's BEH-B5-A
 *   - BEH-NEUROTICISM-ADAPTATION      ← caller's BEH-B5-N
 *
 * The Big Five cascade already aggregates per call into
 * `CallerPersonalityProfile.parameterValues`. The 5 ADAPTATION rows describe
 * HOW the tutor adapts when the caller is HIGH or LOW on the corresponding
 * trait. This function closes the read side of that pairing.
 *
 * Per `parameter-coverage.md`: the explicit ID strings below are what the
 * coverage regex matches against — do not collapse to a loop variable
 * derived from `BIG_FIVE_ADAPTATIONS` keys (the regex won't see the IDs).
 */

interface BehaviorTargetLike {
  parameterId?: string | null;
  targetValue?: number | null;
  parameter?: {
    parameterId?: string | null;
    interpretationHigh?: string | null;
    interpretationLow?: string | null;
    name?: string | null;
  } | null;
}

const BIG_FIVE_ADAPTATIONS: ReadonlyArray<{
  adaptationParamId:
    | "BEH-OPENNESS-ADAPTATION"
    | "BEH-CONSCIENTIOUSNESS-ADAPTATION"
    | "BEH-EXTRAVERSION-ADAPTATION"
    | "BEH-AGREEABLENESS-ADAPTATION"
    | "BEH-NEUROTICISM-ADAPTATION";
  bigFiveParamId: "BEH-B5-O" | "BEH-B5-C" | "BEH-B5-E" | "BEH-B5-A" | "BEH-B5-N";
  // Friendly label for the directive prefix.
  traitLabel: string;
}> = [
  { adaptationParamId: "BEH-OPENNESS-ADAPTATION",         bigFiveParamId: "BEH-B5-O", traitLabel: "openness" },
  { adaptationParamId: "BEH-CONSCIENTIOUSNESS-ADAPTATION", bigFiveParamId: "BEH-B5-C", traitLabel: "conscientiousness" },
  { adaptationParamId: "BEH-EXTRAVERSION-ADAPTATION",     bigFiveParamId: "BEH-B5-E", traitLabel: "extraversion" },
  { adaptationParamId: "BEH-AGREEABLENESS-ADAPTATION",    bigFiveParamId: "BEH-B5-A", traitLabel: "agreeableness" },
  { adaptationParamId: "BEH-NEUROTICISM-ADAPTATION",      bigFiveParamId: "BEH-B5-N", traitLabel: "neuroticism" },
];

/**
 * Look up the caller's B5 trait score from the `personality` snapshot.
 *
 * Loader at `SectionDataLoader.ts::personality` flattens
 * `CallerPersonalityProfile.parameterValues` (`{ "BEH-B5-O": 0.74, ... }`)
 * spread onto the returned object. So `personality["BEH-B5-O"]` works
 * directly when the key is present.
 *
 * Older callers may have only the legacy `openness` / `extraversion` /
 * etc. fields populated (the `CallerPersonality` table, pre-rebuild).
 * Fall back to those when the canonical ID isn't found.
 */
function readBigFive(
  personality: PersonalityData,
  bigFiveParamId: string,
  legacyFieldName: string,
): number | null {
  // `personality` is the merged shape from `SectionDataLoader.ts::personality`
  // — `CallerPersonalityProfile.parameterValues` (Record<string, number>)
  // spread onto the legacy `CallerPersonality` columns. PersonalityData
  // only types the legacy columns; the dynamic parameterValues keys are
  // accessed via an unknown-cast.
  const bag = personality as unknown as Record<string, unknown>;
  const raw = bag[bigFiveParamId];
  if (typeof raw === "number") return raw;
  const legacy = bag[legacyFieldName];
  return typeof legacy === "number" ? legacy : null;
}

/**
 * Map the 5 ADAPTATION param IDs to their legacy `CallerPersonality` field
 * name (used as a fallback when the canonical `BEH-B5-*` key isn't on the
 * loaded personality snapshot).
 */
const LEGACY_FIELD_MAP: Record<string, string> = {
  "BEH-B5-O": "openness",
  "BEH-B5-C": "conscientiousness",
  "BEH-B5-E": "extraversion",
  "BEH-B5-A": "agreeableness",
  "BEH-B5-N": "neuroticism",
};

export function computePersonalityAdaptationDirectives(
  personality: PersonalityData | null,
  mergedTargets: ReadonlyArray<BehaviorTargetLike>,
  thresholds: { high: number; low: number },
): string[] {
  if (!personality) return [];

  // Index merged BehaviorTargets by parameterId so we can pull the
  // operator-tuned target value + the parameter's canonical
  // interpretationHigh / interpretationLow rationale text.
  const targetByParam = new Map<string, BehaviorTargetLike>();
  for (const t of mergedTargets) {
    const id = t.parameterId ?? t.parameter?.parameterId ?? null;
    if (id) targetByParam.set(id, t);
  }

  const directives: string[] = [];

  for (const map of BIG_FIVE_ADAPTATIONS) {
    const b5Score = readBigFive(
      personality,
      map.bigFiveParamId,
      LEGACY_FIELD_MAP[map.bigFiveParamId] ?? "",
    );
    if (b5Score === null) continue;

    const target = targetByParam.get(map.adaptationParamId);
    const interpretationHigh = target?.parameter?.interpretationHigh ?? null;
    const interpretationLow = target?.parameter?.interpretationLow ?? null;

    // Three-way classification against the same thresholds the rest of the
    // composer uses. Only HIGH / LOW push a strong directive; MODERATE is
    // intentionally silent to keep the personality_adaptation list concise
    // (matches the legacy behaviour of `computePersonalityAdaptation`).
    if (b5Score >= thresholds.high) {
      const rationale = interpretationHigh
        ? ` — ${interpretationHigh}`
        : "";
      directives.push(
        `HIGH ${map.traitLabel} (${(b5Score * 100).toFixed(0)}%): adopt the high-${map.traitLabel} adaptation${rationale}.`,
      );
    } else if (b5Score <= thresholds.low) {
      const rationale = interpretationLow
        ? ` — ${interpretationLow}`
        : "";
      directives.push(
        `LOW ${map.traitLabel} (${(b5Score * 100).toFixed(0)}%): adopt the low-${map.traitLabel} adaptation${rationale}.`,
      );
    }
  }

  return directives;
}
