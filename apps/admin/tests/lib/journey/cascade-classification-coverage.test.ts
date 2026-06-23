/**
 * Cascade-chip classification coverage — A6 of epic #2225.
 *
 * Ratchets the cascade-coverage classification of every `JourneySettingContract`
 * + `VoiceSettingsContract`. Every contract MUST fall into exactly one of five
 * classifications:
 *
 *   - **`cascade-resolvable`** — `isResolvableKnob(cascadeKnobKey ?? id)` returns
 *     true. The contract's knob is registered in
 *     `lib/cascade/effective-value.ts::FAMILIES`. The Inspector's `CascadeValue`
 *     + `LayerBadge` chip resolves via the canonical resolver.
 *
 *   - **`course-only`** — no `cascadeKnobKey`, no `cascadeSources[]`, NOT
 *     listed in `PRODUCER_ONLY_CONTRACTS`. Intentionally course-scoped.
 *     `CascadeTraceBreadcrumb` renders a "Course-only" pill (A3, PR #2233).
 *
 *   - **`producer-only`** — listed in `PRODUCER_ONLY_CONTRACTS`. The G8
 *     module-scoped IELTS cohort intentionally landed producer-only per
 *     epic #1700 decision 5 (`HF_FLAG_IELTS_MODULE_SETTINGS`).
 *
 *   - **`static-chain`** — `cascadeSources.length > 0` AND
 *     `isResolvableKnob` returns false. The contract declares a static
 *     fallback chain (rendered as `<StaticChain>` rows in the breadcrumb)
 *     but isn't wired into the runtime cascade resolver.
 *
 *   - **`gap`** — none of the above. Fails the test — likely a contract
 *     authored with a `cascadeKnobKey` that doesn't match any FAMILIES
 *     entry AND no `cascadeSources` declared. Either wire the FAMILY
 *     (preferred) or declare `cascadeSources` (acceptable static-chain).
 *
 * **Why this test exists:**
 *
 *  Pre-A0 (PR #2230) the registry-consumer-coverage test silently
 *  shortcut on storage-path roots, producing false-negative COVERED
 *  verdicts. A0 fixed the coverage gate by routing through the real
 *  `isResolvableKnob` helper. A1a + A1b (PR #2231) classified every
 *  contract's intended cascade plan. A3 (PR #2233) wired the
 *  Course-only pill so the 73 intentionally-course-only contracts
 *  render explicit pill instead of silent null.
 *
 *  This test (A6) closes the loop: future drift between contract
 *  declarations + FAMILIES coverage + producer-only intent now fails
 *  CI immediately. New contracts that ship without a clear cascade
 *  plan land in `gap` and the operator chooses: wire the FAMILY,
 *  declare static `cascadeSources`, OR mark producer-only with reason.
 *
 * **How matching works:**
 *
 *  For each entry in `[...JOURNEY_SETTINGS, ...VOICE_SETTINGS]`:
 *    1. If listed in `PRODUCER_ONLY_CONTRACTS` → `producer-only`.
 *    2. Else if `isResolvableKnob(cascadeKnobKey ?? id)` → `cascade-resolvable`.
 *    3. Else if `cascadeSources.length > 0` → `static-chain`.
 *    4. Else if `cascadeKnobKey === undefined` AND `cascadeSources.length === 0`
 *       → `course-only`.
 *    5. Else → `gap`.
 *
 *  Order matters — producer-only takes precedence over the cascade
 *  family match so the G8 IELTS cohort doesn't accidentally start
 *  reporting as cascade-resolvable when a future FAMILY accidentally
 *  matches one of their knob keys.
 *
 * See `.claude/rules/cascade-classification-coverage.md` for the
 * durable rule + sibling Coverage-pillar gates.
 */

import { describe, it, expect } from "vitest";

import { JOURNEY_SETTINGS } from "@/lib/journey/setting-contracts.entries";
import { VOICE_SETTINGS } from "@/lib/settings/voice-setting-contracts";
import { isResolvableKnob } from "@/lib/cascade/effective-value";
import type { JourneySettingContract } from "@/lib/journey/setting-contracts";

// ────────────────────────────────────────────────────────────
// Producer-only contracts — G8 module-scoped IELTS cohort
// (epic #1700 decision 5, gated by HF_FLAG_IELTS_MODULE_SETTINGS).
// These intentionally lack a cascade resolver — they're scoped to
// `AuthoredModule.settings` and read by Phase 2 transforms when the
// flag flips. The cascade chip should render as producer-only here,
// not as a "Course-only" misclassification.
// ────────────────────────────────────────────────────────────

interface ProducerOnlyEntry {
  /** >20-char reason describing why the contract is intentionally
   *  producer-only (no cascade family OR static chain). */
  reason: string;
}

const PRODUCER_ONLY_CONTRACTS: Record<string, ProducerOnlyEntry> = {
  moduleQuestionTarget: {
    reason: "G8 IELTS module-scoped — HF_FLAG_IELTS_MODULE_SETTINGS Phase 2 wiring (epic #1700 decision 5).",
  },
  moduleMinSpeakingSec: {
    reason: "G8 IELTS module-scoped — HF_FLAG_IELTS_MODULE_SETTINGS Phase 2 wiring (epic #1700 decision 5).",
  },
  moduleCueCardPool: {
    reason: "G8 IELTS module-scoped — HF_FLAG_IELTS_MODULE_SETTINGS Phase 2 wiring (epic #1700 decision 5).",
  },
  moduleTopicPool: {
    reason: "G8 IELTS module-scoped — HF_FLAG_IELTS_MODULE_SETTINGS Phase 2 wiring (epic #1700 decision 5).",
  },
  moduleClosingLine: {
    reason: "G8 IELTS module-scoped — HF_FLAG_IELTS_MODULE_SETTINGS Phase 2 wiring (epic #1700 decision 5).",
  },
  moduleFirstTimeOrientationLine: {
    reason: "G8 IELTS module-scoped — HF_FLAG_IELTS_MODULE_SETTINGS Phase 2 wiring (epic #1700 decision 5).",
  },
  moduleScheduledCues: {
    reason: "G8 IELTS module-scoped — HF_FLAG_IELTS_MODULE_SETTINGS Phase 2 wiring (epic #1700 decision 5).",
  },
  moduleScaffoldPool: {
    reason: "G8 IELTS module-scoped — HF_FLAG_IELTS_MODULE_SETTINGS Phase 2 wiring (epic #1700 decision 5).",
  },
  moduleProfileFieldsToCapture: {
    reason: "G8 IELTS module-scoped — HF_FLAG_IELTS_MODULE_SETTINGS Phase 2 wiring (epic #1700 decision 5).",
  },
  moduleScoreReadoutMode: {
    reason: "S8 G8 module-scoped — per-module score readout policy (course-ref v2.3); course-only override, no upstream Domain/System cascade by design.",
  },
  moduleScaffoldsByStallType: {
    reason: "S7 G8 module-scoped — per-StallType scaffold map (BDD US-P3-02b); runtime consumer (typed pool selection) is the follow-on PR.",
  },
  moduleLearnerShellOverride: {
    reason: "S3 G8 module-scoped — per-module LearnerShellCapabilities DISABLE-only patch (epic #2163 LD8 — capabilities are HF-canonical, not customer-tunable upstream).",
  },
};

// ────────────────────────────────────────────────────────────
// Ratchets — incumbent population as of A6 land time
// (this branch's base; see brief for the post-A1b expectation that
// differs because A1b hasn't merged yet — surfaced in the PR report).
//
// Each ratchet is exact-match. Closing or opening a row forces a
// conscious bump in the same PR.
// ────────────────────────────────────────────────────────────

// Drift log:
// - 8 → 10 cascade-resolvable in #2176 S1 (this PR) — pre-existing
//   drift truth-up; `loMasteryThreshold` + `assessmentReadinessThreshold`
//   were wired into FAMILIES in a prior PR without updating this
//   ratchet. Same Lattice-hygiene drop pattern as the control-data-shape
//   stale-exempts cleanup in Slice 3.
// - 11 → 10 static-chain — same prior PR promoted one previously-
//   static contract into FAMILIES.
// - 105 → 106 total — this PR adds the `assessmentPlan` course-only
//   contract.
// - 77 → 77 course-only — net zero (76 pre-existing course-only +
//   `assessmentPlan` lands here = 77).
const EXPECTED_CASCADE_RESOLVABLE_COUNT = 10;
const EXPECTED_COURSE_ONLY_COUNT = 77;
// S8 + S7 + S3 (this PR) — 9 → 12 producer-only contracts; the three new
// G8 module-scoped knobs follow the existing IELTS-cohort pattern (no
// upstream Domain/System cascade by design — module-scoped storage path).
const EXPECTED_PRODUCER_ONLY_COUNT = 12;
const EXPECTED_STATIC_CHAIN_COUNT = 10;
const EXPECTED_GAP_COUNT = 0;

// S8 + S7 + S3 — 106 → 109 total contracts.
const EXPECTED_TOTAL_COUNT = 109;

// ────────────────────────────────────────────────────────────
// Classification
// ────────────────────────────────────────────────────────────

type Classification =
  | "cascade-resolvable"
  | "course-only"
  | "producer-only"
  | "static-chain"
  | "gap";

interface ClassResult {
  id: string;
  classification: Classification;
  detail?: string;
}

function classify(c: JourneySettingContract): ClassResult {
  // Producer-only takes precedence so a future FAMILY accidentally
  // matching a G8 knob key doesn't silently reclassify the cohort.
  if (PRODUCER_ONLY_CONTRACTS[c.id]) {
    return { id: c.id, classification: "producer-only" };
  }

  const knobKey = c.cascadeKnobKey ?? c.id;
  if (isResolvableKnob(knobKey)) {
    return { id: c.id, classification: "cascade-resolvable" };
  }

  const sources = c.cascadeSources ?? [];
  if (sources.length > 0) {
    return { id: c.id, classification: "static-chain" };
  }

  if (c.cascadeKnobKey === undefined && sources.length === 0) {
    return { id: c.id, classification: "course-only" };
  }

  return {
    id: c.id,
    classification: "gap",
    detail:
      `cascadeKnobKey=${c.cascadeKnobKey ?? "undefined"} ` +
      `resolvable=false sources=${sources.length}`,
  };
}

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("Cascade classification coverage (Lattice 5th-pillar — A6 of #2225)", () => {
  const all = [...JOURNEY_SETTINGS, ...VOICE_SETTINGS];
  const results = all.map(classify);

  const counts: Record<Classification, number> = {
    "cascade-resolvable": 0,
    "course-only": 0,
    "producer-only": 0,
    "static-chain": 0,
    gap: 0,
  };
  for (const r of results) counts[r.classification]++;

  it("registry size sanity — total contracts matches EXPECTED_TOTAL_COUNT", () => {
    expect(
      all.length,
      `Total contract count drifted from ${EXPECTED_TOTAL_COUNT}. If this is ` +
        `intentional (new contract added or one retired), update the per-class ` +
        `ratchets AND EXPECTED_TOTAL_COUNT in the same PR. Current: ${all.length}`,
    ).toBe(EXPECTED_TOTAL_COUNT);
  });

  it("every contract classifies into exactly one of the 5 categories (no gaps beyond ratchet)", () => {
    const gaps = results.filter((r) => r.classification === "gap");
    expect(
      gaps,
      `Contracts that don't classify into any of {cascade-resolvable, ` +
        `course-only, producer-only, static-chain}. Likely cause: a contract ` +
        `with a non-undefined cascadeKnobKey that doesn't match any FAMILY ` +
        `AND no cascadeSources. Either wire the FAMILY in ` +
        `lib/cascade/effective-value.ts OR declare cascadeSources:\n  ` +
        gaps.map((g) => `${g.id}: ${g.detail}`).join("\n  "),
    ).toEqual([]);
  });

  it("ratchet — cascade-resolvable count matches EXPECTED_CASCADE_RESOLVABLE_COUNT", () => {
    expect(
      counts["cascade-resolvable"],
      `cascade-resolvable count drifted. Either you added a FAMILY entry to ` +
        `lib/cascade/effective-value.ts (bump UP) OR wired a contract that now ` +
        `matches an existing FAMILY (bump UP) OR retired a contract (bump DOWN). ` +
        `Current ids: ${results
          .filter((r) => r.classification === "cascade-resolvable")
          .map((r) => r.id)
          .join(", ")}`,
    ).toBe(EXPECTED_CASCADE_RESOLVABLE_COUNT);
  });

  it("ratchet — course-only count matches EXPECTED_COURSE_ONLY_COUNT", () => {
    expect(
      counts["course-only"],
      `course-only count drifted. Either you wired a new contract without ` +
        `cascadeKnobKey or cascadeSources (bump UP), OR you wired the FAMILY / ` +
        `declared cascadeSources for a previously course-only contract (bump DOWN).`,
    ).toBe(EXPECTED_COURSE_ONLY_COUNT);
  });

  it("ratchet — producer-only count matches EXPECTED_PRODUCER_ONLY_COUNT", () => {
    expect(
      counts["producer-only"],
      `producer-only count drifted. The G8 module-scoped cohort is fixed at 9 ` +
        `(epic #1700 decision 5). Adding a new producer-only contract requires ` +
        `adding it to PRODUCER_ONLY_CONTRACTS with a >20-char reason AND ` +
        `bumping EXPECTED_PRODUCER_ONLY_COUNT.`,
    ).toBe(EXPECTED_PRODUCER_ONLY_COUNT);
  });

  it("ratchet — static-chain count matches EXPECTED_STATIC_CHAIN_COUNT", () => {
    expect(
      counts["static-chain"],
      `static-chain count drifted. Either a contract declared new cascadeSources ` +
        `without wiring a FAMILY (bump UP) OR a previously-static contract was ` +
        `wired into FAMILIES (bump DOWN — preferred direction). ` +
        `Current ids: ${results
          .filter((r) => r.classification === "static-chain")
          .map((r) => r.id)
          .join(", ")}`,
    ).toBe(EXPECTED_STATIC_CHAIN_COUNT);
  });

  it("ratchet — gap count matches EXPECTED_GAP_COUNT", () => {
    expect(counts.gap).toBe(EXPECTED_GAP_COUNT);
  });

  it("every PRODUCER_ONLY_CONTRACTS entry has a non-empty reason (>20 chars)", () => {
    for (const [id, entry] of Object.entries(PRODUCER_ONLY_CONTRACTS)) {
      expect(entry.reason.trim().length, `${id}: reason too short`).toBeGreaterThan(20);
    }
  });

  it("no PRODUCER_ONLY_CONTRACTS entry is stale (each id still appears in the registry)", () => {
    const knownIds = new Set(all.map((c) => c.id));
    const stale = Object.keys(PRODUCER_ONLY_CONTRACTS).filter((id) => !knownIds.has(id));
    expect(
      stale,
      `PRODUCER_ONLY_CONTRACTS entries with no matching contract — registry ` +
        `deleted the contract; remove the row: ${stale.join(", ")}`,
    ).toEqual([]);
  });

  it("no PRODUCER_ONLY_CONTRACTS entry is contradicted by an actual FAMILIES match", () => {
    // If a producer-only contract's knob key would actually resolve via
    // FAMILIES, that's a misclassification: either remove from the producer
    // list (cascade is now wired) or rename the knob key.
    const contradicted: string[] = [];
    for (const id of Object.keys(PRODUCER_ONLY_CONTRACTS)) {
      const c = all.find((x) => x.id === id);
      if (!c) continue;
      const knobKey = c.cascadeKnobKey ?? c.id;
      if (isResolvableKnob(knobKey)) {
        contradicted.push(`${id} (knobKey=${knobKey} now matches a FAMILY)`);
      }
    }
    expect(
      contradicted,
      `PRODUCER_ONLY_CONTRACTS entries that now have FAMILIES coverage — ` +
        `remove from PRODUCER_ONLY_CONTRACTS and bump the cascade-resolvable ` +
        `ratchet:\n  ${contradicted.join("\n  ")}`,
    ).toEqual([]);
  });

  it("classification distribution sums to total (classifier sanity)", () => {
    const sum = Object.values(counts).reduce((s, n) => s + n, 0);
    expect(sum).toBe(all.length);
  });
});
