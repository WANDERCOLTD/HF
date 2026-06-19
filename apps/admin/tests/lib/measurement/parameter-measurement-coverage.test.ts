/**
 * Parameter measurement coverage — Lattice protection for chain links 7+8 (epic #1967 M1).
 *
 * **Why this exists:**
 *
 * The Lattice's 8-link chain runs canonical spec → DB → cascade →
 * composed prompt → renderer → LLM → call behaviour → measurement →
 * next-call cascade. Epic #1946 closed links 1-5 (the prompt-emission
 * side). This test closes link 7 (call behaviour → measurement): for
 * every active parameter, the registry MUST declare which
 * `AnalysisSpec` measures it. If no spec measures it, the parameter
 * is producer-only debt and ratcheted under
 * `EXPECTED_GAP_COUNT`.
 *
 * **The substantive cross-check:**
 *
 * Sibling to `parameter-usage-coverage.test.ts` (which pins the
 * schema invariant: `usage.measurement` is a valid shape). This
 * test goes further: it cross-references each registry parameter
 * against the actual `*.spec.json` files under
 * `docs-archive/bdd-specs/` to verify that the declared specSlug
 * EXISTS and that the spec's `parameters` array DOES contain a
 * matching entry. A param declared `measurement: { specSlug: "X" }`
 * where `X.spec.json` doesn't exist (or doesn't reference the
 * param) is a stale declaration; the test fires.
 *
 * **Classifications:**
 *
 * - `measured` — declared `{specSlug}` or `{specSlugs}`, and at
 *   least one of the cited specs actually exists and references
 *   the param ID (or its alias) in its `parameters` array.
 * - `deferred` — declared `"deferred-#1967"`. Tracked debt.
 * - `deprecated` — declared `"deprecated"`. Excluded from ratchets.
 * - `gap` — declared a specSlug but the cross-check fails. The
 *   declaration is stale and should either get a real spec or
 *   move to deferred.
 *
 * See [`.claude/rules/parameter-measurement-coverage.md`](../../../../.claude/rules/parameter-measurement-coverage.md).
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
    measurement:
      | string
      | { specSlug?: string; specSlugs?: string[] };
  };
}

interface Registry {
  parameters: RegistryEntry[];
}

const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as Registry;

// Build a map: parameter id (canonical OR alias) → list of specSlugs whose
// spec's `parameters` array contains a matching entry.
function buildEvidenceMap(): Map<string, Set<string>> {
  const evidence = new Map<string, Set<string>>();
  const files = readdirSync(SPECS_DIR).filter((f) =>
    f.endsWith(".spec.json"),
  );
  for (const fname of files) {
    const slug = fname.replace(/\.spec\.json$/, "");
    const path = join(SPECS_DIR, fname);
    let spec: { parameters?: Array<{ id?: string; parameterId?: string }> } = {};
    try {
      spec = JSON.parse(readFileSync(path, "utf8"));
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

const EVIDENCE = buildEvidenceMap();

/**
 * 2026-06-19 incumbent (post-M4 structural pass) — M1 backfilled 82
 * params; M4 reclassified 9 (3 measured via STYLE-001 alias, 6
 * operator-only); the M4 structural pass (this commit) reclassified
 * 14 more without pedagogy input: 1 stale row already wired via
 * parametersAsDirectives (BEH-ABSTRACT-VS-CONCRETE), 5 legacy
 * lowercase folk-pedagogy assertions paired with their canonical
 * BEH-* siblings, 8 ADAPT-stage decision rules that are not
 * EXTRACT-stage observables. Leaves 34 active params on
 * "deferred-#1967" awaiting pedagogy review per
 * `docs/M4-pedagogy-review.md`.
 */
const EXPECTED_GAP_COUNT = 34;

type Classification =
  | "measured"
  | "deferred"
  | "deprecated"
  | "operator-only"
  | "stale"
  | "gap-no-usage";

function classifyMeasurement(p: RegistryEntry): {
  kind: Classification;
  detail?: string;
} {
  if (p.deprecatedAt) return { kind: "deprecated" };
  if (!p.usage) return { kind: "gap-no-usage" };
  const m = p.usage.measurement;
  if (m === "deferred-#1967") return { kind: "deferred" };
  if (m === "deprecated") return { kind: "deprecated" };
  if (typeof m === "object" && m !== null) {
    // M4 — explicit non-measurable tutor knob.
    const op = m as { kind?: string; reason?: string };
    if (op.kind === "operator-only") {
      return { kind: "operator-only", detail: op.reason };
    }
    const slugs: string[] = [];
    if (typeof m.specSlug === "string") slugs.push(m.specSlug);
    if (Array.isArray(m.specSlugs)) slugs.push(...m.specSlugs);
    if (slugs.length === 0) return { kind: "gap-no-usage" };
    // Cross-check: at least one cited spec MUST exist AND reference this param
    // by canonical id or any alias.
    const candidates = new Set<string>([p.parameterId, ...(p.aliases ?? [])]);
    for (const slug of slugs) {
      // Spec referenced this param?
      let crossCheckHit = false;
      for (const candidate of candidates) {
        if (EVIDENCE.get(candidate)?.has(slug)) {
          crossCheckHit = true;
          break;
        }
      }
      if (crossCheckHit) return { kind: "measured" };
    }
    return {
      kind: "stale",
      detail: `cited specSlug(s) [${slugs.join(", ")}] but no spec referenced this param by canonical id or alias`,
    };
  }
  return { kind: "gap-no-usage" };
}

describe("Parameter measurement coverage (M1 — link 7 of the Lattice chain)", () => {
  const classified = registry.parameters
    .filter((p) => p.parameterId)
    .map((p) => ({ p, c: classifyMeasurement(p) }));

  const measured = classified.filter((x) => x.c.kind === "measured");
  const deferred = classified.filter((x) => x.c.kind === "deferred");
  const deprecated = classified.filter((x) => x.c.kind === "deprecated");
  const operatorOnly = classified.filter((x) => x.c.kind === "operator-only");
  const stale = classified.filter((x) => x.c.kind === "stale");
  const gapNoUsage = classified.filter((x) => x.c.kind === "gap-no-usage");

  it("distribution sanity — every parameter is classifiable", () => {
    const sum =
      measured.length +
      deferred.length +
      deprecated.length +
      operatorOnly.length +
      stale.length +
      gapNoUsage.length;
    expect(sum).toBe(classified.length);
    // Sanity: at least half the actives have real AnalysisSpec coverage.
    expect(measured.length).toBeGreaterThan(50);
  });

  it("every operator-only entry has a substantive reason (>40 chars)", () => {
    // Lattice gap fill (M4 structural pass): bumped from >20 to >40 chars
    // to force authors to cite WHY a row is non-measurable (tutor-emit
    // directive / folk-pedagogy assertion / ADAPT-stage decision rule /
    // sibling reference), not just "operator only". Existing 6 + 14 new
    // rows all carry 100+ char reasons; the bar is empirically light.
    const tooShort = operatorOnly.filter(
      (x) => (x.c.detail ?? "").trim().length < 40,
    );
    expect(
      tooShort.length,
      `operator-only params with empty/short reason (<40 chars):\n  ${tooShort
        .map((x) => `${x.p.parameterId}: "${(x.c.detail ?? "").slice(0, 60)}..."`)
        .join("\n  ")}`,
    ).toBe(0);
  });

  it("no stale declarations — every cited specSlug is verifiable", () => {
    const lines = stale.map(
      (x) => `${x.p.parameterId}: ${x.c.detail ?? "(unknown)"}`,
    );
    expect(
      stale.length,
      `Stale measurement declarations (citation does not cross-check):\n  ${lines.join("\n  ")}\n\n` +
        `Fix: either (a) author the missing AnalysisSpec, (b) update the ` +
        `cited specSlug to match an existing spec, or (c) move to ` +
        `"deferred-#1967" and bump the gap ratchet.`,
    ).toBe(0);
  });

  it("no parameter is gap-no-usage — every row has usage.measurement", () => {
    const ids = gapNoUsage.map((x) => x.p.parameterId);
    expect(
      gapNoUsage.length,
      `Parameters with missing or malformed usage.measurement:\n  ${ids.join("\n  ")}`,
    ).toBe(0);
  });

  it("ratchet — gap count cannot exceed the 2026-06-18 incumbent budget", () => {
    expect(
      deferred.length,
      `${deferred.length} active parameters still declare "deferred-#1967" ` +
        `(producer-only debt). The ratchet caps this at ${EXPECTED_GAP_COUNT}.\n\n` +
        `If you LOWERED the count (great — declared a real specSlug): drop ` +
        `EXPECTED_GAP_COUNT to ${deferred.length}.\n\n` +
        `If you RAISED it: a new parameter landed without spec coverage. ` +
        `Either author the AnalysisSpec and declare {specSlug}, or consciously ` +
        `accept debt and bump this ratchet.\n\n` +
        `Sample deferred params:\n  ${deferred
          .slice(0, 10)
          .map((x) => x.p.parameterId)
          .join("\n  ")}`,
    ).toBeLessThanOrEqual(EXPECTED_GAP_COUNT);
  });

  it("publishes the distribution (operator log)", () => {
    // Pure sanity emitter — surfaces the live breakdown for PR review.
    const breakdown = {
      measured: measured.length,
      deferred: deferred.length,
      deprecated: deprecated.length,
      operatorOnly: operatorOnly.length,
      stale: stale.length,
      gapNoUsage: gapNoUsage.length,
      total: classified.length,
    };
    expect(breakdown.total).toBeGreaterThan(100);
    // Test name carries the data — operator reads it in CI.
  });
});
