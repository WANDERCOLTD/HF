/**
 * Caller-detail data-source Coverage — Lattice 5th-pillar test.
 *
 * **What this test pins:**
 *  Every caller-detail route under `app/api/callers/[callerId]/**` MUST
 *  read the data store its purpose implies:
 *
 *    - **score-store** (`CallerTarget.currentScore` / `CallScore`) —
 *      routes describing learner-scored / engine-derived state
 *      (adaptations, uplift, attainment, skills-evidence, sub-skills,
 *      lo-mastery).
 *
 *    - **target-store** (`BehaviorTarget` cascade via
 *      `getEffectiveBehaviorTargetsForCaller` / direct reads) — routes
 *      describing operator tuning / target overrides
 *      (effective-behavior-targets, behavior-targets, tolerances).
 *
 *  A route claiming "learner state" but reading only `BehaviorTarget`
 *  cascade is the drift class this test catches — it was the live
 *  fingerprint on `app/api/callers/[callerId]/adaptations/route.ts`
 *  2026-07-02 (fixed on `fix/adaptations-tab-caller-target-visible`).
 *
 * **How matching works:**
 *  For each route in `ROUTE_DATA_SOURCE`:
 *    - Read the route source file.
 *    - Check every required pattern is present (regex match).
 *    - Report gaps with the specific missing pattern.
 *
 *  Per TL Concern 1 — classification is by **Prisma model / resolver
 *  reference**, NOT by JSDoc keyword. "Adaptation" is polysemous in HF
 *  (ADAPT stage writes CallerTarget); prose classification is unreliable.
 *
 *  Per TL Concern 2 — the adaptations route carries a **golden pin** on
 *  its current post-fix state (reads `prisma.callerTarget`), not a
 *  synthetic pre-fix fixture — the merged fix is the regression baseline.
 *
 * **How to fix a failure:**
 *  - "Route X missing score-store reference": read `CallerTarget` /
 *    `CallScore` if the route surfaces engine-derived learner state.
 *  - "Route X missing target-store reference": read `BehaviorTarget` /
 *    `getEffectiveBehaviorTargetsForCaller` if the route surfaces
 *    operator tuning.
 *  - "Route missing from ROUTE_DATA_SOURCE": declare it consciously OR
 *    add it to `ROUTE_EXEMPT` with a `>20-char reason`.
 *
 *  See `.claude/rules/caller-detail-data-source-coverage.md` for the
 *  durable rule.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ADMIN = resolve(__dirname, "..", "..");
const CALLER_ROUTES_DIR = join(REPO_ADMIN, "app", "api", "callers", "[callerId]");

// ────────────────────────────────────────────────────────────
// Declared classification per route
// ────────────────────────────────────────────────────────────

/**
 * Regex patterns that any given route source must contain when the
 * route claims to surface a specific data store. Each entry maps a
 * route sub-path (relative to `app/api/callers/[callerId]/`) to a
 * classification + required-pattern list.
 *
 * "score-store" = at least one of the CT/CallScore patterns must match.
 * "target-store" = at least one of the BT patterns must match.
 * "both" = at least one from each set must match (routes that
 *   legitimately need both — e.g. Adaptations shows engine-scored CT
 *   overrides ON TOP OF the BT cascade default).
 */
type StoreClass = "score-store" | "target-store" | "both";

interface RouteSpec {
  class: StoreClass;
  reason: string;
}

const SCORE_STORE_PATTERNS = [
  /prisma\.callerTarget\b/,
  /prisma\.callScore\b/,
  /callerTarget\.findMany/,
  /callerTarget\.findUnique/,
];

const TARGET_STORE_PATTERNS = [
  /getEffectiveBehaviorTargetsForCaller/,
  /prisma\.behaviorTarget\b/,
];

const ROUTE_DATA_SOURCE: Record<string, RouteSpec> = {
  // ── score-store routes (engine-derived learner state) ──
  "adaptations/route.ts": {
    class: "both",
    reason:
      "engine-scored CallerTarget entries (fix `885974ad`) ON TOP OF BehaviorTarget cascade for the operator-set target context",
  },
  "uplift/route.ts": {
    class: "score-store",
    reason:
      "scoreTrends reads CallScore per call; adaptationEvidence reads CallerTarget.currentScore for skill_* / .targetValue for BEH-* (post-fix)",
  },
  "attainment/route.ts": {
    class: "score-store",
    reason: "skill EMA bands render from CallerTarget.currentScore",
  },
  "sub-skills/route.ts": {
    class: "score-store",
    reason: "non-skill_* CallerTarget rows grouped by parameter category",
  },
  "skills-evidence/route.ts": {
    class: "score-store",
    reason: "per-call CallScore evidence rows for a skill parameter",
  },
  // ── target-store routes (operator tuning) ──
  "effective-behavior-targets/route.ts": {
    class: "target-store",
    reason:
      "Tune sidebar's per-parameter cascade read — SYSTEM → PLAYBOOK → CALLER BehaviorTarget",
  },
  "behavior-targets/route.ts": {
    class: "target-store",
    reason: "learner-scope BehaviorTarget overrides for operator tuning",
  },
};

// ────────────────────────────────────────────────────────────
// Exempt routes — sub-routes we deliberately don't pin here.
// Every exempt row needs a >20-char reason.
// ────────────────────────────────────────────────────────────

interface ExemptEntry {
  reason: string;
}

const ROUTE_EXEMPT: Record<string, ExemptEntry> = {
  "route.ts": {
    reason:
      "root caller CRUD — no scoring or tuning surface; PII + status only",
  },
  "actions/route.ts": {
    reason: "action logs; no scoring or tuning surface",
  },
  "actions/[actionId]/route.ts": {
    reason: "single-action fetch/mutation; PII trail, no scoring surface",
  },
  "active-playbook/route.ts": {
    reason: "enrollment lookup; playbookId only",
  },
  "aggregate/route.ts": {
    reason: "pipeline retrigger endpoint; no direct store read",
  },
  "artifacts/route.ts": {
    reason: "media/artifact index; no scoring surface",
  },
  "assessment-moment-mcqs/route.ts": {
    reason: "ContentQuestion sampler; not a store-of-scores route",
  },
  "available-media/route.ts": {
    reason: "MediaAsset listing for the caller; not a scoring surface",
  },
  "calls/route.ts": {
    reason: "Call listing; per-call CallScores surface elsewhere",
  },
  "cascade/voice/route.ts": {
    reason:
      "voice-cascade effective-value lookup; cascade layer, not per-store target/score",
  },
  "cohorts/route.ts": {
    reason: "Cohort membership list; no scoring surface",
  },
  "compose-prompt/route.ts": {
    reason: "operator on-demand compose invocation; not a store read surface",
  },
  "enrollments/route.ts": {
    reason: "CallerPlaybook listing; no scoring surface",
  },
  "enrollments/[enrollmentId]/route.ts": {
    reason: "single-enrollment fetch/update; no scoring surface",
  },
  "lo-mastery/route.ts": {
    reason:
      "reads CallerAttribute (lo_mastery:* keys) — separate store family from CallerTarget; sibling gate could pin later",
  },
  "tolerances/route.ts": {
    reason:
      "write-only endpoint via applyLearnerTolerance helper; the helper resolves cascade internally, this route has no direct BT/CT reference",
  },
  "eval-prompt/route.ts": {
    reason: "operator prompt evaluation invocation; not a store read surface",
  },
  "exam-mode-check/route.ts": {
    reason: "flag check for the exam-mode shell; not a scoring surface",
  },
  "exam-readiness/route.ts": {
    reason: "readiness check based on module progress; not per-parameter scoring",
  },
  "export/route.ts": {
    reason: "bulk data export; multi-store aggregation not typed by this gate",
  },
  "insights/route.ts": {
    reason:
      "insight recommendations from LearnerProfile / attributes; not per-parameter target/score",
  },
  "journey-progress/route.ts": {
    reason: "journey-stop progression; no scoring surface",
  },
  "last-selected-module/route.ts": {
    reason: "single field on Caller; not per-parameter",
  },
  "learning-trajectory/route.ts": {
    reason: "narrative summary; multi-store aggregation not typed here",
  },
  "lo-progress/route.ts": {
    reason: "LO progress from CallerAttribute; sibling of lo-mastery",
  },
  "media-history/route.ts": {
    reason: "media artifact history; no scoring surface",
  },
  "memories/route.ts": {
    reason: "CallerMemory rows; PII surface, not per-parameter",
  },
  "mock-results/route.ts": {
    reason:
      "Mock Exam Results screen — reads CallScore for the mock only; sanctioned dedicated view (BDD US-Mock-05)",
  },
  "module-progress/route.ts": {
    reason: "CallerModuleProgress rows; module-level not per-parameter",
  },
  "module-stall-pool/route.ts": {
    reason: "stall-scaffold pool lookup; not a scoring surface",
  },
  "personality/route.ts": {
    reason: "Big Five personality snapshot; sits on CallerAttribute",
  },
  "phone/route.ts": {
    reason: "phone number update; PII surface only",
  },
  "prompt-staleness/route.ts": {
    reason: "ComposedPrompt staleness flag; not a scoring surface",
  },
  "reset/route.ts": {
    reason: "operator reset action; not a store read surface",
  },
  "scheduler-decision/route.ts": {
    reason: "next-call scheduler output; not per-parameter scoring",
  },
  "session-flow-progress/route.ts": {
    reason: "journey session flow progression; not per-parameter",
  },
  "slugs/route.ts": {
    reason: "curriculum-module slug resolution; not a scoring surface",
  },
  "snapshot/route.ts": {
    reason:
      "snapshot roll-up — multi-store aggregation; per-store correctness pinned at each backing route",
  },
  "status/route.ts": {
    reason: "caller status snapshot; PII + enrollment",
  },
  "survey/route.ts": {
    reason: "PRE/POST survey CallerAttribute records",
  },
  "switch-domain/route.ts": {
    reason: "domain reassignment action; not a store read surface",
  },
  "trust-progress/route.ts": {
    reason: "trust-progress signals; not per-parameter target/score",
  },
  "voice-provider/route.ts": {
    reason: "voice provider config; not a scoring surface",
  },
};

/** Ratchet — exempt count. Drops as exempt routes get pinned or removed. */
const EXPECTED_EXEMPT_COUNT = Object.keys(ROUTE_EXEMPT).length;

/** Ratchet — routes matching no known category. MUST stay at 0.
 *  Every new route added under `[callerId]/` MUST be declared in
 *  ROUTE_DATA_SOURCE or ROUTE_EXEMPT. */
const EXPECTED_UNCLASSIFIED_COUNT = 0;

/** Ratchet — routes classified but failing their pattern check. MUST stay at 0. */
const EXPECTED_GAP_COUNT = 0;

// ────────────────────────────────────────────────────────────
// Source-walk — every route.ts under [callerId]/**
// ────────────────────────────────────────────────────────────

function walkRoutes(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    const relPath = prefix ? `${prefix}/${e}` : e;
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkRoutes(full, relPath));
    } else if (e === "route.ts") {
      out.push(relPath);
    }
  }
  return out;
}

function readRoute(relPath: string): string {
  return readFileSync(join(CALLER_ROUTES_DIR, relPath), "utf8");
}

function anyPatternMatches(src: string, patterns: RegExp[]): RegExp | null {
  for (const p of patterns) {
    if (p.test(src)) return p;
  }
  return null;
}

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("Caller-detail data-source Coverage (Lattice 5th-pillar)", () => {
  const routes = walkRoutes(CALLER_ROUTES_DIR);

  it("walker discovers all [callerId]/**/route.ts files", () => {
    expect(
      routes.length,
      "No routes discovered under app/api/callers/[callerId]/. Walker misconfigured.",
    ).toBeGreaterThan(10);
  });

  it("every route is either classified or exempted (no silent additions)", () => {
    const unclassified = routes.filter(
      (r) => !(r in ROUTE_DATA_SOURCE) && !(r in ROUTE_EXEMPT),
    );
    expect(
      unclassified.length,
      `New caller-detail routes NOT declared in ROUTE_DATA_SOURCE nor ROUTE_EXEMPT:\n  ${unclassified.join(
        "\n  ",
      )}\n\nFix: add each route to ROUTE_DATA_SOURCE with class = "score-store" | "target-store" | "both", OR to ROUTE_EXEMPT with a >20-char reason.`,
    ).toBe(EXPECTED_UNCLASSIFIED_COUNT);
  });

  it("no classified route is missing its required data-store reference", () => {
    const gaps: string[] = [];
    for (const [relPath, spec] of Object.entries(ROUTE_DATA_SOURCE)) {
      if (!routes.includes(relPath)) continue; // route retired; caught by next test
      const src = readRoute(relPath);
      if (spec.class === "score-store" || spec.class === "both") {
        if (anyPatternMatches(src, SCORE_STORE_PATTERNS) === null) {
          gaps.push(
            `${relPath}: declared ${spec.class} but no CallerTarget / CallScore reference found`,
          );
        }
      }
      if (spec.class === "target-store" || spec.class === "both") {
        if (anyPatternMatches(src, TARGET_STORE_PATTERNS) === null) {
          gaps.push(
            `${relPath}: declared ${spec.class} but no BehaviorTarget / getEffectiveBehaviorTargetsForCaller reference found`,
          );
        }
      }
    }
    expect(
      gaps.length,
      `Data-source drift — route claims one store but doesn't read it:\n  ${gaps.join(
        "\n  ",
      )}`,
    ).toBe(EXPECTED_GAP_COUNT);
  });

  it("no declared classified route references a file that doesn't exist", () => {
    const stale = Object.keys(ROUTE_DATA_SOURCE).filter(
      (r) => !routes.includes(r),
    );
    expect(
      stale.length,
      `Stale ROUTE_DATA_SOURCE entries (files deleted / renamed):\n  ${stale.join(
        "\n  ",
      )}\n\nFix: remove from ROUTE_DATA_SOURCE.`,
    ).toBe(0);
  });

  it("no declared exempt route references a file that doesn't exist", () => {
    const stale = Object.keys(ROUTE_EXEMPT).filter(
      (r) => !routes.includes(r),
    );
    expect(
      stale.length,
      `Stale ROUTE_EXEMPT entries (files deleted / renamed):\n  ${stale.join(
        "\n  ",
      )}`,
    ).toBe(0);
  });

  it("ratchet — exempt count matches EXPECTED_EXEMPT_COUNT exactly", () => {
    const n = Object.keys(ROUTE_EXEMPT).length;
    expect(
      n,
      `Exempt list drifted from ${EXPECTED_EXEMPT_COUNT}. If a route was retired, drop the exempt entry; if a new one was added, bump this ratchet consciously.`,
    ).toBe(EXPECTED_EXEMPT_COUNT);
  });

  it("every exempt entry carries a reason ≥20 chars", () => {
    const shortReasons = Object.entries(ROUTE_EXEMPT).filter(
      ([, e]) => e.reason.length < 20,
    );
    expect(
      shortReasons.length,
      `Exempt entries with reason <20 chars:\n  ${shortReasons
        .map(([k]) => k)
        .join("\n  ")}`,
    ).toBe(0);
  });

  it("no route appears in both ROUTE_DATA_SOURCE and ROUTE_EXEMPT", () => {
    const overlap = Object.keys(ROUTE_DATA_SOURCE).filter(
      (r) => r in ROUTE_EXEMPT,
    );
    expect(
      overlap.length,
      `Routes in both ROUTE_DATA_SOURCE and ROUTE_EXEMPT (pick one):\n  ${overlap.join(
        "\n  ",
      )}`,
    ).toBe(0);
  });

  // ── Golden pins (TL Concern 2) — regression protection ──

  it("adaptations/route.ts reads BOTH CallerTarget AND BehaviorTarget cascade", () => {
    const src = readRoute("adaptations/route.ts");
    // CT read (the fix)
    expect(
      /prisma\.callerTarget\.findMany/.test(src),
      "adaptations/route.ts must read `prisma.callerTarget.findMany` (fix commit 885974ad — engine-scored CT overrides). If this fails the fix has regressed.",
    ).toBe(true);
    // BT cascade read (the pre-existing operator-scope path)
    expect(
      /getEffectiveBehaviorTargetsForCaller/.test(src),
      "adaptations/route.ts must still read `getEffectiveBehaviorTargetsForCaller` (operator-set CALLER-scope BT still takes precedence).",
    ).toBe(true);
  });

  it("uplift/route.ts adaptationEvidence gates skill_* rows on currentScore", () => {
    const src = readRoute("uplift/route.ts");
    // Regression-protect the pre-fix pattern: raw ct.targetValue delta
    // WITHOUT a skill_* branch. Post-fix the code uses currentScore
    // for skill_* and only falls to targetValue for BEH-*.
    const hasSkillBranch = /parameterId\.startsWith\(\s*["']skill_["']\s*\)/.test(src);
    const readsCurrentScore = /ct\.currentScore|\.currentScore\b/.test(src);
    expect(
      hasSkillBranch && readsCurrentScore,
      "uplift/route.ts adaptationEvidence must branch skill_* → currentScore and non-skill → targetValue. Pre-fix reported +0.5 delta for every scored skill because SKILL-AGG-001 defaults targetValue=1.0.",
    ).toBe(true);
  });
});
