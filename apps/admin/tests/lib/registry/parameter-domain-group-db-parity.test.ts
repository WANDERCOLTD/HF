/**
 * #2040 (S7 of epic #2031) — DB ↔ JSON parity Coverage gate for
 * `Parameter.domainGroup`.
 *
 * Pins the structural existence of Query 13 in
 * `scripts/check-fk-consistency.ts` so a future refactor cannot
 * silently delete the live-DB parity check. This is the Coverage-pillar
 * sibling to the source-side ratchet at
 * `tests/lib/registry/parameter-domain-group-taxonomy.test.ts` (#1948).
 *
 * Two pillars protect the same column:
 *   - Pillar 1 (source): `parameter-domain-group-taxonomy.test.ts`
 *     pins the JSON registry against the canonical 12-tuple.
 *   - Pillar 2 (DB): Query 13 in `check-fk-consistency.ts` runs against
 *     the live DB via `npm run check:fk` and reports off-canonical
 *     row counts. WARN-only until S3b (#2039) clears the incumbent
 *     debt. THIS test pins Query 13's structural existence.
 *
 * Why a structural pin and not a live DB query?
 *   - The vitest workspace in HF mocks `@/lib/prisma` by convention
 *     (every Prisma-touching test uses `vi.mock`). There is no
 *     integration-vitest DB connection.
 *   - CI's check:fk job runs against an ephemeral Postgres seeded from
 *     canonical JSON via `seed-from-specs.ts` — the seed cannot
 *     produce off-canonical rows, so the live-DB query returns 0 in
 *     CI by construction. CI is NOT where this ratchet bites.
 *   - The ratchet's load-bearing run is via the operator pattern from
 *     PR #2036 (`gcloud compute ssh hf-dev … bash` with DATABASE_URL
 *     pointed at hosted secrets) — that's where the 96 / 145 incumbent
 *     drift lives.
 *
 * The structural pin guarantees that:
 *   1. Query 13 exists in the script source.
 *   2. The canonical 12-tuple in the SQL matches
 *      `CANONICAL_DOMAIN_GROUPS` (no drift between the two sources).
 *   3. The Query is registered with `warnOnly: true` for the rollout
 *      window — flipping to error severity is an intentional, reviewable
 *      change after S3b completes.
 *
 * When S3b's mapping migration clears the drift on both hosted DBs:
 *   - Drop `warnOnly: true` from the Query 13 results.push() call in
 *     `check-fk-consistency.ts`.
 *   - Update this test's `it("…WARN-only…")` assertion to expect the
 *     warnOnly line absent.
 *   - S3c can then land the Postgres CHECK constraint as the final
 *     structural backstop.
 *
 * Cross-references:
 *   - `.claude/rules/db-registry-parity.md` (S8, #2041) — the multi-pillar discipline this test enforces
 *   - `docs/decisions/2026-06-19-parameter-domain-group-mapping.md` (S3a, #2044) — the operator pedagogy decisions
 *   - PR #2036 — the audit that surfaced the drift
 *   - `apps/admin/lib/registry/canonical-domain-group.ts::CANONICAL_DOMAIN_GROUPS`
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CANONICAL_DOMAIN_GROUPS } from "@/lib/registry/canonical-domain-group";

const SCRIPT_PATH = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "scripts",
  "check-fk-consistency.ts",
);

const SCRIPT_SOURCE = readFileSync(SCRIPT_PATH, "utf8");

describe("#2040 — Parameter.domainGroup DB parity (Query 13 structural pin)", () => {
  it("check-fk-consistency.ts source loads", () => {
    expect(SCRIPT_SOURCE.length).toBeGreaterThan(1000);
  });

  it("Query 13 exists with the canonical check name", () => {
    expect(
      SCRIPT_SOURCE,
      "Query 13 (parameter-domain-group-off-canonical) is missing from check-fk-consistency.ts. " +
        "S7 ratchet broken — the live-DB parity check has been deleted.",
    ).toMatch(/name:\s*["']parameter-domain-group-off-canonical["']/);
  });

  it("Query 13 references the canonical 12-tuple in its SQL WHERE", () => {
    // The SQL must enumerate the same canonical groups as CANONICAL_DOMAIN_GROUPS.
    // If the canonical set grows (e.g. v1.1 adds a 13th bucket), this test
    // catches the drift between the runtime constant and the SQL literal.
    for (const group of CANONICAL_DOMAIN_GROUPS) {
      expect(
        SCRIPT_SOURCE,
        `Query 13's SQL is missing canonical group "${group}". ` +
          `Update the SQL WHERE clause in check-fk-consistency.ts Query 13 ` +
          `to enumerate every entry in CANONICAL_DOMAIN_GROUPS.`,
      ).toContain(`'${group}'`);
    }
  });

  it("Query 13 is WARN-only during the S3b rollout window", () => {
    // Find the Query 13 results.push block and assert warnOnly: true is set.
    // After S3b clears the incumbent debt + S3c lands the CHECK constraint,
    // this assertion should flip to expect.not.toMatch (or be removed).
    const q13Index = SCRIPT_SOURCE.indexOf(
      'name: "parameter-domain-group-off-canonical"',
    );
    expect(q13Index, "Query 13 name marker not found").toBeGreaterThan(-1);
    // Look at the next ~600 chars for the warnOnly flag in the same
    // results.push block.
    const q13Block = SCRIPT_SOURCE.slice(q13Index, q13Index + 800);
    expect(
      q13Block,
      "Query 13 must be WARN-only (warnOnly: true) until S3b clears the " +
        "incumbent off-canonical debt. Removing this flag flips the check to " +
        "error severity — only do that after the audit returns 0 rows on hosted DBs.",
    ).toMatch(/warnOnly:\s*true/);
  });

  it("Query 13 references the S3a ADR + S8 rule for discoverability", () => {
    // The description string includes pointers to the canonical artifacts
    // so an operator triaging the warning can find the context fast.
    const q13Index = SCRIPT_SOURCE.indexOf(
      'name: "parameter-domain-group-off-canonical"',
    );
    const q13Block = SCRIPT_SOURCE.slice(q13Index, q13Index + 800);
    expect(q13Block, "Query 13 description must reference S3b (#2039)").toMatch(
      /#2039/,
    );
    expect(q13Block, "Query 13 description must reference the canonical helper").toMatch(
      /canonical-domain-group/,
    );
  });

  it("CANONICAL_DOMAIN_GROUPS has exactly 12 entries (v1.0 taxonomy)", () => {
    // Sibling assertion to #1948's test — pinned here too so a Query 13
    // refactor that extends CANONICAL_DOMAIN_GROUPS without updating the
    // SQL fails the per-group assertion above with a clear message.
    expect(CANONICAL_DOMAIN_GROUPS.size).toBe(12);
  });
});
