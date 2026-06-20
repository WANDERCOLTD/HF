/**
 * Parameter loop closure — Lattice protection for chain link 8 (epic #1967 M2).
 *
 * **Why this exists:**
 *
 * Sibling to `parameter-measurement-coverage.test.ts` (#1967 M1). M1
 * pinned link 7 — every active parameter declares an AnalysisSpec
 * that measures it. M2 pins link 8 — the next-call loop closes: for
 * every parameter classified `measured` by M1, SOME AGGREGATE / ADAPT
 * / REWARD spec reads its `CallScore` and rolls the result back into
 * the cascade-readable state (CallerTarget / CallerAttribute /
 * BehaviorTarget) so the next composed prompt reflects the measured
 * shift.
 *
 * Without M2 a parameter can be measured every call yet never affect
 * subsequent behaviour: the LLM is graded, the score lands in
 * `CallScore`, and nothing reads it. The adaptive loop runs but for
 * that parameter the gain is 0.
 *
 * **What "closes the loop" means structurally:**
 *
 * For the measured parameter `P`, there exists at least one
 * `*.spec.json` with `outputType ∈ {AGGREGATE, ADAPT, REWARD}` and at
 * least one rule whose source-side field references `P` (or one of
 * `P`'s aliases). Recognised source-side fields:
 *
 *   - `sourceParameter` — AGGREGATE rules (literal id)
 *   - `sourceParameterPattern` — AGGREGATE pattern (e.g. `skill_*`)
 *   - `sourceParameterId` — ADAPT / REWARD rules (literal id)
 *
 * The `_average` sentinel is the AGGREGATE-internal "average of every
 * other rule's input" — skipped (it's not a real source).
 *
 * **Pattern matching:**
 *
 * `sourceParameterPattern: "skill_*"` closes the loop for every
 * measured parameter whose id starts with `skill_`. Only suffix-glob
 * patterns are recognised (the existing convention in SKILL-AGG-001).
 *
 * **Output-self loop closure:**
 *
 * AGGREGATE specs declare an output parameter (e.g.
 * `skill_ema_aggregate`, `BEH-AGGREGATE-PROFILE`) that is itself in
 * the measured set (M1 cross-checks the spec exists and references
 * the output id). For these aggregator-output params the loop is
 * structurally self-closing: the AGGREGATE write IS the cascade
 * surface, so they're classified `closed-aggregator-output`.
 *
 * **Classifications:**
 *
 *   - `closed-direct` — a spec's source-side field literally cites
 *     the param's canonical id or an alias.
 *   - `closed-pattern` — a spec's `sourceParameterPattern` matches
 *     the param's id by prefix glob.
 *   - `closed-aggregator-output` — the param IS the output of an
 *     AGGREGATE spec (the loop self-closes through the AGGREGATE
 *     write).
 *   - `gap` — measured but no consumer found.
 *
 * **Ratchet:** `EXPECTED_GAP_COUNT` caps the gap count. 2026-06-18
 * incumbent: **68 measured parameters** have no AGGREGATE / ADAPT /
 * REWARD consumer. M4 (pedagogy review + spec authoring) plus
 * spec-author follow-on PRs close these toward 0.
 *
 * See [`.claude/rules/parameter-loop-closure.md`](../../../../.claude/rules/parameter-loop-closure.md).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const APPS_ADMIN = resolve(__dirname, "..", "..", "..");
const SPECS_DIR = join(APPS_ADMIN, "docs-archive", "bdd-specs");
const REGISTRY_PATH = join(SPECS_DIR, "behavior-parameters.registry.json");

interface RegistryEntry {
  parameterId: string;
  aliases?: string[];
  deprecatedAt?: string | null;
  usage?: {
    compose: string;
    measurement: string | { specSlug?: string; specSlugs?: string[] };
  };
}

interface Registry {
  parameters: RegistryEntry[];
}

const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as Registry;

// ────────────────────────────────────────────────────────────
// Spec evidence collection — walk every spec.json and harvest every
// source-side parameter reference + every AGGREGATE output id.
// ────────────────────────────────────────────────────────────

type Consumer = "AGGREGATE" | "ADAPT" | "REWARD";

interface SourceCitation {
  /** The slug of the spec that cites this id. */
  specSlug: string;
  /** outputType of the citing spec — AGGREGATE / ADAPT / REWARD. */
  consumer: Consumer;
  /** Which field carried the citation. */
  field: "sourceParameter" | "sourceParameterPattern" | "sourceParameterId";
  /** True when the field was sourceParameterPattern (so glob-match downstream). */
  isPattern: boolean;
}

interface SpecEvidence {
  /** `paramId` → list of citations where paramId is a literal source. */
  sources: Map<string, SourceCitation[]>;
  /** AGGREGATE spec output ids — these are the loop-self-closing set. */
  aggregatorOutputs: Set<string>;
}

function isConsumer(ot: unknown): ot is Consumer {
  return ot === "AGGREGATE" || ot === "ADAPT" || ot === "REWARD";
}

function buildSpecEvidence(): SpecEvidence {
  const sources = new Map<string, SourceCitation[]>();
  const aggregatorOutputs = new Set<string>();

  const files = readdirSync(SPECS_DIR).filter((f) => f.endsWith(".spec.json"));

  for (const fname of files) {
    const slug = fname.replace(/\.spec\.json$/, "");
    let spec: {
      outputType?: string;
      parameters?: Array<{ id?: string }>;
    } & Record<string, unknown> = {};
    try {
      spec = JSON.parse(readFileSync(join(SPECS_DIR, fname), "utf8"));
    } catch {
      continue;
    }
    if (!isConsumer(spec.outputType)) continue;
    const consumer = spec.outputType;

    if (consumer === "AGGREGATE" && Array.isArray(spec.parameters)) {
      for (const p of spec.parameters) {
        if (p && typeof p.id === "string") aggregatorOutputs.add(p.id);
      }
    }

    const walk = (obj: unknown): void => {
      if (obj && typeof obj === "object") {
        if (Array.isArray(obj)) {
          for (const item of obj) walk(item);
          return;
        }
        const record = obj as Record<string, unknown>;
        for (const key of Object.keys(record)) {
          const value = record[key];
          if (
            (key === "sourceParameter" ||
              key === "sourceParameterId" ||
              key === "sourceParameterPattern") &&
            typeof value === "string"
          ) {
            if (value === "_average") continue;
            const isPattern =
              key === "sourceParameterPattern" || value.endsWith("*");
            if (!isPattern) {
              const citation: SourceCitation = {
                specSlug: slug,
                consumer,
                field: key,
                isPattern: false,
              };
              if (!sources.has(value)) sources.set(value, []);
              sources.get(value)!.push(citation);
            }
            // Patterns walked separately by PATTERN_LITERALS so we
            // preserve the literal pattern string for prefix-match.
          } else {
            walk(value);
          }
        }
      }
    };
    walk(spec);
  }

  return { sources, aggregatorOutputs };
}

const EVIDENCE = buildSpecEvidence();

// ────────────────────────────────────────────────────────────
// Measured set — same logic as M1 (must cross-check)
// ────────────────────────────────────────────────────────────

function buildMeasurementEvidence(): Map<string, Set<string>> {
  const evidence = new Map<string, Set<string>>();
  const files = readdirSync(SPECS_DIR).filter((f) => f.endsWith(".spec.json"));
  for (const fname of files) {
    const slug = fname.replace(/\.spec\.json$/, "");
    let spec: { parameters?: Array<{ id?: string; parameterId?: string }> } = {};
    try {
      spec = JSON.parse(readFileSync(join(SPECS_DIR, fname), "utf8"));
    } catch {
      continue;
    }
    const params = spec.parameters;
    if (!Array.isArray(params)) continue;
    for (const entry of params) {
      if (!entry || typeof entry !== "object") continue;
      const id =
        (entry as { id?: string }).id ??
        (entry as { parameterId?: string }).parameterId;
      if (typeof id !== "string" || id.length === 0) continue;
      if (!evidence.has(id)) evidence.set(id, new Set());
      evidence.get(id)!.add(slug);
    }
  }
  return evidence;
}

const MEASUREMENT_EVIDENCE = buildMeasurementEvidence();

function isMeasured(p: RegistryEntry): boolean {
  if (p.deprecatedAt) return false;
  if (!p.usage) return false;
  const m = p.usage.measurement;
  if (m === "deferred-#1967" || m === "deprecated") return false;
  if (typeof m !== "object" || m === null) return false;
  const slugs: string[] = [];
  if (typeof m.specSlug === "string") slugs.push(m.specSlug);
  if (Array.isArray(m.specSlugs)) slugs.push(...m.specSlugs);
  if (slugs.length === 0) return false;
  const candidates = new Set<string>([p.parameterId, ...(p.aliases ?? [])]);
  for (const slug of slugs) {
    for (const candidate of candidates) {
      if (MEASUREMENT_EVIDENCE.get(candidate)?.has(slug)) return true;
    }
  }
  return false;
}

// ────────────────────────────────────────────────────────────
// Classification
// ────────────────────────────────────────────────────────────

type Closure =
  | "closed-direct"
  | "closed-pattern"
  | "closed-aggregator-output"
  | "gap";

interface ClosureResult {
  parameterId: string;
  closure: Closure;
  via?: string;
}

function classifyClosure(p: RegistryEntry): ClosureResult {
  const candidates = [p.parameterId, ...(p.aliases ?? [])];

  // Aggregator-output: the param IS the output of an AGGREGATE spec.
  for (const c of candidates) {
    if (EVIDENCE.aggregatorOutputs.has(c)) {
      return {
        parameterId: p.parameterId,
        closure: "closed-aggregator-output",
        via: `aggregator output id "${c}"`,
      };
    }
  }

  // Direct citation in sourceParameter / sourceParameterId.
  for (const c of candidates) {
    const cits = EVIDENCE.sources.get(c);
    if (cits && cits.length > 0) {
      const first = cits[0];
      return {
        parameterId: p.parameterId,
        closure: "closed-direct",
        via: `${first.specSlug} (${first.consumer}.${first.field})`,
      };
    }
  }

  // Pattern match (sourceParameterPattern: "skill_*" etc.).
  for (const c of candidates) {
    for (const { pattern, specSlug, consumer } of PATTERN_LITERALS) {
      if (!pattern.endsWith("*")) continue;
      const prefix = pattern.slice(0, -1);
      if (prefix.length >= 2 && c.startsWith(prefix)) {
        return {
          parameterId: p.parameterId,
          closure: "closed-pattern",
          via: `${specSlug} (${consumer} pattern "${pattern}")`,
        };
      }
    }
  }

  return { parameterId: p.parameterId, closure: "gap" };
}

// Separate pattern walk that preserves the literal pattern value.
interface PatternLiteral {
  pattern: string;
  specSlug: string;
  consumer: Consumer;
}

const PATTERN_LITERALS: PatternLiteral[] = (() => {
  const out: PatternLiteral[] = [];
  const files = readdirSync(SPECS_DIR).filter((f) => f.endsWith(".spec.json"));
  for (const fname of files) {
    const slug = fname.replace(/\.spec\.json$/, "");
    let spec: { outputType?: string } & Record<string, unknown> = {};
    try {
      spec = JSON.parse(readFileSync(join(SPECS_DIR, fname), "utf8"));
    } catch {
      continue;
    }
    if (!isConsumer(spec.outputType)) continue;
    const consumer = spec.outputType;
    const walk = (obj: unknown): void => {
      if (obj && typeof obj === "object") {
        if (Array.isArray(obj)) {
          for (const item of obj) walk(item);
          return;
        }
        const record = obj as Record<string, unknown>;
        for (const [key, value] of Object.entries(record)) {
          if (key === "sourceParameterPattern" && typeof value === "string") {
            if (value !== "_average") {
              out.push({ pattern: value, specSlug: slug, consumer });
            }
          } else if (
            key === "sourceParameter" &&
            typeof value === "string" &&
            value.endsWith("*")
          ) {
            out.push({ pattern: value, specSlug: slug, consumer });
          } else {
            walk(value);
          }
        }
      }
    };
    walk(spec);
  }
  return out;
})();

// ────────────────────────────────────────────────────────────
// Ratchet
// ────────────────────────────────────────────────────────────

/**
 * 2026-06-19 — zero open loops. BEH-AGG-001-behavior-aggregation.spec.json
 * (single AGGREGATE spec with 9 domain-grouped parameter sections —
 * companion, personality, supervision, engagement, curriculum, learning,
 * reinforcement, onboarding, core-style) was authored 2026-06-19 closing
 * the link-8 cascade-feedback loop for the 70 remaining gap params.
 *
 * Historical trajectory: 67 (M2 land 2026-06-18) → 70 (M4 added 3
 * newly-measured BEH-WARMTH/DIRECTNESS/FORMALITY via STYLE-001 alias) → 0.
 *
 * If a future PR adds a newly-measured parameter without a consumer,
 * the ratchet fires. Resolution: extend BEH-AGG-001 with a new rule (or
 * author a new spec) reading the param's `sourceParameterId`.
 */
const EXPECTED_GAP_COUNT = 0;

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("Parameter loop closure (M2 — link 8 of the Lattice chain)", () => {
  const measured = registry.parameters.filter(isMeasured);
  const classified = measured.map(classifyClosure);

  const closed = classified.filter((r) => r.closure !== "gap");
  const gaps = classified.filter((r) => r.closure === "gap");
  const byBucket = {
    direct: classified.filter((r) => r.closure === "closed-direct").length,
    pattern: classified.filter((r) => r.closure === "closed-pattern").length,
    aggregatorOutput: classified.filter(
      (r) => r.closure === "closed-aggregator-output",
    ).length,
  };

  it("distribution sanity — every measured param classifies cleanly", () => {
    expect(closed.length + gaps.length).toBe(measured.length);
    // The M1 set is the input; if M1 changes the count we surface it.
    expect(measured.length).toBeGreaterThan(50);
  });

  it("ratchet — open-loop count cannot exceed the 2026-06-18 incumbent budget", () => {
    expect(
      gaps.length,
      `${gaps.length} measured parameters have no AGGREGATE / ADAPT / ` +
        `REWARD consumer (their CallScore is written but the cascade ` +
        `never reads it). Ratchet caps this at ${EXPECTED_GAP_COUNT}.\n\n` +
        `If you LOWERED the count (great — closed the loop for a param): ` +
        `drop EXPECTED_GAP_COUNT to ${gaps.length}.\n\n` +
        `If you RAISED it: a new measured parameter landed without a ` +
        `consumer. Either extend an existing AGGREGATE/ADAPT spec to ` +
        `cite the new param as a sourceParameter, or consciously accept ` +
        `debt and bump this ratchet.\n\n` +
        `Sample gaps:\n  ${gaps
          .slice(0, 10)
          .map((r) => r.parameterId)
          .join("\n  ")}` +
        (gaps.length > 10 ? `\n  ... ${gaps.length - 10} more` : ""),
    ).toBeLessThanOrEqual(EXPECTED_GAP_COUNT);
  });

  it("at least some closure exists — guards against a refactor that breaks the walker", () => {
    expect(closed.length).toBeGreaterThan(0);
    expect(byBucket.direct + byBucket.pattern + byBucket.aggregatorOutput).toBe(
      closed.length,
    );
  });

  it("publishes the closure distribution (operator log)", () => {
    const breakdown = {
      measured: measured.length,
      closed: closed.length,
      gap: gaps.length,
      byBucket,
    };
    expect(breakdown.measured).toBeGreaterThan(0);
    // Test name carries the data — operator reads it in CI.
  });
});
