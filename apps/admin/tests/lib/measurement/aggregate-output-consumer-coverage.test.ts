/**
 * AGGREGATE output → COMPOSE/runtime consumer coverage — Lattice
 * protection one layer DOWN from M2 loop-closure (#1967 M2).
 *
 * **Why this exists:**
 *
 * M2 (`parameter-loop-closure.test.ts`) pins the INPUT side of every
 * AGGREGATE/ADAPT/REWARD spec — every measured BEH-* parameter must
 * have some spec consuming its `CallScore`. That closes the cascade
 * from MEASURE → AGGREGATE.
 *
 * But AGGREGATE specs WRITE to `CallerAttribute` (or `CallerTarget`)
 * via `targetProfileKey`. If no compose / cascade / pipeline reader
 * picks the key up at next-call time, the producer is orphaned —
 * the loop runs end-to-end but the output is dead state. Same
 * silent-gain-zero class as M2 catches on the input side.
 *
 * This test walks every AGGREGATE spec's `targetProfileKey` and
 * verifies SOMEONE downstream reads the key prefix.
 *
 * **What counts as a consumer:**
 *
 * Any reference to the key (or its `namespace:` prefix) under:
 *   - `lib/prompt/composition/**` (compose-time reads, the canonical
 *     loop-closing surface)
 *   - `lib/cascade/**` (cascade resolvers reading aggregated state)
 *   - `lib/pipeline/**` (downstream ADAPT / SUPERVISE stages)
 *   - `lib/scoring/**`, `lib/goals/**`, `lib/measurement/**` (other
 *     runtime consumers)
 *
 * Key matching: full literal id OR the prefix up to and including
 * the last `:` separator (e.g. `behavior_profile:companion:foo`
 * matches if `behavior_profile:companion:` appears anywhere).
 *
 * **Sentinel exemption:**
 *
 * `_caller_target_current_score` (SKILL-AGG-001) is a SENTINEL
 * meaning "write to `CallerTarget.currentScore` via EMA", not a
 * literal `CallerAttribute` key. It's consumed via the
 * `CallerTarget.currentScore` field (read by every ACHIEVE goal
 * progress calc). No prefix-grep needed; allow-listed.
 *
 * **Classifications:**
 *
 *   - `covered` — at least one consumer dir references the prefix
 *   - `sentinel` — SKILL-AGG `_caller_target_current_score` carve-out
 *   - `exempt` — listed in `AGG_OUTPUT_EXEMPT` with reason
 *   - `gap` — no consumer found anywhere
 *
 * **Ratchet:** `EXPECTED_GAP_COUNT` caps the gap count. 2026-06-19
 * incumbent: **11** producer-only AGG output prefixes:
 *
 *   - 9 from BEH-AGG-001 (companion / personality / supervision /
 *     engagement / curriculum / learning / reinforcement / onboarding
 *     / core-style) — born of the structural M2 closure pass; the
 *     compose-side readers are pedagogy follow-on work
 *   - 2 from LEARN-PROF-001 pre-existing (`feedback_style`,
 *     `question_frequency`) — pre-dated the M1/M2 epic
 *
 * See `.claude/rules/parameter-loop-closure.md` (sibling) +
 * `docs/CHAIN-CONTRACTS.md` §3e Link M2 (the input side).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const APPS_ADMIN = resolve(__dirname, "..", "..", "..");
const SPECS_DIR = join(APPS_ADMIN, "docs-archive", "bdd-specs");

// ────────────────────────────────────────────────────────────
// Collect targetProfileKey from every AGGREGATE spec
// ────────────────────────────────────────────────────────────

interface KeyOrigin {
  key: string;
  prefix: string;
  specSlug: string;
}

function getPrefix(key: string): string {
  if (!key.includes(":")) return key;
  const parts = key.split(":");
  parts.pop();
  return parts.join(":") + ":";
}

function walkSpec(
  obj: unknown,
  out: KeyOrigin[],
  specSlug: string,
): void {
  if (obj && typeof obj === "object") {
    if (Array.isArray(obj)) {
      for (const item of obj) walkSpec(item, out, specSlug);
      return;
    }
    const record = obj as Record<string, unknown>;
    for (const [k, v] of Object.entries(record)) {
      if (k === "targetProfileKey" && typeof v === "string") {
        out.push({ key: v, prefix: getPrefix(v), specSlug });
      } else {
        walkSpec(v, out, specSlug);
      }
    }
  }
}

const KEY_ORIGINS: KeyOrigin[] = (() => {
  const out: KeyOrigin[] = [];
  const files = readdirSync(SPECS_DIR).filter((f) => f.endsWith(".spec.json"));
  for (const fname of files) {
    const slug = fname.replace(/\.spec\.json$/, "");
    let spec: { outputType?: string } & Record<string, unknown> = {};
    try {
      spec = JSON.parse(readFileSync(join(SPECS_DIR, fname), "utf8"));
    } catch {
      continue;
    }
    if (spec.outputType !== "AGGREGATE") continue;
    walkSpec(spec, out, slug);
  }
  return out;
})();

// ────────────────────────────────────────────────────────────
// Consumer source concat
// ────────────────────────────────────────────────────────────

const CONSUMER_DIRS = [
  "lib/prompt/composition",
  "lib/cascade",
  "lib/pipeline",
  "lib/scoring",
  "lib/measurement",
  "lib/goals",
];

function walkTs(dir: string): string[] {
  const acc: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
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
      acc.push(...walkTs(full));
    } else if (
      (e.endsWith(".ts") || e.endsWith(".tsx")) &&
      !e.endsWith(".test.ts") &&
      !e.endsWith(".test.tsx")
    ) {
      if (full.includes("/__tests__/")) continue;
      acc.push(full);
    }
  }
  return acc;
}

const CONSUMER_SOURCE: string = (() => {
  const files: string[] = [];
  for (const dir of CONSUMER_DIRS) {
    files.push(...walkTs(join(APPS_ADMIN, dir)));
  }
  return files
    .map((f) => {
      try {
        return readFileSync(f, "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");
})();

// ────────────────────────────────────────────────────────────
// Sentinels + exempt list
// ────────────────────────────────────────────────────────────

const SENTINEL_KEYS = new Set([
  // SKILL-AGG-001 writes EMA to CallerTarget.currentScore via this
  // sentinel; the consumer is CallerTarget.currentScore field reads
  // (every ACHIEVE goal progress calc), not a literal key string.
  "_caller_target_current_score",
]);

interface ExemptEntry {
  reason: string;
}

/**
 * 2026-06-19 — empty at land time. Producer-only debt is tracked via
 * the ratchet, NOT the exempt list (the exempt list is for cases
 * where the prefix legitimately should NEVER have a compose reader —
 * e.g., an internal-only audit signal). If pedagogy/design later
 * decides a behavior_profile:* namespace doesn't need a compose
 * reader, that prefix moves here.
 */
const AGG_OUTPUT_EXEMPT: Record<string, ExemptEntry> = {};

// ────────────────────────────────────────────────────────────
// Classification
// ────────────────────────────────────────────────────────────

type Classification = "covered" | "sentinel" | "exempt" | "gap";

interface Result {
  prefix: string;
  classification: Classification;
  specs: string[];
}

function classify(prefix: string, specs: string[]): Result {
  if (SENTINEL_KEYS.has(prefix) || SENTINEL_KEYS.has(prefix.replace(/:$/, ""))) {
    return { prefix, classification: "sentinel", specs };
  }
  if (AGG_OUTPUT_EXEMPT[prefix]) {
    return { prefix, classification: "exempt", specs };
  }
  // Prefix grep — find any reference under consumer dirs.
  const probe = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(probe).test(CONSUMER_SOURCE)) {
    return { prefix, classification: "covered", specs };
  }
  return { prefix, classification: "gap", specs };
}

const RESULTS: Result[] = (() => {
  // Group origins by prefix
  const byPrefix = new Map<string, Set<string>>();
  for (const o of KEY_ORIGINS) {
    if (!byPrefix.has(o.prefix)) byPrefix.set(o.prefix, new Set());
    byPrefix.get(o.prefix)!.add(o.specSlug);
  }
  return Array.from(byPrefix.entries()).map(([p, sset]) =>
    classify(p, Array.from(sset).sort()),
  );
})();

// ────────────────────────────────────────────────────────────
// Ratchet
// ────────────────────────────────────────────────────────────

/**
 * 2026-06-19 incumbent: 11 producer-only AGG output prefixes.
 *
 *   - 9 from BEH-AGG-001 (behavior_profile:companion: / personality: /
 *     supervision: / engagement: / curriculum: / learning: /
 *     reinforcement: / onboarding: / style:) — born of #1967 M2
 *     structural closure; compose-side readers are pedagogy follow-on
 *     work
 *   - 2 from LEARN-PROF-001 pre-existing (`feedback_style`,
 *     `question_frequency`) — pre-dated the #1967 epic
 *
 * Wiring a compose transform that reads `behavior_profile:*` keys
 * drops this ratchet by 1 per prefix consumed. Pedagogy decides
 * which prefixes get readers vs which join AGG_OUTPUT_EXEMPT.
 */
const EXPECTED_GAP_COUNT = 11;

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("AGGREGATE output → consumer coverage (Lattice Coverage pillar)", () => {
  const covered = RESULTS.filter((r) => r.classification === "covered");
  const sentinel = RESULTS.filter((r) => r.classification === "sentinel");
  const exempt = RESULTS.filter((r) => r.classification === "exempt");
  const gaps = RESULTS.filter((r) => r.classification === "gap");

  it("distribution sanity — every prefix is classifiable", () => {
    expect(
      covered.length + sentinel.length + exempt.length + gaps.length,
    ).toBe(RESULTS.length);
    expect(RESULTS.length).toBeGreaterThan(10);
  });

  it("ratchet — gap count cannot exceed the 2026-06-19 incumbent budget", () => {
    expect(
      gaps.length,
      `${gaps.length} AGGREGATE output prefixes have no compose / cascade / ` +
        `pipeline consumer. Ratchet caps this at ${EXPECTED_GAP_COUNT}.\n\n` +
        `If you LOWERED the count (wired a consumer): drop ` +
        `EXPECTED_GAP_COUNT to ${gaps.length}.\n\n` +
        `If you RAISED it: a new AGGREGATE spec output landed without a ` +
        `reader. Either wire a compose transform that reads the prefix, ` +
        `OR add the prefix to AGG_OUTPUT_EXEMPT with a documented reason ` +
        `(internal-only signal, deferred to follow-on, etc.).\n\n` +
        `Sample gap prefixes:\n  ${gaps
          .slice(0, 12)
          .map((g) => `${g.prefix} (from ${g.specs.join(", ")})`)
          .join("\n  ")}`,
    ).toBeLessThanOrEqual(EXPECTED_GAP_COUNT);
  });

  it("every exempt entry has a non-empty reason (>20 chars)", () => {
    for (const [prefix, entry] of Object.entries(AGG_OUTPUT_EXEMPT)) {
      expect(
        entry.reason.trim().length,
        `Exempt entry ${prefix} has empty/short reason`,
      ).toBeGreaterThan(20);
    }
  });

  it("no exempt entry is stale — prefix still appears in some AGG spec", () => {
    const known = new Set(RESULTS.map((r) => r.prefix));
    const stale = Object.keys(AGG_OUTPUT_EXEMPT).filter(
      (p) => !known.has(p),
    );
    expect(
      stale,
      `Exempt entries for AGG output prefixes no longer in any spec — ` +
        `remove these stale entries:\n  ${stale.join("\n  ")}`,
    ).toEqual([]);
  });

  it("publishes the distribution (operator log)", () => {
    const breakdown = {
      covered: covered.length,
      sentinel: sentinel.length,
      exempt: exempt.length,
      gap: gaps.length,
      totalPrefixes: RESULTS.length,
      totalKeys: KEY_ORIGINS.length,
    };
    expect(breakdown.totalPrefixes).toBeGreaterThan(0);
    // Test name carries the data — operator reads it in CI.
  });
});
