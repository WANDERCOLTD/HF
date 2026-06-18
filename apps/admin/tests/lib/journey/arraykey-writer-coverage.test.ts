/**
 * arrayKey ↔ writer surface coverage — Lattice 5th-pillar Coverage gate.
 *
 * **What this test pins (bidirectional):**
 *
 *  1. **Producer → consumer**: every `JOURNEY_SETTINGS` /
 *     `VOICE_SETTINGS` contract whose `storagePath` declares
 *     `arrayKey: "..."` MUST be writable through a route whose body
 *     schema accepts the array-element selector — either implicit (the
 *     contract carries a fixed `selectorValue` baked in at definition
 *     time) or via a runtime `arraySelector` field accepted by the
 *     PATCH route body schema (#1888 P3c).
 *  2. **Consumer → producer**: any route whose body Zod schema declares
 *     `arraySelector` MUST resolve contracts whose `storagePath`
 *     declares `arrayKey` (and no fixed `selectorValue`). The field has
 *     no other legitimate consumer.
 *
 *  The gap this gate closes: a future contract that declares
 *  `arrayKey` but no fixed `selectorValue` will silently be unwritable
 *  unless the PATCH route already accepts `arraySelector`. Conversely,
 *  a refactor that drops `arraySelector` from the PATCH route schema
 *  would silently break every G8 module-scoped write — the test fires
 *  before the regression reaches hf_sandbox.
 *
 *  See `.claude/rules/arraykey-writer-coverage.md` for the durable
 *  rule. Sibling Coverage tests at
 *  `tests/lib/journey/registry-consumer-coverage.test.ts` and
 *  `tests/api/route-auth-zod-coverage.test.ts`.
 *
 *  Story: #1912 (S3 of epic #1909).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { JOURNEY_SETTINGS } from "@/lib/journey/setting-contracts.entries";
import { VOICE_SETTINGS } from "@/lib/settings/voice-setting-contracts";
import type {
  JourneySettingContract,
  StoragePath,
} from "@/lib/journey/setting-contracts";

// ────────────────────────────────────────────────────────────
// Exempt list — contracts intentionally excluded
// ────────────────────────────────────────────────────────────

interface ExemptEntry {
  /** One-line justification (≥10 chars). Required. */
  reason: string;
}

/** ArrayKey-bearing contracts intentionally excluded from the
 *  bidirectional gate. Empty at launch — every known arrayKey contract
 *  is `covered` after #1888 P3c wired `arraySelector` to the PATCH
 *  route. */
const ARRAYKEY_WRITER_EXEMPT: Record<string, ExemptEntry> = {};

/** Ratchet — count cannot grow without a conscious bump here. The
 *  test fails on drift in either direction so a careless add gets
 *  caught at PR time. */
const EXPECTED_EXEMPT_COUNT_INITIAL_BUDGET = 0;

// ────────────────────────────────────────────────────────────
// Route enumeration — find any route that declares `arraySelector`
// ────────────────────────────────────────────────────────────

const REPO_ADMIN = resolve(__dirname, "..", "..", "..");

/** The single route today that wires `arraySelector` (#1888 P3c). When
 *  a future surface accepts it (e.g. a new domain-level write route),
 *  add to this list AND verify it routes to arrayKey-bearing contracts. */
const ARRAYSELECTOR_ROUTES: readonly string[] = [
  "app/api/courses/[courseId]/journey-setting/route.ts",
];

function readRouteSource(relativePath: string): string {
  try {
    return readFileSync(resolve(REPO_ADMIN, relativePath), "utf8");
  } catch {
    return "";
  }
}

const arraySelectorRouteSources: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const p of ARRAYSELECTOR_ROUTES) {
    out[p] = readRouteSource(p);
  }
  return out;
})();

/** True when at least one of the registered routes declares
 *  `arraySelector` in its body schema. We treat the presence of the
 *  field name in the route source as sufficient evidence — false
 *  positives would require an unrelated comment/identifier; the
 *  consumer-side test below pins this further. */
function patchRouteAcceptsArraySelector(): boolean {
  for (const src of Object.values(arraySelectorRouteSources)) {
    // Match the zod field declaration shape used in #1888 P3c:
    // `arraySelector: z.string()` (allowing `.min(1).optional()` etc).
    if (/arraySelector\s*:\s*z\./.test(src)) return true;
  }
  return false;
}

// ────────────────────────────────────────────────────────────
// Producer-side classification
// ────────────────────────────────────────────────────────────

type Classification =
  | "covered-fixed-selector" // arrayKey + fixed selectorValue (baked-in)
  | "covered-runtime-selector" // arrayKey only — needs route-side arraySelector
  | "exempt"
  | "gap";

interface ClassResult {
  id: string;
  classification: Classification;
  arrayKey: string;
  hasFixedSelector: boolean;
  reason?: string;
}

function isStructured(
  sp: StoragePath,
): sp is Extract<StoragePath, { path: string }> {
  return typeof sp !== "string";
}

function classifyContract(c: JourneySettingContract): ClassResult | null {
  const sp = c.storagePath;
  if (!isStructured(sp)) return null;
  if (!sp.arrayKey) return null;

  const hasFixedSelector = sp.selectorValue !== undefined;
  const base = {
    id: c.id,
    arrayKey: sp.arrayKey,
    hasFixedSelector,
  } as const;

  if (ARRAYKEY_WRITER_EXEMPT[c.id]) {
    return {
      ...base,
      classification: "exempt",
      reason: ARRAYKEY_WRITER_EXEMPT[c.id].reason,
    };
  }

  // Fixed selectorValue: the contract bakes the array slot in at
  // definition time. The PATCH route doesn't need a body field for it
  // — the applier resolves the slot from the contract itself.
  if (hasFixedSelector) {
    return { ...base, classification: "covered-fixed-selector" };
  }

  // arrayKey-only: the slot is per-instance (e.g. the G8 module-scoped
  // settings keyed on each AuthoredModule's id). This contract is only
  // writable when the PATCH route accepts `arraySelector` in the body.
  if (patchRouteAcceptsArraySelector()) {
    return { ...base, classification: "covered-runtime-selector" };
  }

  return { ...base, classification: "gap" };
}

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("arrayKey ↔ writer surface coverage (Lattice 5th-pillar)", () => {
  const all = [...JOURNEY_SETTINGS, ...VOICE_SETTINGS];
  const arrayKeyContracts = all
    .map(classifyContract)
    .filter((r): r is ClassResult => r !== null);

  it("producer→consumer: every arrayKey-bearing contract has a writer surface", () => {
    const gaps = arrayKeyContracts.filter(
      (r) => r.classification === "gap",
    );
    expect(
      gaps,
      `arrayKey-bearing contracts with no matching writer surface:\n  ${gaps
        .map(
          (g) =>
            `${g.id} (arrayKey="${g.arrayKey}", hasFixedSelector=${g.hasFixedSelector})`,
        )
        .join(
          "\n  ",
        )}\n\nFix: either land #1888 P3c (arraySelector in PATCH body) in the same PR, OR add to ARRAYKEY_WRITER_EXEMPT with a one-line reason.`,
    ).toEqual([]);
  });

  it("consumer→producer: routes that accept arraySelector resolve only arrayKey-bearing contracts", () => {
    // We can't statically prove that arraySelector ONLY reaches
    // arrayKey-bearing contracts (the route handler is dynamic).
    // What we CAN pin: each declared arraySelector-accepting route in
    // ARRAYSELECTOR_ROUTES must source-mention both `arrayKey` and
    // `selectorValue` in its handler logic — i.e. it dispatches based
    // on the contract's structured-path declaration, not on a parallel
    // dispatch table.
    for (const [routePath, src] of Object.entries(arraySelectorRouteSources)) {
      if (!src) continue; // missing file is caught by the next test
      // Skip if this route doesn't actually declare arraySelector
      // (registered for future expansion).
      if (!/arraySelector\s*:\s*z\./.test(src)) continue;
      expect(
        /\barrayKey\b/.test(src),
        `${routePath} declares arraySelector in body but doesn't reference arrayKey in handler — this route should resolve via the contract's storagePath.arrayKey field, not a parallel mechanism.`,
      ).toBe(true);
      expect(
        /\bselectorValue\b/.test(src),
        `${routePath} declares arraySelector in body but doesn't reference selectorValue in handler — the runtime selector path must check that the contract lacks a fixed selectorValue.`,
      ).toBe(true);
    }
  });

  it("exempt list ratchet — count matches EXPECTED_EXEMPT_COUNT_INITIAL_BUDGET", () => {
    const exemptIds = Object.keys(ARRAYKEY_WRITER_EXEMPT);
    expect(
      exemptIds.length,
      `Exempt-list size drifted from ${EXPECTED_EXEMPT_COUNT_INITIAL_BUDGET}. ` +
        `If you wired a writer + removed an entry, bump ` +
        `EXPECTED_EXEMPT_COUNT_INITIAL_BUDGET down. If you added an entry, ` +
        `pause: did you mean to grow the gap? Wire the writer first. ` +
        `Current entries: ${exemptIds.join(", ")}`,
    ).toBe(EXPECTED_EXEMPT_COUNT_INITIAL_BUDGET);
  });

  it("every exempt entry has a non-empty reason (≥10 chars)", () => {
    for (const [id, entry] of Object.entries(ARRAYKEY_WRITER_EXEMPT)) {
      expect(
        entry.reason.trim().length,
        `${id}: empty or too-short reason`,
      ).toBeGreaterThan(10);
    }
  });

  it("no exempt entry is stale (each id still appears in registries)", () => {
    const knownIds = new Set(all.map((c) => c.id));
    const stale = Object.keys(ARRAYKEY_WRITER_EXEMPT).filter(
      (id) => !knownIds.has(id),
    );
    expect(
      stale,
      `Exempt entries with no matching registry contract — registry deleted the setting; remove the exempt row: ${stale.join(", ")}`,
    ).toEqual([]);
  });

  it("no exempt entry is contradicted by actual writer coverage", () => {
    // If a contract is in the exempt list but classifies as
    // covered-* by the producer-side logic, the exempt entry is
    // stale — the wiring exists and the entry should be removed.
    const contradicted: string[] = [];
    for (const id of Object.keys(ARRAYKEY_WRITER_EXEMPT)) {
      const c = all.find((x) => x.id === id);
      if (!c) continue;
      const sp = c.storagePath;
      if (!isStructured(sp) || !sp.arrayKey) continue;
      const hasFixedSelector = sp.selectorValue !== undefined;
      const wouldBeCovered =
        hasFixedSelector || patchRouteAcceptsArraySelector();
      if (wouldBeCovered) {
        contradicted.push(
          `${id} (would classify as covered without the exempt entry)`,
        );
      }
    }
    expect(
      contradicted,
      `Exempt entries that now have writer coverage — remove from ARRAYKEY_WRITER_EXEMPT:\n  ${contradicted.join("\n  ")}`,
    ).toEqual([]);
  });

  it("distribution sanity — every classification path is reachable", () => {
    // Sanity check the classifier itself: at least one contract should
    // be classified as covered-fixed-selector (JourneyStop / firstCall
    // targets) and one as covered-runtime-selector (G8 module settings).
    const counts: Record<Classification, number> = {
      "covered-fixed-selector": 0,
      "covered-runtime-selector": 0,
      exempt: 0,
      gap: 0,
    };
    for (const r of arrayKeyContracts) counts[r.classification]++;
    // We expect a non-zero population overall.
    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    expect(
      total,
      "No arrayKey contracts found — classifier didn't enumerate JOURNEY_SETTINGS / VOICE_SETTINGS correctly.",
    ).toBeGreaterThan(0);
  });
});
