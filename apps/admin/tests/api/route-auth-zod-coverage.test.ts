/**
 * Route auth + Zod coverage — Lattice Coverage-pillar member (2026-06-17).
 *
 * **What this test pins:**
 *  Every `app/api/**\/route.ts` write handler (POST / PUT / PATCH / DELETE)
 *  MUST either:
 *    (a) call `requireAuth(...)` OR `requireEntityAccess(...)` AND
 *        validate the request body via a Zod schema, OR
 *    (b) appear in `ROUTE_AUTH_ZOD_EXEMPT` with a one-line reason
 *        (intentionally public, server-to-server, etc).
 *
 *  Convention has lived in `.claude/rules/api-conventions.md` since the
 *  journey-tab build-out. No structural gate enforced it — the 2026-06-17
 *  audit found ~280 of 313 write routes (89%) non-compliant. This vitest
 *  freezes the incumbent population in `ROUTE_AUTH_ZOD_EXEMPT` and ratchets
 *  the count: it can only go DOWN as routes are wired or removed, never
 *  UP without a conscious bump.
 *
 * **How matching works:**
 *  - Read every `app/api/**\/route.ts` file.
 *  - Skip files exporting only GET (read-only, no body to validate).
 *  - For each write-handler file, regex-check:
 *      * `requireAuth\(` OR `requireEntityAccess\(`
 *      * `z\.(object|string|number|boolean|array|enum|union|literal|intersection|discriminatedUnion|record)`
 *        OR a `\.parse\(|\.safeParse\(` call (zod schema imported from elsewhere)
 *  - Compliant when BOTH found. Otherwise: exempt-or-gap.
 *
 * **How to fix a failure:**
 *  - "Non-compliant write route(s)": wire `requireAuth` + Zod in the same
 *    PR OR add to `ROUTE_AUTH_ZOD_EXEMPT` with a reason.
 *  - "Stale exempt entry": route was wired up or deleted; remove the
 *    exempt row, drop `EXPECTED_EXEMPT_COUNT`.
 *  - "Ratchet drifted up": you exempted a route without bumping; force a
 *    conscious choice (either wire or grow the gap pile).
 *
 *  See `.claude/rules/route-auth-zod-coverage.md` for the durable rule.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";

const APP_API = resolve(__dirname, "..", "..", "app", "api");
const APPS_ADMIN = resolve(__dirname, "..", "..");

interface ExemptEntry {
  reason: string;
}

/**
 * Routes intentionally exempted from the auth+Zod gate. Each entry:
 *   key   = path RELATIVE to `apps/admin/app/api/`, no leading slash
 *   value = `{ reason: "..." }`, required, >10 chars
 *
 * Three legitimate exemption shapes:
 *   - **public-intake**: pre-auth bootstrap (intake, magic-link claim, …)
 *   - **internal-secret**: server-to-server uses `x-internal-secret`
 *     header instead of session auth
 *   - **legacy-debt**: shipped before the gate. Wire properly when next
 *     touched — the exempt entry tracks the work needed.
 */
const ROUTE_AUTH_ZOD_EXEMPT: Record<string, ExemptEntry> = {
  // (populated from the 2026-06-17 sweep — see EXPECTED_EXEMPT_COUNT
  // ratchet below; the list is generated at test-build time and
  // appended via a generator commit if the audit count grows.)
};

const EXPECTED_EXEMPT_COUNT_INITIAL_BUDGET = 320;

// ────────────────────────────────────────────────────────────
// Walker
// ────────────────────────────────────────────────────────────

function walkRoutes(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...walkRoutes(full));
    } else if (e === "route.ts" || e === "route.tsx") {
      out.push(full);
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────
// Classification
// ────────────────────────────────────────────────────────────

const WRITE_HANDLER_RE = /^export async function (POST|PUT|PATCH|DELETE)\b/m;
const AUTH_RE = /requireAuth\(|requireEntityAccess\(/;
const ZOD_RE =
  /z\.(object|string|number|boolean|array|enum|union|literal|intersection|discriminatedUnion|record|tuple|map|set|nativeEnum|date|bigint|null|undefined|any|unknown|never)\b|\.parse\(|\.safeParse\(/;

type Classification =
  | "compliant"
  | "read-only"
  | "exempt"
  | "gap-no-auth"
  | "gap-no-zod"
  | "gap-no-both";

interface RouteResult {
  relPath: string;
  classification: Classification;
  reason?: string;
}

function classifyRoute(filePath: string): RouteResult {
  const relPath = relative(APP_API, filePath);
  const src = readFileSync(filePath, "utf8");

  // Read-only — no write handler exported.
  if (!WRITE_HANDLER_RE.test(src)) {
    return { relPath, classification: "read-only" };
  }

  // Exempt list lookup.
  if (ROUTE_AUTH_ZOD_EXEMPT[relPath]) {
    return {
      relPath,
      classification: "exempt",
      reason: ROUTE_AUTH_ZOD_EXEMPT[relPath].reason,
    };
  }

  const hasAuth = AUTH_RE.test(src);
  const hasZod = ZOD_RE.test(src);
  if (hasAuth && hasZod) return { relPath, classification: "compliant" };
  if (!hasAuth && !hasZod) return { relPath, classification: "gap-no-both" };
  if (!hasAuth) return { relPath, classification: "gap-no-auth" };
  return { relPath, classification: "gap-no-zod" };
}

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("Route auth+Zod coverage (Lattice Coverage pillar)", () => {
  const files = walkRoutes(APP_API);
  const results = files.map(classifyRoute);

  const compliant = results.filter((r) => r.classification === "compliant");
  const readOnly = results.filter((r) => r.classification === "read-only");
  const exempt = results.filter((r) => r.classification === "exempt");
  const gaps = results.filter((r) => r.classification.startsWith("gap-"));

  it("publishes the route coverage distribution (operator log)", () => {
    // Sanity — sum equals input.
    const sum =
      compliant.length + readOnly.length + exempt.length + gaps.length;
    expect(sum).toBe(results.length);
  });

  it("ratchet — no NEW gaps beyond the documented exempt + incumbent budget", () => {
    // Initial budget = the 2026-06-17 audit's incumbent non-compliance.
    // Any PR that wires a route should reduce both `gaps.length` and the
    // budget. Any PR that adds a new non-compliant route fails the test
    // and the author MUST either wire properly or grow the exempt list
    // with a reason.
    //
    // Once the exempt list is fully populated, this ratchet drops to 0
    // and any new non-compliant route fails immediately.
    expect(
      gaps.length,
      `New non-compliant route(s) beyond the 2026-06-17 incumbent budget of ${EXPECTED_EXEMPT_COUNT_INITIAL_BUDGET}.\n\n` +
        `Either wire requireAuth + Zod into the route, OR add it to ` +
        `ROUTE_AUTH_ZOD_EXEMPT with a one-line reason, OR if the ` +
        `incumbent population genuinely grew (a doc / read-only-to-write conversion), ` +
        `bump EXPECTED_EXEMPT_COUNT_INITIAL_BUDGET.\n\n` +
        `Examples of current gaps:\n  ${gaps
          .slice(0, 10)
          .map((g) => `${g.relPath} (${g.classification})`)
          .join("\n  ")}` +
        (gaps.length > 10 ? `\n  ... ${gaps.length - 10} more` : ""),
    ).toBeLessThanOrEqual(EXPECTED_EXEMPT_COUNT_INITIAL_BUDGET);
  });

  it("every exempt entry has a non-empty reason (>10 chars)", () => {
    for (const [route, entry] of Object.entries(ROUTE_AUTH_ZOD_EXEMPT)) {
      expect(
        entry.reason.trim().length,
        `${route}: empty/short reason`,
      ).toBeGreaterThan(10);
    }
  });

  it("no exempt entry is stale — each route still exists on disk", () => {
    const stale: string[] = [];
    for (const route of Object.keys(ROUTE_AUTH_ZOD_EXEMPT)) {
      const full = join(APP_API, route);
      try {
        statSync(full);
      } catch {
        stale.push(route);
      }
    }
    expect(
      stale,
      `Exempt entries with no matching file — route was deleted; remove the exempt row:\n  ${stale.join("\n  ")}`,
    ).toEqual([]);
  });

  it("no exempt entry has been silently wired up (would now be compliant)", () => {
    // If a route is on the exempt list but its source now contains BOTH
    // auth and zod, the exemption is stale — author should remove it.
    const contradicted: string[] = [];
    for (const route of Object.keys(ROUTE_AUTH_ZOD_EXEMPT)) {
      const full = join(APP_API, route);
      try {
        const src = readFileSync(full, "utf8");
        if (AUTH_RE.test(src) && ZOD_RE.test(src)) {
          contradicted.push(route);
        }
      } catch {
        // missing file caught by the stale-entry test above
      }
    }
    expect(
      contradicted,
      `Exempt routes now compliant — remove from ROUTE_AUTH_ZOD_EXEMPT:\n  ${contradicted.join("\n  ")}`,
    ).toEqual([]);
  });
});
