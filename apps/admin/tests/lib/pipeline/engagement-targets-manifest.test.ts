/**
 * Sub-epic #2086 — engagement-targets-manifest pin.
 *
 * Pins the 13 engagement+onboarding parameter IDs surfaced by survey
 * §5 + §8 (docs/groomed/2078-parameter-coverage-survey.md) against:
 *
 *   1. Symmetric manifest — every ID has a binding row, every binding
 *      row's ID is in the wired list.
 *   2. Registry presence — each ID is a real Parameter row in the
 *      canonical registry (and is active, not deprecated).
 *   3. ADAPT-ENG-001 spec coverage — the new
 *      `engagement_param_wiring_2086` section in ADAPT-ENG-001 cites
 *      every ID with `targetParameter` AND the `condition.profileKey`
 *      matches the manifest binding's expected key.
 *   4. BEH-AGG-001 producer-side coverage — every non-null profileKey
 *      MUST appear as a `targetProfileKey` somewhere in BEH-AGG-001
 *      (else AGGREGATE writes one namespace and ADAPT reads another).
 *
 * Counterpart manifest: lib/pipeline/engagement-targets-manifest.ts
 * Counterpart spec: docs-archive/bdd-specs/ADAPT-ENG-001-engagement-adaptation.spec.json
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  ENGAGEMENT_TARGETS_WIRED_BY_2086,
  ENGAGEMENT_TARGET_BINDINGS,
  lookupEngagementBinding,
  bindingsAreSymmetric,
} from "@/lib/pipeline/engagement-targets-manifest";

const APPS_ADMIN = resolve(__dirname, "..", "..", "..");
const REGISTRY_PATH = join(
  APPS_ADMIN,
  "docs-archive",
  "bdd-specs",
  "behavior-parameters.registry.json",
);
const ADAPT_ENG_PATH = join(
  APPS_ADMIN,
  "docs-archive",
  "bdd-specs",
  "ADAPT-ENG-001-engagement-adaptation.spec.json",
);
const BEH_AGG_PATH = join(
  APPS_ADMIN,
  "docs-archive",
  "bdd-specs",
  "BEH-AGG-001-behavior-aggregation.spec.json",
);

interface RegistryParam {
  parameterId: string;
  domainGroup?: string;
  deprecatedAt?: string;
}
interface Registry {
  parameters: RegistryParam[];
}

interface AdaptAction {
  targetParameter: string;
  adjustment: string;
}
interface AdaptCondition {
  profileKey?: string;
  dataSource?: string;
}
interface AdaptRule {
  condition: AdaptCondition;
  actions: AdaptAction[];
}
interface AdaptParam {
  id: string;
  config?: { adaptationRules?: AdaptRule[] };
}
interface AdaptSpec {
  parameters?: AdaptParam[];
}

interface AggRule {
  sourceParameter?: string;
  targetProfileKey?: string;
}
interface AggParam {
  id: string;
  config?: { aggregationRules?: AggRule[] };
}
interface AggSpec {
  parameters?: AggParam[];
}

const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as Registry;
const adaptEng = JSON.parse(readFileSync(ADAPT_ENG_PATH, "utf8")) as AdaptSpec;
const behAgg = JSON.parse(readFileSync(BEH_AGG_PATH, "utf8")) as AggSpec;

describe("Sub-epic #2086 — engagement targets manifest", () => {
  it("manifest is symmetric — every wired ID has a binding row", () => {
    expect(bindingsAreSymmetric()).toBe(true);
    expect(ENGAGEMENT_TARGETS_WIRED_BY_2086.length).toBe(13);
    expect(ENGAGEMENT_TARGET_BINDINGS.length).toBe(13);
  });

  it("every wired ID is a real, non-deprecated registry parameter", () => {
    const byId = new Map(
      registry.parameters.map((p) => [p.parameterId, p] as const),
    );
    for (const id of ENGAGEMENT_TARGETS_WIRED_BY_2086) {
      const p = byId.get(id);
      expect(p, `missing from registry: ${id}`).toBeDefined();
      expect(p?.deprecatedAt, `deprecated: ${id}`).toBeUndefined();
      expect(
        p?.domainGroup,
        `${id} should be engagement or onboarding domainGroup`,
      ).toMatch(/^(engagement|onboarding)$/);
    }
  });

  it("ADAPT-ENG-001 has the engagement_param_wiring_2086 section", () => {
    const wiringParam = adaptEng.parameters?.find(
      (p) => p.id === "engagement_param_wiring_2086",
    );
    expect(wiringParam, "missing engagement_param_wiring_2086 parameter section").toBeDefined();
    expect(wiringParam?.config?.adaptationRules?.length ?? 0).toBeGreaterThan(0);
  });

  it("every wired ID appears as a targetParameter in ADAPT-ENG-001 adaptationRules", () => {
    const allTargets = new Set<string>();
    for (const param of adaptEng.parameters ?? []) {
      for (const rule of param.config?.adaptationRules ?? []) {
        for (const action of rule.actions ?? []) {
          allTargets.add(action.targetParameter);
        }
      }
    }
    const missing: string[] = [];
    for (const id of ENGAGEMENT_TARGETS_WIRED_BY_2086) {
      if (!allTargets.has(id)) missing.push(id);
    }
    expect(missing, `Missing as ADAPT-ENG-001 targetParameter:\n  ${missing.join("\n  ")}`).toEqual([]);
  });

  it("every binding's profileKey appears as a BEH-AGG-001 targetProfileKey OR is null", () => {
    const aggTargetKeys = new Set<string>();
    for (const param of behAgg.parameters ?? []) {
      for (const rule of param.config?.aggregationRules ?? []) {
        if (rule.targetProfileKey) aggTargetKeys.add(rule.targetProfileKey);
      }
    }
    const drift: string[] = [];
    for (const binding of ENGAGEMENT_TARGET_BINDINGS) {
      if (binding.profileKey === null) continue;
      if (!aggTargetKeys.has(binding.profileKey)) {
        drift.push(`${binding.parameterId} → ${binding.profileKey}`);
      }
    }
    expect(
      drift,
      `Manifest profileKey not produced by BEH-AGG-001 (producer/consumer drift):\n  ${drift.join("\n  ")}`,
    ).toEqual([]);
  });

  it("for every ADAPT-ENG-001 rule targeting a wired ID, the rule's condition.profileKey matches the manifest binding (when binding has profileKey)", () => {
    const mismatches: string[] = [];
    for (const param of adaptEng.parameters ?? []) {
      for (const rule of param.config?.adaptationRules ?? []) {
        for (const action of rule.actions ?? []) {
          const binding = lookupEngagementBinding(action.targetParameter);
          if (!binding) continue; // not a #2086 target
          if (binding.profileKey === null) continue; // operator-only directive
          // The rule should read from the manifest-declared key (when it
          // uses dataSource=callerAttribute — the only valid AGGREGATE
          // read path).
          if (
            rule.condition.dataSource === "callerAttribute" &&
            rule.condition.profileKey !== binding.profileKey
          ) {
            mismatches.push(
              `target=${action.targetParameter}: rule key=${rule.condition.profileKey ?? "<none>"} expected=${binding.profileKey}`,
            );
          }
        }
      }
    }
    expect(
      mismatches,
      `Binding/rule profileKey drift — fix the spec or the manifest:\n  ${mismatches.join("\n  ")}`,
    ).toEqual([]);
  });

  it("lookupEngagementBinding returns null for non-wired IDs", () => {
    expect(lookupEngagementBinding("BEH-NOT-A-REAL-PARAM")).toBeNull();
    expect(lookupEngagementBinding("")).toBeNull();
  });

  it("lookupEngagementBinding returns the correct binding for a sampled wired ID", () => {
    const b = lookupEngagementBinding("BEH-COGNITIVE-ACTIVATION");
    expect(b).not.toBeNull();
    expect(b?.profileKey).toBe("behavior_profile:engagement:cognitive_activation");
    expect(b?.measurementSpec).toBe("CA-001-cognitive-activation");
    expect(b?.aggregateScope).toBe("BEH-AGG-001");
  });
});
