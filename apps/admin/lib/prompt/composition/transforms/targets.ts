/**
 * Behavior Target Transforms
 * Extracted from route.ts lines 364-443, 1364-1384, 1758-1771
 */

import { registerTransform } from "../TransformRegistry";
import { classifyValue } from "../types";
import type { AssembledContext, BehaviorTargetData, CallerTargetData, CompositionSectionDef } from "../types";
import { config } from "@/lib/config";

/** Normalized target type that works for both CallerTarget and BehaviorTarget */
export interface NormalizedTarget {
  parameterId: string;
  targetValue: number;
  confidence: number;
  source: "CallerTarget" | "BehaviorTarget";
  scope: string;
  parameter: {
    name: string | null;
    interpretationLow: string | null;
    interpretationHigh: string | null;
    domainGroup: string | null;
  } | null;
}

/**
 * Merge CallerTargets + BehaviorTargets with scope priority,
 * then group by domainGroup.
 *
 * For first-call (isFirstCall=true), injects INIT-001 defaults
 * for any parameters that don't have targets yet.
 */
registerTransform("mergeAndGroupTargets", (
  rawData: { behaviorTargets: BehaviorTargetData[]; callerTargets: CallerTargetData[] },
  context: AssembledContext,
  _sectionDef: CompositionSectionDef,
) => {
  const { behaviorTargets, callerTargets } = rawData;
  const playbooks = context.loadedData.playbooks;
  const { isFirstCall } = context.sharedState;
  const onboardingSpec = context.loadedData.onboardingSpec;

  // Merge with priority: CallerTarget > PLAYBOOK > DOMAIN > SYSTEM
  // Pass all stacked playbook IDs - targets from any stacked playbook apply
  const playbookIds = playbooks.map(pb => pb.id);
  let merged = mergeTargets(behaviorTargets, callerTargets, playbookIds);

  // ONBOARDING: Inject first-call defaults for missing parameters
  // Priority: Domain.onboardingDefaultTargets > INIT-001 fallback
  if (isFirstCall) {
    const existingParams = new Set(merged.map(t => t.parameterId));

    // Try Domain onboarding defaults first
    const domain = context.loadedData.caller?.domain;
    const domainDefaults = domain?.onboardingDefaultTargets as Record<string, { value: number; confidence: number; rationale?: string }> | null;

    // Fall back to INIT-001 spec defaults if domain doesn't have custom defaults
    const defaultTargets = domainDefaults || onboardingSpec?.config?.defaultTargets;
    const source = domainDefaults ? `Domain ${domain?.slug}` : config.specs.onboarding;

    if (defaultTargets) {
      for (const [paramId, defaults] of Object.entries(defaultTargets)) {
        if (paramId.startsWith("_")) continue; // Skip metadata keys (e.g. _matrixPositions)
        if (!existingParams.has(paramId)) {
          merged.push({
            parameterId: paramId,
            targetValue: defaults.value,
            confidence: defaults.confidence,
            source: "BehaviorTarget",
            scope: domainDefaults ? "DOMAIN_ONBOARDING" : "INIT_DEFAULT",
            parameter: {
              name: paramId.replace("BEH-", "").replace(/-/g, " ").toLowerCase(),
              interpretationLow: null,
              interpretationHigh: null,
              domainGroup: "First Call Defaults",
            },
          });
        }
      }
      console.log(`[targets] First call: injected ${Object.keys(defaultTargets).length - existingParams.size} defaults from ${source}`);
    }
  }

  // Apply preview overrides if provided (for Playground tuning)
  const targetOverrides = (context.specConfig?.targetOverrides || {}) as Record<string, number>;
  if (Object.keys(targetOverrides).length > 0) {
    for (const t of merged) {
      if (t.parameterId in targetOverrides) {
        t.targetValue = targetOverrides[t.parameterId];
        t.scope = "PREVIEW"; // Mark as preview override
      }
    }
  }

  const { thresholds } = context.sharedState;

  // Group by domain
  const byDomain: Record<string, Array<{
    parameterId: string;
    name: string;
    targetValue: number;
    targetLevel: string;
    interpretationHigh: string | null;
    interpretationLow: string | null;
  }>> = {};

  for (const t of merged) {
    const domain = t.parameter?.domainGroup || "Other";
    if (!byDomain[domain]) byDomain[domain] = [];
    byDomain[domain].push({
      parameterId: t.parameterId,
      name: t.parameter?.name || t.parameterId,
      targetValue: t.targetValue,
      targetLevel: classifyValue(t.targetValue, thresholds) || "MODERATE",
      interpretationHigh: t.parameter?.interpretationHigh || null,
      interpretationLow: t.parameter?.interpretationLow || null,
    });
  }

  return {
    totalCount: merged.length,
    byDomain,
    all: merged.map((t) => ({
      parameterId: t.parameterId,
      name: t.parameter?.name || t.parameterId,
      targetValue: t.targetValue,
      targetLevel: classifyValue(t.targetValue, thresholds),
      scope: t.scope,
      when_high: t.parameter?.interpretationHigh,
      when_low: t.parameter?.interpretationLow,
    })),
    // Store merged list for other transforms
    _merged: merged,
  };
});

/**
 * Merge CallerTargets with BehaviorTargets using scope priority.
 * Supports stacked playbooks - targets from any stacked playbook apply.
 */
export function mergeTargets(
  behaviorTargets: BehaviorTargetData[],
  callerTargets: CallerTargetData[],
  playbookIds: string[],
): NormalizedTarget[] {
  const byParameter = new Map<string, NormalizedTarget>();
  const playbookIdSet = new Set(playbookIds);

  // CallerTargets first (highest priority)
  for (const ct of callerTargets) {
    byParameter.set(ct.parameterId, {
      parameterId: ct.parameterId,
      targetValue: ct.targetValue,
      confidence: ct.confidence,
      source: "CallerTarget",
      scope: "CALLER_PERSONALIZED",
      parameter: ct.parameter,
    });
  }

  const scopePriority: Record<string, number> = {
    CALLER: 4,
    PLAYBOOK: 3,
    DOMAIN: 2,
    SYSTEM: 1,
  };

  // Fill in with BehaviorTargets for missing parameters
  for (const target of behaviorTargets) {
    if (byParameter.has(target.parameterId) && byParameter.get(target.parameterId)?.source === "CallerTarget") {
      continue;
    }

    const existing = byParameter.get(target.parameterId);
    const currentPriority = scopePriority[target.scope] || 0;
    const existingPriority = existing ? (scopePriority[existing.scope] || 0) : 0;

    if (target.scope === "PLAYBOOK" && playbookIdSet.size > 0) {
      // Include targets from ANY stacked playbook
      if (target.playbookId && playbookIdSet.has(target.playbookId) && currentPriority > existingPriority) {
        byParameter.set(target.parameterId, {
          parameterId: target.parameterId,
          targetValue: target.targetValue,
          confidence: target.confidence,
          source: "BehaviorTarget",
          scope: target.scope,
          parameter: target.parameter,
        });
      }
    } else if (target.scope !== "PLAYBOOK" && currentPriority > existingPriority) {
      byParameter.set(target.parameterId, {
        parameterId: target.parameterId,
        targetValue: target.targetValue,
        confidence: target.confidence,
        source: "BehaviorTarget",
        scope: target.scope,
        parameter: target.parameter,
      });
    }
  }

  return Array.from(byParameter.values());
}
