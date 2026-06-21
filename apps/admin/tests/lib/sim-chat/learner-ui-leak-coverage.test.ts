/**
 * Learner-UI leak coverage — Lattice 5th-pillar Coverage test.
 *
 * **What this test pins:**
 *  Internal-only labels and identifiers (parameter IDs, criterion
 *  labels, OUT-NN outcome codes, spec slugs, raw mastery scores) MUST
 *  NOT appear as literal strings in any source file under the
 *  **learner-UI render dirs**: `components/sim/**`, `app/x/student/**`,
 *  `apps/foh/**`.
 *
 *  This catches the "internal label leaked to learner-visible surface"
 *  failure mode. Live incident: PR #2134 (#1955) — merged 2026-06-20 —
 *  passes `IELTS_SKILL_LABELS["skill_lexical_resource_lr"] = "Lexical
 *  Resource"` as the value of `PinnedCardContent.focusArea` AND
 *  references "criterion" in the tutor directive. The BDD spec
 *  (HF-IELTS-Pre-Voice-Testing-Checklist.md, US-P3-01) requires the
 *  learner pin show only ONE of the 4 technique labels (`giving
 *  reasons` / `structuring an argument` / `handling a challenge` /
 *  `expanding an answer`) — never the criterion name, never the
 *  parameter ID, never the score.
 *
 *  This test is the structural backstop. The runtime backstop is a
 *  SUPERVISE-stage spec (proposed in ADR
 *  `docs/decisions/2026-06-21-session-focus-rewardspec-substrate.md`)
 *  that scans the composed prompt at compose-time for the same leak
 *  patterns. The two layers together close the loop.
 *
 * **Course-agnostic by design:**
 *  Each course registers its internal-only label set via
 *  `INTERNAL_LABEL_REGISTRY`. The test walks the union of all sets
 *  and fails on any literal occurrence in learner-UI dirs. New course
 *  → add its set to the registry. No course-specific test edits
 *  beyond the registry entry.
 *
 * **How matching works:**
 *  - Concatenate source from `LEARNER_UI_DIRS` (excluding `.test.ts`).
 *  - For each label in every internal set, check if it appears as a
 *    quoted string literal (`"X"` or `'X'`) anywhere in the source.
 *  - Match → leak. Listed in exempt → exempt. Else → gap (test fails).
 *
 *  Exempt entries carry a substantive reason + are pinned by a ratchet.
 *  The incumbent leak count at this test's birth (2026-06-21) is
 *  recorded in `EXPECTED_LEAK_COUNT`. The leak count can only DROP.
 *
 * **How to fix a failure:**
 *  - "New leak appeared": the label was added to a learner-UI render
 *    path. Either move the label assignment to a server-side projection
 *    that maps internal → learner-safe BEFORE the data reaches the
 *    learner-UI dir, OR add to `LEARNER_UI_LEAK_EXEMPT` with a >20-char
 *    reason describing the structural constraint.
 *  - "Incumbent leak cleared": drop `EXPECTED_LEAK_COUNT`.
 *
 *  See `.claude/rules/learner-ui-leak-coverage.md` for the durable rule
 *  + ADR `docs/decisions/2026-06-21-session-focus-rewardspec-substrate.md`
 *  for the architectural framing.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ADMIN = resolve(__dirname, "..", "..", "..");
const REPO_ROOT = resolve(REPO_ADMIN, "..", "..");

// ────────────────────────────────────────────────────────────
// Internal-label registry — course-agnostic, extensible.
//
// SHARED SOURCE OF TRUTH: docs/kb/generated/internal-label-registry.json
// (#2151 S5 of epic #2145).
//
// Both gates read the same JSON:
//   - BUILD-TIME (this file, PR #2144) — static-literal scan of
//     learner-UI source files.
//   - RUNTIME (lib/pipeline/runners/supervise/leak-scan.ts, #2151) —
//     SUPERVISE-stage scan of the composed prompt + pinned cards.
//
// To extend: add a new top-level entry to `registry` in the JSON.
// Both gates auto-pick it up. No code edit needed.
// ────────────────────────────────────────────────────────────

interface InternalLabelSet {
  /** Why these labels are internal-only. */
  description: string;
  /** The labels (as they appear in source — exact case + spacing). */
  labels: readonly string[];
}

interface SharedInternalLabelRegistryJson {
  version: number;
  registry: Record<string, InternalLabelSet>;
}

const SHARED_REGISTRY_PATH = resolve(
  REPO_ROOT,
  "docs",
  "kb",
  "generated",
  "internal-label-registry.json",
);

const SHARED_REGISTRY_JSON = JSON.parse(
  readFileSync(SHARED_REGISTRY_PATH, "utf8"),
) as SharedInternalLabelRegistryJson;

export const INTERNAL_LABEL_REGISTRY: Record<string, InternalLabelSet> =
  SHARED_REGISTRY_JSON.registry;

// ────────────────────────────────────────────────────────────
// Learner-safe label registry — #2145 Phase A Generic SessionFocus
// substrate (`Part3TechniqueFocus` first instance).
//
// These are the LEARNER-FACING values that the session-focus-policy
// runner projects internal weakness signals onto. They MAY appear in
// learner-UI source (e.g. as a TypeScript union member, a default-pin
// fallback, or a Storybook fixture). The leak gate above scans for
// INTERNAL-only labels — this whitelist documents that these strings
// are explicitly the projection target, NOT a leak.
//
// Per `lib/types/json-fields.ts::Part3TechniqueFocus` JSDoc, each
// course declares its own typed union here. Adding a new course →
// add an entry to LEARNER_SAFE_REGISTRY documenting (a) the union
// name, (b) the spec slug that projects to it, (c) the BDD reference.
//
// This registry is DOCUMENTATION + future-proofing — it isn't read by
// the leak test today (the leak test only scans INTERNAL_LABEL_REGISTRY
// for forbidden strings). When a future course's selection policy is
// authored, this registry is the canonical "where is the union
// declared" map.
// ────────────────────────────────────────────────────────────

interface LearnerSafeLabelSet {
  /** Why these labels are learner-safe + where the typed union lives. */
  description: string;
  /** The labels (as they appear in source — exact case + spacing). */
  labels: readonly string[];
  /** The TypeScript union type name in lib/types/json-fields.ts. */
  unionName: string;
  /** The session-focus-policy AnalysisSpec slug that projects to this set. */
  projectingSpecSlug: string;
}

export const LEARNER_SAFE_REGISTRY: Record<string, LearnerSafeLabelSet> = {
  IELTS_PART3_TECHNIQUE: {
    description:
      "IELTS Part 3 technique focus labels — the 4 BDD-mandated learner-facing values for the 'Today's focus' pin on Part 3 sessions. Per BDD US-P3-01 + HF-IELTS-Pre-Voice-Testing-Checklist.md Unit 4. Projected from weakest IELTS Skill criterion (FC/LR/GRA/P) by IELTS-P3-FOCUS-001 (epic #2145 S4 — pending #2137 wired scores).",
    labels: [
      "giving reasons",
      "structuring an argument",
      "handling a challenge",
      "expanding an answer",
    ],
    unionName: "Part3TechniqueFocus",
    projectingSpecSlug: "IELTS-P3-FOCUS-001",
  },
};

// ────────────────────────────────────────────────────────────
// Learner-UI dirs — where leaks become user-visible.
// ────────────────────────────────────────────────────────────

const LEARNER_UI_DIRS: string[] = [
  // SIM / Chat surface mounted in admin app today (the actual learner
  // experience is the same SimChat surface admin testers exercise).
  join(REPO_ADMIN, "components", "sim"),
  // Per-learner views surfaced under the admin /x/student namespace.
  join(REPO_ADMIN, "app", "x", "student"),
  // FOH (front-of-house) learner app — separate workspace.
  join(REPO_ROOT, "apps", "foh", "app"),
  join(REPO_ROOT, "apps", "foh", "components"),
];

// ────────────────────────────────────────────────────────────
// Exempt list — leaks the test consciously accepts (e.g. labels in
// admin-tester-only diagnostic surfaces that share files with learner
// UI, or labels in operator-only debug panels embedded in SimChat).
// Required: >20-char reason. Each entry is keyed `<setKey>:<label>`
// and pinned by ratchet — count cannot grow.
// ────────────────────────────────────────────────────────────

interface LeakExemptEntry {
  reason: string;
}

// After the #2151 migration, INTERNAL_LABEL_REGISTRY is loaded from the
// shared JSON so `keyof typeof` resolves to `string`. The keys still
// follow the `{setKey}:{label}` convention; stale-row + reason checks
// pin the relationship at test time.
type LeakKey = string;

const LEARNER_UI_LEAK_EXEMPT: Record<LeakKey, LeakExemptEntry> = {
  // BDD US-Mock-05 (HF-IELTS-Pre-Voice-Testing-Checklist.md) explicitly
  // sanctions the Mock Results screen to display per-criterion scores
  // (Overall band + FC / LR / GRA / P bands + one strength + one
  // area-to-work-on). This is the ONLY learner-facing surface where
  // IELTS criterion labels are allowed; the labels here serve that
  // screen via apps/foh/app/api/scores/route.ts (FOH stub today,
  // proxies HF backend in prod). Pin context (Part 3 "Today's focus")
  // MUST NOT use criterion labels — that's the #1955 leak class
  // tracked by the runtime SUPERVISE-spec gate (epic #2135 S4) AND
  // the proposed Part3TechniqueFocus union (separate story).
  "IELTS_CRITERIA:Lexical Resource": {
    reason:
      "Mock Results screen sanctioned per BDD US-Mock-05 — per-criterion bands shown only on Results screen; not in pin/session UI",
  },
  "IELTS_CRITERIA:Pronunciation": {
    reason:
      "Mock Results screen sanctioned per BDD US-Mock-05 — per-criterion bands shown only on Results screen; not in pin/session UI",
  },
};

/** Ratchet — total incumbent leaks beyond exempt. The #1955-class
 *  runtime leak (values flowing through props from internal sources
 *  like `derive-focus-area.ts::IELTS_SKILL_LABELS` into
 *  `PinnedCardContent.focusArea`) does NOT fire this static-literal
 *  gate — it requires the runtime SUPERVISE-spec scan filed under
 *  epic #2135 S4 (#2139). This gate catches the complementary class:
 *  internal-only labels hardcoded as string literals in learner-UI
 *  source files. */
const EXPECTED_LEAK_COUNT = 0;

/** Ratchet — exempt list size. 2 incumbents at launch (both Mock
 *  Results screen labels). */
const EXPECTED_EXEMPT_COUNT = 2;

// ────────────────────────────────────────────────────────────
// Source-walk
// ────────────────────────────────────────────────────────────

function walkSource(dir: string): string[] {
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
      if (e === "node_modules" || e === "__tests__" || e === ".next") continue;
      out.push(...walkSource(full));
    } else if (
      (e.endsWith(".ts") || e.endsWith(".tsx")) &&
      !e.endsWith(".test.ts") &&
      !e.endsWith(".test.tsx")
    ) {
      out.push(full);
    }
  }
  return out;
}

const LEARNER_UI_SOURCE: string = (() => {
  const files: string[] = [];
  for (const dir of LEARNER_UI_DIRS) {
    files.push(...walkSource(dir));
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

/** Detect if a label appears as a quoted string literal in source.
 *  Matches `"<label>"` or `'<label>'` — bare unquoted occurrences
 *  (e.g. in comments) do NOT count as leaks. */
function labelIsLeaked(label: string, source: string): boolean {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`["']${esc}["']`);
  return re.test(source);
}

// ────────────────────────────────────────────────────────────
// Classification
// ────────────────────────────────────────────────────────────

type Classification = "clean" | "exempt" | "leak";

interface LeakResult {
  setKey: string;
  label: string;
  key: LeakKey;
  classification: Classification;
}

function classifyLabel(setKey: string, label: string): LeakResult {
  const key = `${setKey}:${label}` as LeakKey;
  if (LEARNER_UI_LEAK_EXEMPT[key]) {
    return { setKey, label, key, classification: "exempt" };
  }
  if (labelIsLeaked(label, LEARNER_UI_SOURCE)) {
    return { setKey, label, key, classification: "leak" };
  }
  return { setKey, label, key, classification: "clean" };
}

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("Learner-UI leak coverage (Lattice Coverage)", () => {
  const allResults: LeakResult[] = [];
  for (const [setKey, set] of Object.entries(INTERNAL_LABEL_REGISTRY)) {
    for (const label of set.labels) {
      allResults.push(classifyLabel(setKey, label));
    }
  }

  it("registry has at least one internal-label set", () => {
    expect(
      Object.keys(INTERNAL_LABEL_REGISTRY).length,
      "INTERNAL_LABEL_REGISTRY is empty — at least one course must register an internal label set",
    ).toBeGreaterThan(0);
  });

  it("every registry entry has a substantive description (>30 chars)", () => {
    for (const [k, v] of Object.entries(INTERNAL_LABEL_REGISTRY)) {
      expect(
        v.description.trim().length,
        `${k}: description too short — write why these labels are internal-only`,
      ).toBeGreaterThan(30);
    }
  });

  it("every registry entry has at least one label", () => {
    for (const [k, v] of Object.entries(INTERNAL_LABEL_REGISTRY)) {
      expect(
        v.labels.length,
        `${k}: no labels declared`,
      ).toBeGreaterThan(0);
    }
  });

  it("no internal-only label leaks into learner-UI source beyond the ratchet", () => {
    const leaks = allResults.filter((r) => r.classification === "leak");
    expect(
      leaks.length,
      `Internal-only labels found as string literals in learner-UI source:\n  ${leaks
        .map((l) => l.key)
        .join("\n  ")}\n\nFix: move the label assignment to a server-side projection (e.g. a REWARD-stage spec) that maps internal → learner-safe BEFORE the data reaches the learner-UI dir. See ADR docs/decisions/2026-06-21-session-focus-rewardspec-substrate.md.`,
    ).toBeLessThanOrEqual(EXPECTED_LEAK_COUNT);
  });

  it("ratchet — leak count matches EXPECTED_LEAK_COUNT exactly", () => {
    const leaks = allResults.filter((r) => r.classification === "leak");
    expect(
      leaks.length,
      `Leak count drifted from ${EXPECTED_LEAK_COUNT}. ` +
        `Current leaks: ${leaks.map((l) => l.key).join(", ")}. ` +
        `If you cleared an incumbent, drop EXPECTED_LEAK_COUNT. ` +
        `If you introduced one, pause: fix the projection instead.`,
    ).toBe(EXPECTED_LEAK_COUNT);
  });

  it("ratchet — exempt count matches EXPECTED_EXEMPT_COUNT exactly", () => {
    const exemptIds = Object.keys(LEARNER_UI_LEAK_EXEMPT);
    expect(
      exemptIds.length,
      `Exempt-list size drifted from ${EXPECTED_EXEMPT_COUNT}. Current: ${exemptIds.join(", ")}`,
    ).toBe(EXPECTED_EXEMPT_COUNT);
  });

  it("every exempt entry has a substantive reason (>20 chars)", () => {
    for (const [k, entry] of Object.entries(LEARNER_UI_LEAK_EXEMPT)) {
      expect(
        entry.reason.trim().length,
        `${k}: reason too short`,
      ).toBeGreaterThan(20);
    }
  });

  it("no exempt entry references an unknown label (stale row)", () => {
    const stale: string[] = [];
    for (const k of Object.keys(LEARNER_UI_LEAK_EXEMPT)) {
      const [setKey, label] = k.split(":");
      const set = INTERNAL_LABEL_REGISTRY[setKey];
      if (!set || !set.labels.includes(label)) stale.push(k);
    }
    expect(stale, `Stale exempt entries: ${stale.join(", ")}`).toEqual([]);
  });

  // ──────────────────────────────────────────────────────────
  // LEARNER_SAFE_REGISTRY tests — #2145 Phase A SessionFocus
  // ──────────────────────────────────────────────────────────

  it("LEARNER_SAFE_REGISTRY has at least one entry with substantive metadata", () => {
    const entries = Object.entries(LEARNER_SAFE_REGISTRY);
    expect(entries.length).toBeGreaterThan(0);
    for (const [k, v] of entries) {
      expect(
        v.description.trim().length,
        `${k}: description too short — write why these labels are learner-safe + cite the BDD reference`,
      ).toBeGreaterThan(40);
      expect(
        v.labels.length,
        `${k}: no labels declared`,
      ).toBeGreaterThan(0);
      expect(
        v.unionName.length,
        `${k}: unionName empty — name the TypeScript union type in lib/types/json-fields.ts`,
      ).toBeGreaterThan(0);
      expect(
        v.projectingSpecSlug.length,
        `${k}: projectingSpecSlug empty — name the AnalysisSpec slug that writes these values`,
      ).toBeGreaterThan(0);
    }
  });

  it("LEARNER_SAFE_REGISTRY labels do not overlap with INTERNAL_LABEL_REGISTRY (no double-classification)", () => {
    const internalLabels = new Set<string>();
    for (const set of Object.values(INTERNAL_LABEL_REGISTRY)) {
      for (const label of set.labels) internalLabels.add(label);
    }
    const overlaps: string[] = [];
    for (const [setKey, set] of Object.entries(LEARNER_SAFE_REGISTRY)) {
      for (const label of set.labels) {
        if (internalLabels.has(label)) {
          overlaps.push(`${setKey}:${label}`);
        }
      }
    }
    expect(
      overlaps,
      `Labels appear in BOTH internal and learner-safe registries: ${overlaps.join(", ")}. A label must be classified one way or the other.`,
    ).toEqual([]);
  });

  it("classification distribution sanity (operator-facing log)", () => {
    const counts: Record<Classification, number> = {
      clean: 0,
      exempt: 0,
      leak: 0,
    };
    for (const r of allResults) counts[r.classification]++;
    const totalLabels = Object.values(INTERNAL_LABEL_REGISTRY).reduce(
      (s, set) => s + set.labels.length,
      0,
    );
    expect(counts.clean + counts.exempt + counts.leak).toBe(totalLabels);
  });
});
