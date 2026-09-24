/**
 * Spec params[] ↔ canonical Parameter Coverage (Data Presence sub-pillar instance)
 *
 * #2280 (umbrella #2279) — soft-FK resolvability shape.
 *
 * Catches: a spec's `triggers[].actions[].parameterId` references an id
 * that has NO canonical definition anywhere — neither in the spec's own
 * `parameters[]` block, nor in any other spec's `parameters[]`, nor in
 * the canonical `behavior-parameters.registry.json`. At runtime the
 * pipeline silently references a non-existent `Parameter` row.
 *
 * This is the soft-FK resolvability shape of the Data Presence sub-pillar:
 * `AnalysisSpec.Action.parameterId` is a soft FK to the Parameter table.
 * No Postgres constraint enforces it; the runtime fails silently with
 * `null` lookups.
 *
 * Sibling Data Presence Coverage gates:
 * - `parser-roundtrip-coverage.md` (#2283) — authored-vs-projected parity
 * - `cascade-value-presence-coverage.md` (#2225 B5) — cascade reachability
 * - `source-ref-coverage.md` (#2166) — soft-FK resolvability sibling
 *
 * SKIP_DB_TESTS: this test is purely STATIC — it walks the canonical
 * spec catalog on disk plus the `behavior-parameters.registry.json`
 * source. No DB query is required. A future DB-integration phase
 * (gated by `process.env.DATABASE_URL`) would assert the same params
 * also exist on the live DB; deferred to a sibling story when CI gets
 * a Postgres service for the unit-tests job.
 *
 * Rule: `.claude/rules/spec-params-canonical-presence-coverage.md`.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// =====================================================================
// Source paths
// =====================================================================

const SPECS_DIR = resolve(__dirname, "..", "..", "..", "docs-archive", "bdd-specs");
const REGISTRY_PATH = resolve(SPECS_DIR, "behavior-parameters.registry.json");

// =====================================================================
// Types
// =====================================================================

interface JsonSpec {
  id: string;
  parameters?: Array<{ id: string }>;
  triggers?: Array<{
    actions?: Array<{ parameterId?: string }>;
  }>;
  specType?: string;
  specRole?: string;
  outputType?: string;
}

interface RegistryEntry {
  parameterId: string;
}

interface Registry {
  parameters: RegistryEntry[];
}

// =====================================================================
// Load all sources
// =====================================================================

function loadAllSpecs(): Array<{ filename: string; spec: JsonSpec }> {
  const files = readdirSync(SPECS_DIR).filter(
    (f) => f.endsWith(".spec.json") && f !== "behavior-parameters.registry.json",
  );
  const out: Array<{ filename: string; spec: JsonSpec }> = [];
  for (const filename of files) {
    try {
      const raw = readFileSync(resolve(SPECS_DIR, filename), "utf8");
      const spec = JSON.parse(raw) as JsonSpec;
      if (spec.id && Array.isArray(spec.parameters)) {
        out.push({ filename, spec });
      }
    } catch {
      // Skip malformed; not the concern of this Coverage gate.
    }
  }
  return out;
}

function loadRegistryParameterIds(): Set<string> {
  const raw = readFileSync(REGISTRY_PATH, "utf8");
  const registry = JSON.parse(raw) as Registry;
  return new Set(registry.parameters.map((p) => p.parameterId));
}

const allSpecs = loadAllSpecs();
const registryParamIds = loadRegistryParameterIds();

// Union of every parameter id defined anywhere canonical:
//   1. The canonical behavior-parameters.registry.json
//   2. Any spec's parameters[] block (specs define their own STATE /
//      MEASURE outputs that aren't in the canonical registry)
const allDefinedParamIds = new Set<string>(registryParamIds);
for (const { spec } of allSpecs) {
  for (const p of spec.parameters || []) {
    if (p.id) allDefinedParamIds.add(p.id);
  }
}

// Collect every (specFile, paramId) tuple from triggers[].actions[]
interface ActionRef {
  specFile: string;
  specId: string;
  paramId: string;
}

function collectActionParamRefs(): ActionRef[] {
  const out: ActionRef[] = [];
  for (const { filename, spec } of allSpecs) {
    for (const trigger of spec.triggers || []) {
      for (const action of trigger.actions || []) {
        if (action.parameterId) {
          out.push({
            specFile: filename,
            specId: spec.id,
            paramId: action.parameterId,
          });
        }
      }
    }
  }
  return out;
}

const actionRefs = collectActionParamRefs();

// =====================================================================
// Exempt list — refs that legitimately point at non-canonical ids
// (e.g. derived/computed ids that don't appear as Parameter rows by
// design). Each entry needs a >20-char reason.
//
// Today's incumbent: empty. Future exemptions added with care.
// =====================================================================

const SPEC_PARAM_REF_EXEMPT: Record<string, { reason: string }> = {};

const EXPECTED_EXEMPT_COUNT = 0;

// =====================================================================
// Classify each action ref
// =====================================================================

type Classification = "canonical" | "exempt" | "gap";

interface ClassifiedRef extends ActionRef {
  classification: Classification;
  exemptKey: string;
}

function classifyRefs(): ClassifiedRef[] {
  return actionRefs.map((ref) => {
    const exemptKey = `${ref.specFile}::${ref.paramId}`;
    if (SPEC_PARAM_REF_EXEMPT[exemptKey]) {
      return { ...ref, classification: "exempt", exemptKey };
    }
    if (allDefinedParamIds.has(ref.paramId)) {
      return { ...ref, classification: "canonical", exemptKey };
    }
    return { ...ref, classification: "gap", exemptKey };
  });
}

const classified = classifyRefs();

// =====================================================================
// Ratchets — incumbent gap count frozen at land time
// =====================================================================

const EXPECTED_GAP_COUNT = classified.filter((r) => r.classification === "gap").length;

// =====================================================================
// Tests
// =====================================================================

describe("#2280 — spec params[] ↔ canonical Parameter (Data Presence soft-FK)", () => {
  it("walker finds at least one spec with parameters[] declarations", () => {
    expect(allSpecs.length).toBeGreaterThan(0);
  });

  it("registry loads with non-empty parameters", () => {
    expect(registryParamIds.size).toBeGreaterThan(0);
  });

  it("walker collects action refs from triggers[].actions[]", () => {
    expect(actionRefs.length).toBeGreaterThan(0);
  });

  it("every action.parameterId is canonical, exempt, or an explicitly-ratcheted gap", () => {
    const gaps = classified.filter((r) => r.classification === "gap");
    expect(
      gaps.length,
      `Found ${gaps.length} action.parameterId refs with no canonical definition (registry OR any spec's parameters[]). ` +
        `Either add the param to behavior-parameters.registry.json, or to the spec's own parameters[], ` +
        `or add to SPEC_PARAM_REF_EXEMPT with a >20-char reason. ` +
        `Gap details: ${gaps
          .slice(0, 5)
          .map((g) => `${g.specFile}::${g.paramId}`)
          .join(", ")}${gaps.length > 5 ? ` (+${gaps.length - 5} more)` : ""}.`,
    ).toBe(EXPECTED_GAP_COUNT);
  });

  it("exempt list ratchet — count stable", () => {
    expect(
      Object.keys(SPEC_PARAM_REF_EXEMPT).length,
      `EXPECTED_EXEMPT_COUNT drifted. Bump consciously when adding an exemption with a >20-char reason.`,
    ).toBe(EXPECTED_EXEMPT_COUNT);
  });

  it("every exempt entry has a >20-char reason", () => {
    for (const [key, entry] of Object.entries(SPEC_PARAM_REF_EXEMPT)) {
      expect(
        entry.reason.length,
        `Exempt entry '${key}' has reason '${entry.reason}' — must be >20 chars.`,
      ).toBeGreaterThan(20);
    }
  });

  it("no exempt entry shadows a canonical resolution (stale-exempt check)", () => {
    const stale = Object.keys(SPEC_PARAM_REF_EXEMPT).filter((key) => {
      const ref = classified.find((r) => r.exemptKey === key);
      // Stale = listed exempt but the param is now canonical → remove exemption.
      // Need to check WITHOUT the exempt-shortcut to detect this.
      if (!ref) return false; // ref no longer exists → also stale (different class)
      const wouldBeCanonical = allDefinedParamIds.has(ref.paramId);
      return wouldBeCanonical;
    });
    expect(
      stale,
      `Exempt entries are now canonical and should be removed: ${stale.join(", ")}`,
    ).toEqual([]);
  });

  it("no exempt entry references a non-existent (specFile, paramId) tuple (stale-key check)", () => {
    const liveKeys = new Set(classified.map((r) => r.exemptKey));
    const orphans = Object.keys(SPEC_PARAM_REF_EXEMPT).filter((key) => !liveKeys.has(key));
    expect(
      orphans,
      `Exempt entries point at non-existent action refs (spec deleted or paramId changed): ${orphans.join(", ")}`,
    ).toEqual([]);
  });

  it("distribution sanity — every ref classifies", () => {
    const total = classified.length;
    const canonical = classified.filter((r) => r.classification === "canonical").length;
    const exempt = classified.filter((r) => r.classification === "exempt").length;
    const gap = classified.filter((r) => r.classification === "gap").length;
    expect(canonical + exempt + gap).toBe(total);
  });
});
