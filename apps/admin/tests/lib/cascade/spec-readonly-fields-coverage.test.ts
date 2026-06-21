/**
 * Coverage gate — pins the structural pairing between the canonical
 * `PARAMETER_SPEC_READONLY_FIELDS` constant and the ESLint rule's
 * hardcoded mirror.
 *
 * Story: #1984 S2.
 *
 * **Why this exists:**
 *
 * The ESLint rule `hf-spec/no-customer-write-to-canonical-interpretation`
 * (S1) cannot directly import the TypeScript constant at lint time
 * (ESLint runs on `.mjs` rules outside the TS build). So the rule
 * carries a hardcoded mirror of the field set. This test ensures the
 * mirror never drifts from the canonical constant: every field added
 * to or removed from `PARAMETER_SPEC_READONLY_FIELDS` must be matched
 * by the same change in the rule, in the same PR.
 *
 * **What this test pins:**
 *
 * - Symmetric set equality between the canonical constant and the
 *   rule's hardcoded mirror.
 * - Sentinel size — current 3-field set (`definition`,
 *   `interpretationHigh`, `interpretationLow`). If you intentionally
 *   add a 4th field, update the sentinel; the test surfaces the
 *   intent at PR time.
 *
 * **What this test does NOT pin:**
 *
 * The rule's BEHAVIOUR on each field — that's the RuleTester suite
 * in `tests/eslint-rules/no-customer-write-to-canonical-interpretation.test.ts`.
 * This test is purely the coverage gate.
 *
 * Catalogued in `.claude/rules/spec-readonly-boundary.md` (S4).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PARAMETER_SPEC_READONLY_FIELDS } from "@/lib/cascade/spec-readonly-fields";

const APPS_ADMIN = resolve(__dirname, "..", "..", "..");
const RULE_PATH = resolve(
  APPS_ADMIN,
  "eslint-rules",
  "no-customer-write-to-canonical-interpretation.mjs",
);

// Extract the rule's hardcoded SPEC_READONLY_FIELDS set by parsing
// the .mjs file. The rule lives outside the TS build so we cannot
// import the structure directly; the structural shape is stable.
function extractRuleFieldSet(): Set<string> {
  const source = readFileSync(RULE_PATH, "utf8");
  const match = source.match(
    /const SPEC_READONLY_FIELDS = new Set\(\[([\s\S]*?)\]\)/,
  );
  if (!match) {
    throw new Error(
      `Could not find \`const SPEC_READONLY_FIELDS = new Set([...])\` in ${RULE_PATH}. ` +
        `If you refactored the rule, update this extractor so the coverage gate keeps tracking.`,
    );
  }
  const body = match[1];
  const literals = Array.from(body.matchAll(/["']([^"']+)["']/g)).map(
    (m) => m[1],
  );
  return new Set(literals);
}

/**
 * 2026-06-21 — the canonical set has 7 fields after the #2174 S5
 * defensive extension added `tiers`, `tierScheme`, `defaultTarget`,
 * `config` (originals: `definition`, `interpretationHigh`,
 * `interpretationLow`). If you add an 8th, bump this sentinel + update
 * both the constant AND the rule's hardcoded mirror in the same PR.
 */
const EXPECTED_FIELD_COUNT = 7;

describe("Spec-readonly fields ↔ ESLint rule coverage (#1984 S2)", () => {
  const canonical = new Set<string>(PARAMETER_SPEC_READONLY_FIELDS);
  const ruleMirror = extractRuleFieldSet();

  it("sentinel — canonical constant has the expected number of fields", () => {
    expect(
      canonical.size,
      `PARAMETER_SPEC_READONLY_FIELDS now has ${canonical.size} field(s), ` +
        `expected ${EXPECTED_FIELD_COUNT}. If you intentionally added/removed a ` +
        `field, update EXPECTED_FIELD_COUNT — but verify the rule's hardcoded ` +
        `mirror reflects the same change.`,
    ).toBe(EXPECTED_FIELD_COUNT);
  });

  it("rule's hardcoded mirror has the same field count as the canonical constant", () => {
    expect(
      ruleMirror.size,
      `ESLint rule's hardcoded SPEC_READONLY_FIELDS has ${ruleMirror.size} field(s); ` +
        `canonical PARAMETER_SPEC_READONLY_FIELDS has ${canonical.size}. Update the rule.`,
    ).toBe(canonical.size);
  });

  it("every canonical field is mirrored by the ESLint rule", () => {
    const missing = Array.from(canonical).filter((f) => !ruleMirror.has(f));
    expect(
      missing,
      `Canonical fields missing from the rule's hardcoded mirror:\n  ${missing.join("\n  ")}\n\n` +
        `Add them to SPEC_READONLY_FIELDS in eslint-rules/no-customer-write-to-canonical-interpretation.mjs.`,
    ).toEqual([]);
  });

  it("every rule-mirrored field exists in the canonical constant", () => {
    const stale = Array.from(ruleMirror).filter((f) => !canonical.has(f));
    expect(
      stale,
      `ESLint rule mirrors fields no longer in PARAMETER_SPEC_READONLY_FIELDS:\n  ${stale.join("\n  ")}\n\n` +
        `Remove them from SPEC_READONLY_FIELDS in eslint-rules/no-customer-write-to-canonical-interpretation.mjs.`,
    ).toEqual([]);
  });
});
