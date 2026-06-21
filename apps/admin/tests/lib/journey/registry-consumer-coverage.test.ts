/**
 * Registry ↔ consumer coverage — 5th-Lattice-pillar Coverage test.
 *
 * **What this test pins:**
 *  Every `JourneySettingContract` (and `VOICE_SETTINGS`) entry with a
 *  non-empty `composeImpact.sections[]` MUST have a consumer that
 *  reads its `storagePath`. A setting that lands in the registry
 *  without a reader is a "producer-only" Lattice violation — the
 *  educator sees the control in the Inspector and edits it, but the
 *  composed prompt is identical before and after the change because
 *  no transform reads the value.
 *
 *  Catches the gap class surfaced by the 2026-06-17 audit (7 of 53
 *  educator-facing settings were producer-only — Lane 3 catch-up
 *  PRs #1780-series added the registry entries but the consumer
 *  reads were deferred or forgotten).
 *
 * **How matching works (corrected 2026-06-21 per A0 of #2225):**
 *  Settings whose `(cascadeKnobKey ?? id)` matches a registered cascade
 *  family in `lib/cascade/effective-value.ts::FAMILIES` shortcut to
 *  COVERED via `family-shortcut` — their reads go through the canonical
 *  resolver, which IS the consumer. The check uses the exported
 *  `isResolvableKnob(knobKey)` helper so the test agrees with the
 *  Inspector's runtime call `useEffectiveValue(cascadeKnobKey ?? id)`.
 *
 *  HISTORICAL BUG (pre-A0): the test previously shortcut on
 *  `storagePath.root` matching `sessionFlow.*` / `playbook.voiceConfig.*` /
 *  `behaviorTargets*` / `domain.*`. The cascade `FAMILIES` table only
 *  matches FINE-GRAINED knob keys (`welcomeMessage`, `intake`,
 *  `onboarding`, `stops`, `offboarding`, voice keys, BEH-*, mastery
 *  knobs) — NOT the coarse storagePath roots. So leaf contracts like
 *  `intakeGoalsQuestion` (knobKey `intakeGoalsQuestion`, NOT `intake`)
 *  silently fell into `family-shortcut` even though `isResolvableKnob`
 *  returns false for them. They appeared COVERED but the Inspector's
 *  cascade chip rendered nothing. Fix replaces the storagePath-root
 *  heuristic with the real `isResolvableKnob` check; non-cascade
 *  contracts fall through to substring search as before.
 *
 *  For settings that aren't cascade-resolvable, the test concatenates
 *  source from the consumer surfaces (transforms / compose / cascade
 *  resolvers / pipeline schedulers) and checks that the most
 *  distinctive segment of the storagePath appears as a substring.
 *  Generic trailing segments (`enabled`, `value`, `type`, `mode`)
 *  are stripped — the next-up segment is searched instead.
 *
 *  Exemptions live in `REGISTRY_CONSUMER_EXEMPT_PATHS` with required
 *  one-line reason. The ratchet pins the current exempt count: it
 *  cannot grow without an explicit bump (force the author to
 *  acknowledge they're adding to the gap pile).
 *
 * **How to fix a failure:**
 *  - "Setting X has no consumer": the author shipped a registry
 *    entry without a reading transform/resolver. Either land the
 *    consumer in the same PR OR add to `REGISTRY_CONSUMER_EXEMPT_PATHS`
 *    with a reason.
 *  - "Stale exempt entry": the setting got wired up; remove from the
 *    exempt list.
 *  - "Ratchet drifted up": you added an exempt entry without bumping
 *    `EXPECTED_EXEMPT_COUNT`. Decide consciously: did you mean to
 *    grow the gap? If yes, bump. If no, wire the consumer.
 *
 *  See `.claude/rules/registry-consumer-coverage.md` for the durable
 *  rule + `lattice-survey.md` "Producer ↔ consumer pairing" section.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { JOURNEY_SETTINGS } from "@/lib/journey/setting-contracts.entries";
import { VOICE_SETTINGS } from "@/lib/settings/voice-setting-contracts";
import { isResolvableKnob } from "@/lib/cascade/effective-value";
import type {
  JourneySettingContract,
  StoragePath,
} from "@/lib/journey/setting-contracts";

// ────────────────────────────────────────────────────────────
// Exempt list — settings whose reader is genuinely missing OR
// landed as producer-only by explicit design decision.
// Required: one-line reason. Periodic audit removes stale entries.
// ────────────────────────────────────────────────────────────

interface ExemptEntry {
  /** One-line justification. Required. */
  reason: string;
}

const REGISTRY_CONSUMER_EXEMPT_PATHS: Record<string, ExemptEntry> = {
  // 2026-06-17 audit gaps — registry entries shipped without consumers
  // during Lane 3 catch-up (#1780-series). Lane B follow-on issue tracks
  // the wiring work; each transform read needs per-setting design
  // (e.g., baselineAssessmentDepth needs "light/standard/deep" prompt
  // synthesis, not just a substring read).
  // 2026-06-17 follow-on — surfaced by the structural test itself
  // (settings the agent's manual audit missed). All confirmed
  // producer-only via wide `grep -rln <id> lib/` returning 0 hits
  // outside `setting-contracts.entries.ts`.
};

/** Ratchet — the exempt count is allowed to GO DOWN (wire a consumer,
 *  remove the entry), never UP without a bump here. The test fails on
 *  drift in either direction so a careless add gets caught at PR time. */
const EXPECTED_EXEMPT_COUNT = 0;

// ────────────────────────────────────────────────────────────
// Consumer-surface concatenation
// ────────────────────────────────────────────────────────────

const REPO_ADMIN = resolve(__dirname, "..", "..", "..");

/** Directories whose source files are the canonical "consumers". A
 *  setting's storagePath substring appearing in ANY of these counts
 *  as covered. */
const CONSUMER_DIRS = [
  "lib/prompt/composition/transforms",
  "lib/prompt/composition/loaders",
  "lib/prompt/composition",
  "lib/compose",
  "lib/session-flow",
  "lib/cascade/resolvers",
  "lib/pipeline",
  "lib/contracts",
  // Settings whose effect is enforced outside compose itself still
  // count — the educator's edit changes runtime behaviour either via
  // prompt content (above) OR via runtime gates (below).
  "lib/channels",
  "lib/curriculum",
  "lib/voice",
  "lib/goals",
  "lib/tolerance",
  "lib/intake",
  "lib/banding",
];

function walkTs(dir: string): string[] {
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
      out.push(...walkTs(full));
    } else if (e.endsWith(".ts") || e.endsWith(".tsx")) {
      // Skip test files — they don't count as consumers.
      if (full.includes("/__tests__/") || full.endsWith(".test.ts") || full.endsWith(".test.tsx")) {
        continue;
      }
      out.push(full);
    }
  }
  return out;
}

const CONSUMER_SOURCE: string = (() => {
  const files: string[] = [];
  for (const dir of CONSUMER_DIRS) {
    files.push(...walkTs(join(REPO_ADMIN, dir)));
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
// Path → search-term extraction
// ────────────────────────────────────────────────────────────

/** Generic field names that don't uniquely identify a setting — skip
 *  these when picking the search term and use the next-up segment. */
const GENERIC_SEGMENTS = new Set([
  "enabled",
  "value",
  "values",
  "type",
  "id",
  "ids",
  "kind",
  "mode",
  "count",
  "threshold",
  "min",
  "max",
  "default",
]);

function getPathString(sp: StoragePath): string {
  return typeof sp === "string" ? sp : sp.path;
}

// Note: `getStorageRoot` was removed 2026-06-21 (A0 of #2225). The
// previous storagePath-root heuristic produced false-negative COVERED
// classifications for contracts that LOOKED like they sat under a
// cascade family but whose leaf knobKey isn't actually resolvable.
// The replacement (`isResolvableKnob(cascadeKnobKey ?? id)`) lives
// inline in `classify()`. See header docstring.

/** Pick search terms to try. Strips `[]` placeholders + generic
 *  trailing names + handles `*Enabled` camelCase boolean suffixes by
 *  also trying the bare concept (`recapSynthesisEnabled` → also try
 *  `recapSynthesis`). Returns the ordered candidate set — the test
 *  treats any match as covered. */
function pickSearchTerms(path: string): string[] {
  const segments = path
    .split(".")
    .map((s) => s.replace(/\[\]$/, "").replace(/\[.*\]$/, ""))
    .filter((s) => s.length > 0);
  const out: string[] = [];
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (GENERIC_SEGMENTS.has(seg)) continue;
    out.push(seg);
    // `*Enabled` boolean-flag suffix: also try the bare concept.
    const m = seg.match(/^(.+)Enabled$/);
    if (m && m[1].length > 0) out.push(m[1]);
    // First non-generic segment is distinctive enough — don't keep
    // walking up to broader parents (would produce false positives
    // on common parent names like `config`).
    break;
  }
  if (out.length === 0 && segments.length > 0) {
    out.push(segments[segments.length - 1]);
  }
  return out;
}

// ────────────────────────────────────────────────────────────
// Classification
// ────────────────────────────────────────────────────────────

type Classification =
  | "covered"
  | "family-shortcut"
  | "no-compose-impact"
  | "exempt"
  | "gap";

interface ClassResult {
  id: string;
  classification: Classification;
  searchTerm?: string;
  reason?: string;
}

function classify(c: JourneySettingContract): ClassResult {
  // Operator-only settings with no compose impact: no consumer needed.
  if (c.composeImpact.sections.length === 0) {
    return { id: c.id, classification: "no-compose-impact" };
  }

  // Module-scoped (G8 IELTS cohort + future per-module settings): the
  // existing `lattice-survey.md` rule intentionally permits producer-
  // only here while Phase 2 wiring lands. Marked family-shortcut so
  // they don't pollute the gap list; the operator-level tracking is
  // the `HF_FLAG_IELTS_MODULE_SETTINGS` flag.
  if (c.scope === "module") {
    return { id: c.id, classification: "family-shortcut" };
  }

  // Family shortcut — the contract's knobKey actually matches a
  // registered cascade family in `lib/cascade/effective-value.ts`.
  // The Inspector calls `useEffectiveValue(cascadeKnobKey ?? id, scope)`
  // at runtime; this check uses the SAME helper (`isResolvableKnob`)
  // so the test's COVERED verdict aligns with the runtime cascade
  // chip rendering. A contract that fails this check but whose
  // storagePath looks like it sits "under" a cascade family (e.g.
  // `sessionFlow.intake.goals.question`) is NOT covered by the
  // cascade — it falls through to substring search below.
  //
  // Structural correction 2026-06-21 (A0 of #2225) — see header
  // docstring for the historical false-negative this replaces.
  const knobKey = c.cascadeKnobKey ?? c.id;
  if (isResolvableKnob(knobKey)) {
    return { id: c.id, classification: "family-shortcut" };
  }

  const path = getPathString(c.storagePath);

  // Exempt — known producer-only with documented reason.
  if (REGISTRY_CONSUMER_EXEMPT_PATHS[c.id]) {
    return {
      id: c.id,
      classification: "exempt",
      reason: REGISTRY_CONSUMER_EXEMPT_PATHS[c.id].reason,
    };
  }

  // Substring search for `config.*` and `tolerances.*` paths. Try each
  // candidate term; any match counts.
  const terms = pickSearchTerms(path);
  for (const term of terms) {
    if (term.length === 0) continue;
    const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (re.test(CONSUMER_SOURCE)) {
      return { id: c.id, classification: "covered", searchTerm: term };
    }
  }
  return { id: c.id, classification: "gap", searchTerm: terms.join(" / ") };
}

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("Registry consumer coverage (Lattice 5th-pillar)", () => {
  const all = [...JOURNEY_SETTINGS, ...VOICE_SETTINGS];
  const results = all.map(classify);

  it("no producer-only setting has slipped past the exempt list", () => {
    const gaps = results.filter((r) => r.classification === "gap");
    expect(
      gaps,
      `Producer-only settings (no transform / resolver / loader reads their storagePath):\n  ${gaps
        .map((g) => `${g.id} (term: ${g.searchTerm})`)
        .join("\n  ")}\n\nFix: either land the consumer in the same PR, OR add to REGISTRY_CONSUMER_EXEMPT_PATHS with a one-line reason.`,
    ).toEqual([]);
  });

  it("exempt list ratchet — count matches EXPECTED_EXEMPT_COUNT", () => {
    const exemptIds = Object.keys(REGISTRY_CONSUMER_EXEMPT_PATHS);
    expect(
      exemptIds.length,
      `Exempt-list size drifted from ${EXPECTED_EXEMPT_COUNT}. ` +
        `If you wired a consumer + removed an entry, bump ` +
        `EXPECTED_EXEMPT_COUNT down. If you added an entry, ` +
        `pause: was that intentional? Wire the consumer first. ` +
        `Current entries: ${exemptIds.join(", ")}`,
    ).toBe(EXPECTED_EXEMPT_COUNT);
  });

  it("every exempt entry has a non-empty reason", () => {
    for (const [id, entry] of Object.entries(REGISTRY_CONSUMER_EXEMPT_PATHS)) {
      expect(entry.reason.trim().length, `${id}: empty reason`).toBeGreaterThan(
        10,
      );
    }
  });

  it("no exempt entry is stale (each id still appears in JOURNEY_SETTINGS / VOICE_SETTINGS)", () => {
    const knownIds = new Set(all.map((c) => c.id));
    const stale = Object.keys(REGISTRY_CONSUMER_EXEMPT_PATHS).filter(
      (id) => !knownIds.has(id),
    );
    expect(
      stale,
      `Exempt entries with no matching registry contract — registry deleted the setting; remove the exempt row: ${stale.join(", ")}`,
    ).toEqual([]);
  });

  it("no exempt entry is contradicted by an actual consumer read", () => {
    // If a setting is in the exempt list but its searchTerm IS present
    // in consumer source, the exempt entry is stale — the wiring shipped
    // and the entry should be removed.
    const contradicted: string[] = [];
    for (const id of Object.keys(REGISTRY_CONSUMER_EXEMPT_PATHS)) {
      const c = all.find((x) => x.id === id);
      if (!c) continue;
      const path = getPathString(c.storagePath);
      const terms = pickSearchTerms(path);
      for (const term of terms) {
        if (term.length === 0) continue;
        const re = new RegExp(
          `\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        );
        if (re.test(CONSUMER_SOURCE)) {
          contradicted.push(
            `${id} (term '${term}' now found in consumer source)`,
          );
          break;
        }
      }
    }
    expect(
      contradicted,
      `Exempt entries that now have consumer reads — remove from REGISTRY_CONSUMER_EXEMPT_PATHS:\n  ${contradicted.join("\n  ")}`,
    ).toEqual([]);
  });

  it("classification distribution sanity check (operator-facing log)", () => {
    const counts: Record<Classification, number> = {
      covered: 0,
      "family-shortcut": 0,
      "no-compose-impact": 0,
      exempt: 0,
      gap: 0,
    };
    for (const r of results) counts[r.classification]++;
    // The sum must equal the input size — sanity for the classifier.
    const sum = Object.values(counts).reduce((s, n) => s + n, 0);
    expect(sum).toBe(all.length);
  });
});
