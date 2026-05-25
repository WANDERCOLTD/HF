/**
 * Behavior Target Transforms
 * Extracted from route.ts lines 364-443, 1364-1384, 1758-1771
 */

import { registerTransform } from "../TransformRegistry";
import { classifyValue } from "../types";
import type { AssembledContext, BehaviorTargetData, CallerTargetData, CompositionSectionDef } from "../types";
import { config } from "@/lib/config";
import type { AudienceId } from "./audience";
import type { PlaybookConfig } from "@/lib/types/json-fields";

/** Normalized target type that works for both CallerTarget and BehaviorTarget */
export interface NormalizedTarget {
  parameterId: string;
  targetValue: number;
  confidence: number;
  source: "CallerTarget" | "BehaviorTarget";
  scope: string;
  parameter: {
    name: string | null;
    parameterId?: string;
    interpretationLow: string | null;
    interpretationHigh: string | null;
    domainGroup: string | null;
    // #575 — Parameter.config carries `bandThresholds: { [band]: descriptor }`
    // for skill parameters once #564's rubric pass has populated them.
    config?: Record<string, unknown> | null;
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
  // Priority (highest first):
  //   1. Playbook.config.firstSessionTargets — #784 (S6) per-playbook override
  //   2. Domain.onboardingDefaultTargets
  //   3. INIT-001 fallback (onboardingSpec.config.defaultTargets)
  //   4. INIT-001.audienceDefaultTargets — #796 (was hardcoded AUDIENCE_TARGET_DEFAULTS const)
  if (isFirstCall) {
    const existingParams = new Set(merged.map(t => t.parameterId));

    // #784 (S6) — per-playbook first-call BEHAVIOR target overrides at NEW
    // priority 1. Educator-tuned; sits above the domain default cascade.
    // Existing CallerTargets / educator-locked BehaviorTargets are still
    // honoured (they're already in `existingParams` from the merge above),
    // so a learner who has been scored on call 2+ is never reset to
    // first-call defaults — the gate is `isFirstCall === true`.
    const firstSessionTargets = (
      (playbooks?.[0] as { config?: PlaybookConfig })?.config?.firstSessionTargets
    ) as PlaybookConfig["firstSessionTargets"] | undefined;
    if (firstSessionTargets) {
      let playbookFirstSessionInjected = 0;
      for (const [paramId, overrides] of Object.entries(firstSessionTargets)) {
        if (paramId.startsWith("_")) continue;
        if (existingParams.has(paramId)) continue;
        merged.push({
          parameterId: paramId,
          targetValue: overrides.value,
          confidence: overrides.confidence ?? 0.8,
          source: "BehaviorTarget",
          scope: "PLAYBOOK_FIRST_SESSION",
          parameter: {
            name: paramId.replace("BEH-", "").replace(/-/g, " ").toLowerCase(),
            interpretationLow: null,
            interpretationHigh: null,
            domainGroup: "First Call Defaults",
          },
        });
        existingParams.add(paramId);
        playbookFirstSessionInjected++;
      }
      if (playbookFirstSessionInjected > 0) {
        console.log(
          `[targets] First call: injected ${playbookFirstSessionInjected} playbook-level firstSessionTargets (Playbook.config.firstSessionTargets)`,
        );
      }
    }

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

    // Inject audience-aware defaults from INIT-001.audienceDefaultTargets for
    // parameters still missing after domain / INIT-001 defaults (#796 — was
    // hardcoded AUDIENCE_TARGET_DEFAULTS in this file; now educator-tunable via
    // the INIT-001 spec config).
    const audienceDefaults = onboardingSpec?.config?.audienceDefaultTargets;
    if (audienceDefaults) {
      const playbookConfig = (playbooks?.[0] as any)?.config;
      const audience: AudienceId = playbookConfig?.audience || "mixed";
      const updatedExistingParams = new Set(merged.map(t => t.parameterId));
      let audienceInjected = 0;

      for (const [paramId, audienceMap] of Object.entries(audienceDefaults)) {
        if (paramId.startsWith("_")) continue; // skip metadata keys (e.g. _note)
        if (updatedExistingParams.has(paramId)) continue;
        const defaults = audienceMap[audience] || audienceMap.default;
        if (!defaults) continue;

        merged.push({
          parameterId: paramId,
          targetValue: defaults.value,
          confidence: defaults.confidence,
          source: "BehaviorTarget",
          scope: "AUDIENCE_DEFAULT",
          parameter: {
            name: paramId.replace("BEH-", "").replace(/-/g, " ").toLowerCase(),
            interpretationLow: null,
            interpretationHigh: null,
            domainGroup: "Audience Defaults",
          },
        });
        audienceInjected++;
      }

      if (audienceInjected > 0) {
        console.log(`[targets] First call: injected ${audienceInjected} audience-aware defaults (INIT-001.audienceDefaultTargets) for audience=${audience}`);
      }
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
    all: merged.map((t) => {
      // #575 — surface bandThresholds (populated by #564's rubric pass) so the
      // composed prompt can include per-band descriptor reference. Null when
      // the parameter isn't a rubric-backed skill.
      const cfg = (t.parameter?.config ?? null) as Record<string, unknown> | null;
      const bandThresholds = (cfg?.bandThresholds ?? null) as Record<string, string> | null;
      return {
        parameterId: t.parameterId,
        name: t.parameter?.name || t.parameterId,
        targetValue: t.targetValue,
        targetLevel: classifyValue(t.targetValue, thresholds),
        scope: t.scope,
        when_high: t.parameter?.interpretationHigh,
        when_low: t.parameter?.interpretationLow,
        bandThresholds,
      };
    }),
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

  // CallerTargets first (system-managed per-learner state — ADAPT / AGGREGATE
  // / goal tracking write here). Treated as the baseline per-learner value.
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

  // #713 bug 2 — educator-set BehaviorTarget(scope=CALLER, source MANUAL or
  // TUNING_CHAT) must override the system-managed CallerTarget. Pre-fix the
  // CallerTarget always won, which made every Cmd+K tune at LEARNER scope
  // structurally invisible. Manual intent now wins over LEARNED / SEED.
  const isEducatorOverride = (t: BehaviorTargetData) =>
    t.scope === "CALLER" && (t.source === "MANUAL" || t.source === "TUNING_CHAT");

  // First pass: apply educator overrides (highest priority). These win over
  // CallerTargets and over system-set BehaviorTargets alike. Track which
  // parameters were set this way so the second pass can't overwrite them
  // even if a higher-scope system target also exists.
  const lockedByEducator = new Set<string>();
  for (const target of behaviorTargets) {
    if (!isEducatorOverride(target)) continue;
    byParameter.set(target.parameterId, {
      parameterId: target.parameterId,
      targetValue: target.targetValue,
      confidence: target.confidence,
      source: "BehaviorTarget",
      scope: target.scope,
      parameter: target.parameter,
    });
    lockedByEducator.add(target.parameterId);
  }

  // Fill in with remaining BehaviorTargets for missing/lower-priority params.
  for (const target of behaviorTargets) {
    if (isEducatorOverride(target)) continue;  // already applied
    if (lockedByEducator.has(target.parameterId)) continue;  // educator override locks this param
    if (
      byParameter.has(target.parameterId) &&
      byParameter.get(target.parameterId)?.source === "CallerTarget"
    ) {
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
