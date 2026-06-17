/**
 * Tier-visibility coverage — Lattice Coverage-pillar member (2026-06-17).
 *
 * **What this test pins:**
 *  Routes that return per-caller payloads AND admit roles below
 *  OPERATOR (e.g. `requireAuth("VIEWER")`, `requireEntityAccess(...)` at
 *  R level) MUST route the response through a tier-aware redactor
 *  (`redact<X>ForTier`) per `.claude/rules/response-redaction.md`.
 *
 *  The 2026-06-17 audit found 215 VIEWER-admitting routes and only 1
 *  with the `@tieredVisibility` opt-in tag (0.5% adoption). 5 confirmed
 *  active leak routes return operator-only fields (rationale text, raw
 *  scores, confidence metadata) to STUDENT-tier readers.
 *
 *  This test names every KNOWN tier-sensitive route in
 *  `TIER_SENSITIVE_ROUTES`. For each, verifies the file imports
 *  `visibilityTierForRole` + a `redact<X>ForTier` AND invokes both.
 *  Already-compliant routes pass; the 5 confirmed leaks are listed in
 *  `TIER_VISIBILITY_EXEMPT` with reason "needs redactor (follow-on)".
 *  Ratchet: exempt list cannot grow.
 *
 * **How matching works:**
 *  For each route in `TIER_SENSITIVE_ROUTES`:
 *    1. Skip if route file doesn't exist (stale list).
 *    2. If route is in `TIER_VISIBILITY_EXEMPT` → `exempt`.
 *    3. Else check: imports `visibilityTierForRole` AND imports
 *       `redact<Anything>ForTier` AND both are invoked.
 *    4. Both present → `compliant`. Otherwise → `gap`.
 *
 * **How to fix a failure:**
 *  - "Tier-sensitive route lacks redactor": land a redactor at
 *    `lib/rbac/policies/<resource>.ts` and wire it. Pattern is
 *    `lib/rbac/policies/adaptations.ts::redactAdaptationsForTier`.
 *  - "Stale exempt entry": redactor shipped; remove the exempt row.
 *  - "Ratchet drifted up": you added a known leak without wiring it.
 *    Wire the redactor or document the deferral in the exempt reason.
 *
 *  See `.claude/rules/tier-visibility-coverage.md`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const APP_API = resolve(__dirname, "..", "..", "app", "api");

/**
 * Routes whose payload mixes operator-only fields with learner-safe
 * fields AND admit roles below OPERATOR. Maintained by humans —
 * tier-sensitivity isn't reliably detectable from AST alone.
 *
 * Adding a route to this list is a conscious "this route needs a
 * redactor" declaration. Once on the list, the test enforces the
 * redactor is wired.
 */
const TIER_SENSITIVE_ROUTES: readonly string[] = [
  // ── Already-compliant (the only opted-in route as of 2026-06-17) ──
  "callers/[callerId]/adaptations/route.ts",

  // ── 2026-06-17 audit — confirmed leaks (in exempt list below) ──
  "callers/[callerId]/skills-evidence/route.ts",
  "callers/[callerId]/lo-mastery/route.ts",
  "callers/[callerId]/uplift/route.ts",
  "callers/[callerId]/memories/route.ts",
  "callers/[callerId]/insights/route.ts",
];

interface ExemptEntry {
  reason: string;
}

/**
 * Tier-sensitive routes that don't yet have a redactor. Each entry
 * documents what's deferred. Ratchet drops as redactors ship.
 */
const TIER_VISIBILITY_EXEMPT: Record<string, ExemptEntry> = {
  "callers/[callerId]/skills-evidence/route.ts": {
    reason:
      "Returns reasoning text + analysisSpecName + evidenceQuality + scoredBy. STUDENT-tier should see learner-evidence excerpts only. Needs redactSkillsEvidenceForTier.",
  },
  "callers/[callerId]/lo-mastery/route.ts": {
    reason:
      "Returns mastery (0-1 numeric) + tier + bandLabel. STUDENT-tier should see categorical status only (mastered / in_progress / not_started). Needs redactLoMasteryForTier.",
  },
  "callers/[callerId]/uplift/route.ts": {
    reason:
      "Returns callScores with confidence + hasLearnerEvidence + reasoning. STUDENT-tier should see engagement signals only. Needs redactUpliftForTier.",
  },
  "callers/[callerId]/memories/route.ts": {
    reason:
      "Returns confidence + evidence + decayFactor (operator-only adaptive signal). STUDENT-tier should see memory categories only. Needs redactMemoriesForTier.",
  },
  "callers/[callerId]/insights/route.ts": {
    reason:
      "Returns recommendation + reason (tutor's internal reasoning). STUDENT-tier should see high-level categories only. Needs redactInsightsForTier.",
  },
};

const EXPECTED_EXEMPT_COUNT = 5;

// ────────────────────────────────────────────────────────────
// Detection
// ────────────────────────────────────────────────────────────

const VISIBILITY_IMPORT_RE = /visibilityTierForRole/;
const REDACTOR_IMPORT_RE = /redact[A-Z][A-Za-z]*ForTier/;
const VISIBILITY_CALL_RE = /visibilityTierForRole\(/;
const REDACTOR_CALL_RE = /redact[A-Z][A-Za-z]*ForTier\(/;

type Classification = "compliant" | "exempt" | "missing-file" | "gap";

interface RouteResult {
  route: string;
  classification: Classification;
  missing?: string[];
  reason?: string;
}

function classifyRoute(route: string): RouteResult {
  const full = join(APP_API, route);
  try {
    statSync(full);
  } catch {
    return { route, classification: "missing-file" };
  }

  if (TIER_VISIBILITY_EXEMPT[route]) {
    return {
      route,
      classification: "exempt",
      reason: TIER_VISIBILITY_EXEMPT[route].reason,
    };
  }

  const src = readFileSync(full, "utf8");
  const missing: string[] = [];
  if (!VISIBILITY_IMPORT_RE.test(src)) missing.push("import visibilityTierForRole");
  if (!REDACTOR_IMPORT_RE.test(src)) missing.push("import redact<X>ForTier");
  if (!VISIBILITY_CALL_RE.test(src)) missing.push("call visibilityTierForRole(...)");
  if (!REDACTOR_CALL_RE.test(src)) missing.push("call redact<X>ForTier(...)");

  if (missing.length === 0) return { route, classification: "compliant" };
  return { route, classification: "gap", missing };
}

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("Tier-visibility coverage (Lattice Coverage pillar)", () => {
  const results = TIER_SENSITIVE_ROUTES.map(classifyRoute);

  it("every tier-sensitive route either has the redactor wired or is exempt with reason", () => {
    const gaps = results.filter((r) => r.classification === "gap");
    expect(
      gaps,
      `Tier-sensitive routes that admit < OPERATOR but lack the redactor wiring:\n  ${gaps
        .map((g) => `${g.route} — missing: ${g.missing?.join(", ")}`)
        .join("\n  ")}\n\nFix: land redact<X>ForTier at lib/rbac/policies/<resource>.ts + wire it in the route, OR add to TIER_VISIBILITY_EXEMPT with a one-line reason describing what's deferred.`,
    ).toEqual([]);
  });

  it("ratchet — exempt list pinned at EXPECTED_EXEMPT_COUNT", () => {
    const exemptIds = Object.keys(TIER_VISIBILITY_EXEMPT);
    expect(
      exemptIds.length,
      `Exempt-list size drifted from ${EXPECTED_EXEMPT_COUNT}. ` +
        `If you wired a redactor + removed an entry, bump ` +
        `EXPECTED_EXEMPT_COUNT down. If you added an entry, ` +
        `pause: was that intentional? Wire the redactor first when ` +
        `possible. Current entries: ${exemptIds.join(", ")}`,
    ).toBe(EXPECTED_EXEMPT_COUNT);
  });

  it("every exempt entry has a non-empty reason (>20 chars)", () => {
    for (const [route, entry] of Object.entries(TIER_VISIBILITY_EXEMPT)) {
      expect(entry.reason.trim().length, `${route}: empty/short reason`).toBeGreaterThan(20);
    }
  });

  it("no tier-sensitive route entry points at a non-existent file", () => {
    const missing = results.filter((r) => r.classification === "missing-file");
    expect(
      missing.map((m) => m.route),
      `TIER_SENSITIVE_ROUTES entry has no file on disk — route was renamed or removed; update the list.`,
    ).toEqual([]);
  });

  it("no exempt entry is now compliant (would mean redactor shipped — remove the row)", () => {
    const contradicted: string[] = [];
    for (const route of Object.keys(TIER_VISIBILITY_EXEMPT)) {
      const full = join(APP_API, route);
      try {
        const src = readFileSync(full, "utf8");
        if (
          VISIBILITY_IMPORT_RE.test(src) &&
          REDACTOR_IMPORT_RE.test(src) &&
          VISIBILITY_CALL_RE.test(src) &&
          REDACTOR_CALL_RE.test(src)
        ) {
          contradicted.push(route);
        }
      } catch {
        // missing-file caught by sibling test
      }
    }
    expect(
      contradicted,
      `Exempt routes now compliant — remove from TIER_VISIBILITY_EXEMPT:\n  ${contradicted.join("\n  ")}`,
    ).toEqual([]);
  });
});
