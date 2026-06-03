/**
 * adapt-runner.ts
 *
 * Generic ADAPT phase runner that reads ADAPT specs and applies adaptation rules.
 * Reads learner profile from CallerAttribute and writes adjusted targets to CallerTarget.
 *
 * Contract-based - NO HARDCODING of profile keys or parameters.
 * Supports flexible condition operators: eq, gt, gte, lt, lte, between, in.
 * Confidence and data source are spec-configurable.
 */

import { prisma } from "@/lib/prisma";
import { getLearnerProfile } from "@/lib/learner/profile";
import type { SpecConfig } from "@/lib/types/json-fields";

// === Condition Interface (backward-compatible) ===

export interface AdaptCondition {
  profileKey: string;
  /** Comparison operator. Defaults to "eq" when omitted (backward compat). */
  operator?: "eq" | "gt" | "gte" | "lt" | "lte" | "between" | "in";
  /** Exact match value (for "eq" — the legacy format). */
  value?: string | number;
  /** Numeric threshold (for gt/gte/lt/lte). */
  threshold?: number;
  /** Range bounds (for "between"). */
  range?: { min: number; max: number };
  /** Allowed values (for "in"). */
  values?: (string | number)[];
  /** Data source for the profile value. Defaults to "learnerProfile". */
  dataSource?: "learnerProfile" | "parameterValues";
}

export interface AdaptationRule {
  condition: AdaptCondition;
  actions: AdaptationAction[];
}

interface AdaptationAction {
  targetParameter: string;
  adjustment: "set" | "increase" | "decrease";
  value?: number;
  delta?: number;
  rationale: string;
}

interface AdaptParameter {
  id: string;
  config: {
    adaptationRules: AdaptationRule[];
  };
}

/**
 * Evaluate a condition against a profile value.
 * Exported for testability.
 */
export function evaluateCondition(
  condition: AdaptCondition,
  profileValue: string | number | null,
): boolean {
  if (profileValue === null || profileValue === undefined) return false;

  const op = condition.operator || "eq";

  switch (op) {
    case "eq":
      return profileValue === (condition.value ?? condition.threshold);

    case "gt":
      return typeof profileValue === "number" && profileValue > (condition.threshold ?? 0);

    case "gte":
      return typeof profileValue === "number" && profileValue >= (condition.threshold ?? 0);

    case "lt":
      return typeof profileValue === "number" && profileValue < (condition.threshold ?? 0);

    case "lte":
      return typeof profileValue === "number" && profileValue <= (condition.threshold ?? 0);

    case "between": {
      if (!condition.range) return false;
      return (
        typeof profileValue === "number" &&
        profileValue >= condition.range.min &&
        profileValue <= condition.range.max
      );
    }

    case "in":
      return (condition.values || []).includes(profileValue);

    default:
      return false;
  }
}

/**
 * Run all ADAPT specs for a caller.
 * Reads learner profile and applies adaptation rules to behavior targets.
 */
export async function runAdaptSpecs(callerId: string): Promise<{
  specsRun: number;
  targetsCreated: number;
  targetsUpdated: number;
  rulesEvaluated: number;
  rulesFired: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let specsRun = 0;
  let targetsCreated = 0;
  let targetsUpdated = 0;
  let rulesEvaluated = 0;
  let rulesFired = 0;

  try {
    // Get all active ADAPT specs
    const adaptSpecs = await prisma.analysisSpec.findMany({
      where: {
        outputType: "ADAPT",
        isActive: true,
      },
    });

    if (adaptSpecs.length === 0) {
      return { specsRun: 0, targetsCreated: 0, targetsUpdated: 0, rulesEvaluated: 0, rulesFired: 0, errors: [] };
    }

    // Get learner profile
    const learnerProfile = await getLearnerProfile(callerId);

    // Pre-load parameterValues for conditions that use that data source
    let parameterValues: Record<string, number> = {};
    const needsParamValues = adaptSpecs.some((spec) => {
      const config = spec.config as SpecConfig;
      const parameters: AdaptParameter[] = config?.parameters || [];
      return parameters.some((p) =>
        p.config?.adaptationRules?.some(
          (r: AdaptationRule) => r.condition.dataSource === "parameterValues",
        ),
      );
    });

    if (needsParamValues) {
      const profile = await prisma.callerPersonalityProfile.findUnique({
        where: { callerId },
        select: { parameterValues: true },
      });
      parameterValues = (profile?.parameterValues as Record<string, number>) || {};
    }

    // Run each ADAPT spec
    for (const spec of adaptSpecs) {
      try {
        const config = spec.config as SpecConfig;
        const parameters: AdaptParameter[] = config?.parameters || [];
        // Read confidence from spec config (not hardcoded).
        // TODO(ai-guard) — #1008: the `?? 0.8` fires when an ADAPT-* spec
        // omits `defaultAdaptConfidence`. Educators authoring new specs may
        // assume the default is sourced from GUARD-001 confidenceBounds;
        // it is not. Either route through `guardrails.confidenceBounds.
        // defaultConfidence` for cross-spec consistency, or document that
        // ADAPT confidence is opt-out per-spec.
        const defaultConfidence = config?.defaultAdaptConfidence ?? 0.8;

        // Find parameters with adaptationRules
        for (const param of parameters) {
          if (param.config?.adaptationRules) {
            const result = await applyAdaptationRules(
              callerId,
              spec.slug,
              learnerProfile,
              parameterValues,
              param.config.adaptationRules,
              defaultConfidence,
            );

            targetsCreated += result.created;
            targetsUpdated += result.updated;
            rulesEvaluated += result.evaluated;
            rulesFired += result.fired;
          }
        }

        specsRun++;
      } catch (error: any) {
        errors.push(`Error running spec ${spec.slug}: ${error.message}`);
      }
    }

    return { specsRun, targetsCreated, targetsUpdated, rulesEvaluated, rulesFired, errors };
  } catch (error: any) {
    errors.push(`Error in runAdaptSpecs: ${error.message}`);
    return { specsRun, targetsCreated, targetsUpdated, rulesEvaluated, rulesFired, errors };
  }
}

/**
 * Apply adaptation rules from a spec parameter.
 */
async function applyAdaptationRules(
  callerId: string,
  specSlug: string,
  learnerProfile: any,
  parameterValues: Record<string, number>,
  rules: AdaptationRule[],
  defaultConfidence: number,
): Promise<{ created: number; updated: number; evaluated: number; fired: number }> {
  let created = 0;
  let updated = 0;
  let evaluated = 0;
  let fired = 0;

  for (const rule of rules) {
    evaluated++;

    // Resolve profile value from the appropriate data source
    let profileValue: string | number | null;
    if (rule.condition.dataSource === "parameterValues") {
      profileValue = parameterValues[rule.condition.profileKey] ?? null;
    } else {
      profileValue = getProfileValue(learnerProfile, rule.condition.profileKey);
    }

    // Evaluate using the flexible condition system
    if (!evaluateCondition(rule.condition, profileValue)) {
      continue; // Condition not met
    }

    fired++;
    console.log(
      `[adapt-runner] ${specSlug}: rule fired — ${rule.condition.profileKey} ${rule.condition.operator || "eq"} (value: ${profileValue}) → ${rule.actions.length} actions`,
    );

    // Condition met - apply all actions
    for (const action of rule.actions) {
      try {
        // Validate parameter exists
        const parameter = await prisma.parameter.findUnique({
          where: { parameterId: action.targetParameter },
        });

        if (!parameter) {
          console.warn(`[adapt-runner] Parameter not found: ${action.targetParameter}`);
          continue;
        }

        // Get current target value (if exists)
        const existingTarget = await prisma.callerTarget.findUnique({
          where: {
            callerId_parameterId: {
              callerId,
              parameterId: action.targetParameter,
            },
          },
        });

        // Compute target value based on adjustment method.
        //
        // TODO(ai-guard) — #1008 Finding A (TL audit): the four `?? 0.5` /
        // `?? 0.1` fallbacks below silently write fabricated values to
        // `CallerTarget.targetValue` whenever the ADAPT-* spec author omits
        // `action.value` or `action.delta`. Same anti-pattern class as the
        // pipeline-route `masteryThreshold: 0.7` literals (fixed in this
        // PR) and #605 `categoryToTeachMethod`'s `recall_quiz` fallback.
        // Risk: corrupt per-caller targets propagate into the next compose
        // → next call → next AGGREGATE → next adaptation cycle, invisible
        // to the educator. Proper fix: validate the rule shape at spec
        // load time and refuse to fire actions that don't declare the
        // required field for their adjustment method. See child issue
        // linked from #1008.
        let targetValue: number;
        if (action.adjustment === "set") {
          targetValue = action.value ?? 0.5;
        } else if (action.adjustment === "increase") {
          const currentValue = existingTarget?.targetValue ?? 0.5;
          targetValue = Math.min(1.0, currentValue + (action.delta ?? 0.1));
        } else if (action.adjustment === "decrease") {
          const currentValue = existingTarget?.targetValue ?? 0.5;
          targetValue = Math.max(0.0, currentValue - (action.delta ?? 0.1));
        } else {
          targetValue = 0.5;
        }

        // Clamp to [0, 1]
        targetValue = Math.max(0.0, Math.min(1.0, targetValue));

        // Write to CallerTarget (confidence from spec config)
        await prisma.callerTarget.upsert({
          where: {
            callerId_parameterId: {
              callerId,
              parameterId: action.targetParameter,
            },
          },
          create: {
            callerId,
            parameterId: action.targetParameter,
            targetValue,
            confidence: defaultConfidence,
          },
          update: {
            targetValue,
            confidence: defaultConfidence,
          },
        });

        if (existingTarget) {
          updated++;
        } else {
          created++;
        }
      } catch (error: any) {
        console.error(`[adapt-runner] Error applying action for ${action.targetParameter}:`, error);
      }
    }
  }

  return { created, updated, evaluated, fired };
}

/**
 * Get profile value by key (camelCase or snake_case).
 * Maps between profile object keys and contract keys.
 */
function getProfileValue(profile: any, key: string): string | number | null {
  if (!profile) return null;

  // Direct key match
  if (profile[key] !== undefined && profile[key] !== null) {
    return profile[key];
  }

  // Try camelCase conversion
  const camelKey = toCamelCase(key);
  if (profile[camelKey] !== undefined && profile[camelKey] !== null) {
    return profile[camelKey];
  }

  // Try snake_case conversion
  const snakeKey = toSnakeCase(key);
  if (profile[snakeKey] !== undefined && profile[snakeKey] !== null) {
    return profile[snakeKey];
  }

  return null;
}

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function toSnakeCase(str: string): string {
  return str.replace(/([A-Z])/g, "_$1").toLowerCase();
}
