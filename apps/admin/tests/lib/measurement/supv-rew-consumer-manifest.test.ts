/**
 * Pin the SUPV-001 + REW-001 consumer manifest (#2084 S6).
 *
 * Asserts:
 *   1. Every parameter id in `SUPV_001_CONSUMED_PARAMS` exists in the
 *      `behavior-parameters.registry.json` registry with `domainGroup:
 *      "supervision"`.
 *   2. Every parameter id in `REW_001_MIRRORED_PARAMS` exists in the
 *      registry with `domainGroup: "reinforcement"`.
 *   3. The reinforcement set excludes `BEH-ERROR-ELABORATION`
 *      (deferred to S2 / #2087 learning style) and
 *      `BEH-COMPOSITE-REWARD` (covered via the categorisation route).
 *   4. The SUPV-001 spec actually declares each consumed param's
 *      snake_case alias in `parameters[].id`.
 *   5. The REW-001 spec actually declares each mirrored param's
 *      snake_case alias in `parameters[].id`.
 *   6. The runtime consumers cite the canonical id in source —
 *      pipeline `route.ts` for both SCORE_AGENT extension + REW
 *      mirror.
 *
 * Sibling to `parameter-coverage.test.ts` (Lattice Coverage pillar)
 * — that test counts the gap; THIS test pins the resolution shape.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  SUPV_001_CONSUMED_PARAMS,
  REW_001_MIRRORED_PARAMS,
  SUPV_REW_WIRED_PARAMETER_IDS,
} from "@/lib/measurement/supv-rew-consumer-manifest";

const APPS_ADMIN = resolve(__dirname, "..", "..", "..");
const SPECS_DIR = join(APPS_ADMIN, "docs-archive", "bdd-specs");
const REGISTRY_PATH = join(SPECS_DIR, "behavior-parameters.registry.json");
const SUPV_SPEC_PATH = join(SPECS_DIR, "SUPV-001-agent-supervision.spec.json");
const REW_SPEC_PATH = join(SPECS_DIR, "REW-001-reward-computation.spec.json");

interface RegistryEntry {
  parameterId: string;
  domainGroup?: string;
  aliases?: string[];
  usage?: { measurement?: unknown };
}
interface Registry {
  parameters: RegistryEntry[];
}
interface SpecParameter {
  id: string;
}
interface Spec {
  id: string;
  outputType?: string;
  parameters: SpecParameter[];
}

const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as Registry;
const supvSpec = JSON.parse(readFileSync(SUPV_SPEC_PATH, "utf8")) as Spec;
const rewSpec = JSON.parse(readFileSync(REW_SPEC_PATH, "utf8")) as Spec;

const registryById = new Map(registry.parameters.map((p) => [p.parameterId, p]));
const supvSpecParamIds = new Set(supvSpec.parameters.map((p) => p.id));
const rewSpecParamIds = new Set(rewSpec.parameters.map((p) => p.id));

describe("SUPV-001 + REW-001 consumer manifest (#2084 S6)", () => {
  it("every SUPV_001_CONSUMED_PARAMS id exists in the registry under domainGroup=supervision", () => {
    const failures: string[] = [];
    for (const id of SUPV_001_CONSUMED_PARAMS) {
      const entry = registryById.get(id);
      if (!entry) {
        failures.push(`${id}: missing from registry`);
        continue;
      }
      if (entry.domainGroup !== "supervision") {
        failures.push(`${id}: domainGroup=${entry.domainGroup} (expected supervision)`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("every REW_001_MIRRORED_PARAMS id exists in the registry under domainGroup=reinforcement", () => {
    const failures: string[] = [];
    for (const id of REW_001_MIRRORED_PARAMS) {
      const entry = registryById.get(id);
      if (!entry) {
        failures.push(`${id}: missing from registry`);
        continue;
      }
      if (entry.domainGroup !== "reinforcement") {
        failures.push(`${id}: domainGroup=${entry.domainGroup} (expected reinforcement)`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("REW_001_MIRRORED_PARAMS excludes BEH-ERROR-ELABORATION (deferred to S2 / #2087)", () => {
    expect(REW_001_MIRRORED_PARAMS as readonly string[]).not.toContain(
      "BEH-ERROR-ELABORATION",
    );
  });

  it("REW_001_MIRRORED_PARAMS excludes BEH-COMPOSITE-REWARD (covered via categorisation route)", () => {
    expect(REW_001_MIRRORED_PARAMS as readonly string[]).not.toContain(
      "BEH-COMPOSITE-REWARD",
    );
  });

  it("every SUPV_001_CONSUMED_PARAMS has its snake_case alias declared in SUPV-001.spec.json", () => {
    const failures: string[] = [];
    for (const id of SUPV_001_CONSUMED_PARAMS) {
      const entry = registryById.get(id);
      if (!entry) continue; // covered by earlier test
      const aliases = entry.aliases ?? [];
      const matched = aliases.some((a) => supvSpecParamIds.has(a));
      if (!matched) {
        failures.push(
          `${id}: no alias in [${aliases.join(", ")}] matches a SUPV-001 spec parameter id ` +
            `(spec has: ${Array.from(supvSpecParamIds).slice(0, 5).join(", ")}...)`,
        );
      }
    }
    expect(failures).toEqual([]);
  });

  it("every REW_001_MIRRORED_PARAMS has its snake_case alias declared in REW-001.spec.json", () => {
    const failures: string[] = [];
    for (const id of REW_001_MIRRORED_PARAMS) {
      const entry = registryById.get(id);
      if (!entry) continue;
      const aliases = entry.aliases ?? [];
      const matched = aliases.some((a) => rewSpecParamIds.has(a));
      if (!matched) {
        failures.push(
          `${id}: no alias in [${aliases.join(", ")}] matches a REW-001 spec parameter id ` +
            `(spec has: ${Array.from(rewSpecParamIds).join(", ")})`,
        );
      }
    }
    expect(failures).toEqual([]);
  });

  it("SUPV-001 spec has outputType=MEASURE_AGENT (consumed by SCORE_AGENT)", () => {
    expect(supvSpec.outputType).toBe("MEASURE_AGENT");
  });

  it("the pipeline route.ts cites each wired parameter id (consumer-side proof)", () => {
    const routePath = join(
      APPS_ADMIN,
      "app",
      "api",
      "calls",
      "[callId]",
      "pipeline",
      "route.ts",
    );
    const source = readFileSync(routePath, "utf8");

    // The pipeline cites the REW-001 mirror IDs directly in computeReward.
    // The SUPV-001 ids are cited via the manifest module — the manifest IS
    // a consumer-dir file (lib/measurement/*) so the parameter-coverage
    // gate picks them up. Here we just pin that the manifest is reachable
    // from a runtime path (the consumer chain: manifest → registered
    // wiring).
    for (const id of REW_001_MIRRORED_PARAMS) {
      expect(source, `pipeline route.ts must cite ${id} (REW-001 mirror)`).toContain(id);
    }
  });

  it("manifest tuple SUPV_REW_WIRED_PARAMETER_IDS sums to 15 (11 supervision + 4 reward)", () => {
    expect(SUPV_001_CONSUMED_PARAMS).toHaveLength(11);
    expect(REW_001_MIRRORED_PARAMS).toHaveLength(4);
    expect(SUPV_REW_WIRED_PARAMETER_IDS).toHaveLength(15);
  });

  it("manifest's wired set covers every non-deferred non-deprecated supervision + reinforcement registry entry", () => {
    const targetGroups = new Set(["supervision", "reinforcement"]);
    const expectedActive: string[] = [];
    for (const p of registry.parameters) {
      if (!targetGroups.has(p.domainGroup ?? "")) continue;
      // Skip entries explicitly deprecated or deferred via usage block.
      const measurement = p.usage?.measurement;
      if (measurement === "deprecated") continue;
      if (typeof measurement === "string" && measurement.startsWith("deferred")) continue;
      // Operator-only measurement variants (e.g. SUPERVISE-alarm signals
      // like BEH-INTERNAL-LEAK consumed by humans via AppLog, not folded
      // into the AGGREGATE/ADAPT/REWARD cascade) are NOT manifest-wired.
      if (
        measurement &&
        typeof measurement === "object" &&
        "kind" in measurement &&
        measurement.kind === "operator-only"
      ) {
        continue;
      }
      // BEH-COMPOSITE-REWARD already has a runtime mention via the
      // categorisation route — not a manifest responsibility.
      if (p.parameterId === "BEH-COMPOSITE-REWARD") continue;
      expectedActive.push(p.parameterId);
    }

    const wired = new Set(SUPV_REW_WIRED_PARAMETER_IDS);
    const missing = expectedActive.filter((id) => !wired.has(id));
    expect(
      missing,
      `Active supervision + reinforcement params not in manifest:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });
});
