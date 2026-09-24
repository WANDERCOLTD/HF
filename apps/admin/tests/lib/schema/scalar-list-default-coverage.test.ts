/**
 * #2332 — every Prisma scalar list must declare `@default(...)`.
 *
 * **The drift this closes.** A migration grants a column
 * `DEFAULT ARRAY[]::TEXT[]`. schema.prisma declares the field as a bare
 * `String[]` with no `@default([])`. The next `prisma migrate dev` diff sees
 * "schema has no default, database does" and emits `DROP DEFAULT`. The column
 * is left with no default, and nothing anywhere warns.
 *
 * That is how `CurriculumModule.coversModules` ended up `NOT NULL` with no
 * default on BOTH hf_sandbox and hf_staging, failing every writer that
 * omitted it with P2011 — including `seed-demo-course`, where it surfaced.
 *
 * **Why this invariant and not migration-SQL parsing.** Cross-referencing
 * migration DDL against the schema is brittle: defaults appear in
 * `CREATE TABLE` inline, in `ADD COLUMN`, and in `ALTER COLUMN SET DEFAULT`,
 * and can be legitimately dropped later. The root cause is simpler and
 * checkable in one place — a scalar list with no `@default` is a column whose
 * database default Prisma is free to delete. Requiring the declaration fixes
 * the cause rather than detecting the symptom.
 *
 * **Scope.** Scalar lists only — `String[]`, `Int[]`, and siblings. RELATION
 * lists (`Session[]`, `CallScore[]`) are excluded: Prisma forbids `@default`
 * on them, so including them would make the rule unsatisfiable. Enum lists
 * are excluded too, since a sensible default is domain-specific.
 *
 * See `.claude/rules/scalar-list-default-coverage.md`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SCHEMA_PATH = join(resolve(__dirname, "..", "..", ".."), "prisma", "schema.prisma");

/** Prisma primitive scalars. Relation and enum lists are out of scope. */
const SCALAR_TYPES = new Set([
  "String",
  "Int",
  "Float",
  "Boolean",
  "DateTime",
  "Json",
  "Bytes",
  "Decimal",
  "BigInt",
]);

interface ExemptEntry {
  /** >20 chars — why this list must NOT declare a default. */
  reason: string;
}

/**
 * Empty by design. A scalar list without a default is a column whose DB
 * default Prisma may silently drop, so an entry here needs a genuine reason
 * — not "we haven't got to it".
 */
const SCALAR_LIST_DEFAULT_EXEMPT: Record<string, ExemptEntry> = {};

const EXPECTED_EXEMPT_COUNT = 0;
const EXPECTED_GAP_COUNT = 0;

/**
 * Parse floor. If a schema refactor breaks the regex the walk returns
 * nothing and every assertion below passes vacuously — this turns that into
 * a failure instead.
 */
const MIN_EXPECTED_SCALAR_LISTS = 20;

interface ScalarList {
  model: string;
  field: string;
  type: string;
  hasDefault: boolean;
}

function parseScalarLists(schema: string): ScalarList[] {
  const out: ScalarList[] = [];
  for (const [, model, body] of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    for (const line of body.split("\n")) {
      const m = /^\s*(\w+)\s+(\w+)\[\]/.exec(line);
      if (!m || !SCALAR_TYPES.has(m[2])) continue;
      out.push({
        model,
        field: m[1],
        type: m[2],
        hasDefault: line.includes("@default("),
      });
    }
  }
  return out;
}

type Classification = "covered" | "exempt" | "gap";

const schemaSrc = readFileSync(SCHEMA_PATH, "utf8");
const lists = parseScalarLists(schemaSrc);

const results = lists.map((l) => {
  const key = `${l.model}.${l.field}`;
  const classification: Classification = SCALAR_LIST_DEFAULT_EXEMPT[key]
    ? "exempt"
    : l.hasDefault
      ? "covered"
      : "gap";
  return { ...l, key, classification };
});

const gaps = results.filter((r) => r.classification === "gap");
const exempt = results.filter((r) => r.classification === "exempt");

describe("#2332 — scalar-list @default coverage", () => {
  it("schema parse found a plausible number of scalar lists", () => {
    expect(
      lists.length,
      `Parsed only ${lists.length} scalar lists — below the ` +
        `${MIN_EXPECTED_SCALAR_LISTS} floor. The regex has probably broken ` +
        `against a schema change; fix the parser before trusting this gate.`,
    ).toBeGreaterThanOrEqual(MIN_EXPECTED_SCALAR_LISTS);
  });

  it("excludes relation lists, which cannot take @default", () => {
    // Session[] on Caller is a relation. If the parser ever picked it up, the
    // rule would be unsatisfiable — Prisma rejects @default on relations.
    expect(results.some((r) => r.type === "Session")).toBe(false);
    expect(results.every((r) => SCALAR_TYPES.has(r.type))).toBe(true);
  });

  it("every scalar list declares @default", () => {
    const detail = gaps.map((g) => `  ${g.key} (${g.type}[])`).join("\n");
    expect(
      gaps.length,
      `${gaps.length} scalar list(s) declare no @default. Prisma will drop ` +
        `any database default on these columns at the next migrate diff, ` +
        `leaving them with no default and no warning:\n${detail}\n\n` +
        `Add \`@default([])\` to each, plus a migration re-asserting ` +
        `SET DEFAULT so existing databases are repaired.`,
    ).toBe(EXPECTED_GAP_COUNT);
  });

  it("ratchet — exempt count matches EXPECTED_EXEMPT_COUNT exactly", () => {
    expect(exempt.length).toBe(EXPECTED_EXEMPT_COUNT);
  });

  it("every exempt entry has a substantive reason (>20 chars)", () => {
    for (const [key, entry] of Object.entries(SCALAR_LIST_DEFAULT_EXEMPT)) {
      expect(entry.reason.length, `${key} exempt reason too short`).toBeGreaterThan(20);
    }
  });

  it("no exempt entry references a field that no longer exists", () => {
    const known = new Set(results.map((r) => r.key));
    for (const key of Object.keys(SCALAR_LIST_DEFAULT_EXEMPT)) {
      expect(known.has(key), `${key} is exempt but is not a scalar list — stale row`).toBe(true);
    }
  });

  it("no exempt entry is contradicted by an actual @default", () => {
    for (const key of Object.keys(SCALAR_LIST_DEFAULT_EXEMPT)) {
      const row = results.find((r) => r.key === key);
      expect(row?.hasDefault, `${key} is exempt but DOES declare @default — remove the row`).toBe(
        false,
      );
    }
  });

  it("distribution sanity (operator-facing log)", () => {
    const covered = results.filter((r) => r.classification === "covered").length;
    console.log(
      `[scalar-list-default-coverage] ${lists.length} scalar lists — ` +
        `${covered} covered, ${exempt.length} exempt, ${gaps.length} gap`,
    );
    expect(covered + exempt.length + gaps.length).toBe(results.length);
  });
});
