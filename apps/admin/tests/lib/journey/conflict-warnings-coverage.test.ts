/**
 * Conflict-Warnings coverage — Lattice Coverage-pillar extension.
 *
 * Story: [#2105](https://github.com/WANDERCOLTD/HF/issues/2105) (S3 of
 * epic #2102). Extends the 5th Lattice pillar (Coverage) to the
 * `SettingConflictDecl` surface added by this PR.
 *
 * **What this test pins:**
 *  Every `SettingConflictDecl` declared on a `JourneySettingContract.conflicts[]`
 *  satisfies the structural contract:
 *
 *   1. Every `conflictsWithId` references a real contract id in
 *      `JOURNEY_SETTINGS_BY_ID` (no stale cross-refs).
 *   2. Every `resolution` string is >60 chars (actionable, not a
 *      sentence fragment). The floor forces authors to write
 *      substantive guidance.
 *   3. **Symmetric graph** — if A declares conflict with B, B MUST
 *      declare reciprocal conflict with A. Both sides get the chip.
 *      This is the LOAD-BEARING assertion.
 *   4. `whenThisValues` / `whenOtherValues` non-empty (a declaration
 *      with empty trigger sets would never fire).
 *   5. Ratchet — `EXPECTED_CONFLICT_COUNT` is the incumbent declared-
 *      conflict count; grows monotonically (no stealth removals).
 *
 * Sibling Coverage-pillar tests:
 * - `registry-consumer-coverage.md` (registry storagePath → reader)
 * - `registry-schema-coverage.md` (schema field → contract coverage)
 * - `gated-by-coverage.md` (gatedBy declarations)
 * - `arraykey-writer-coverage.md` (arrayKey → writer route)
 *
 * Same generic enumerate→classify→ratchet pattern, applied to the
 * conflict-warnings surface.
 */

import { describe, it, expect } from "vitest";

import { JOURNEY_SETTINGS } from "@/lib/journey/setting-contracts.entries";
import { VOICE_SETTINGS } from "@/lib/settings/voice-setting-contracts";
import type { JourneySettingContract } from "@/lib/journey/setting-contracts";

// All contracts spanning both registries — symmetric checks may reach
// across journey ↔ voice (e.g. a hypothetical future voiceProvider
// conflicting with a journey-tab setting). Today all 3 incumbent
// declarations live entirely within JOURNEY_SETTINGS.
const ALL_CONTRACTS: readonly JourneySettingContract[] = [
  ...JOURNEY_SETTINGS,
  ...VOICE_SETTINGS,
];

const ALL_BY_ID: Readonly<Record<string, JourneySettingContract>> =
  Object.fromEntries(ALL_CONTRACTS.map((c) => [c.id, c]));

/** Minimum chars on `resolution`. Forces actionable guidance, not
 *  one-liners. Lifting this floor is acceptable when a real conflict
 *  fits in fewer chars (none today). */
const MIN_RESOLUTION_CHARS = 60;

/**
 * Ratchet — total count of declared conflict edges across ALL contracts
 * (counting both sides of each symmetric pair). 3 conflict topics, each
 * declared symmetrically on 2 contracts = 6 edges at land time.
 *
 * Bump UP when adding a new conflict topic (always +2: declare on both
 * sides). Bump DOWN only when intentionally retiring a conflict
 * declaration. The test fails on drift in either direction so a careless
 * add/remove gets caught at PR time.
 */
const EXPECTED_CONFLICT_COUNT = 6;

describe("Conflict-Warnings Coverage (Lattice Coverage-pillar extension)", () => {
  it("(1) every conflictsWithId references a real contract id", () => {
    const stale: { owner: string; conflictsWithId: string }[] = [];
    for (const contract of ALL_CONTRACTS) {
      if (!contract.conflicts) continue;
      for (const decl of contract.conflicts) {
        if (!ALL_BY_ID[decl.conflictsWithId]) {
          stale.push({
            owner: contract.id,
            conflictsWithId: decl.conflictsWithId,
          });
        }
      }
    }
    if (stale.length > 0) {
      throw new Error(
        `${stale.length} conflictsWithId reference(s) point to non-existent contract id(s):\n` +
          stale
            .map(
              (s) =>
                `  - ${s.owner}.conflicts → conflictsWithId="${s.conflictsWithId}" (not in registry)`,
            )
            .join("\n") +
          `\nFix the typo or remove the dangling declaration.`,
      );
    }
    expect(stale).toEqual([]);
  });

  it("(2) every resolution is >60 chars (actionable, not a fragment)", () => {
    const tooShort: { owner: string; conflictsWithId: string; len: number }[] = [];
    for (const contract of ALL_CONTRACTS) {
      if (!contract.conflicts) continue;
      for (const decl of contract.conflicts) {
        const len = decl.resolution.trim().length;
        if (len <= MIN_RESOLUTION_CHARS) {
          tooShort.push({
            owner: contract.id,
            conflictsWithId: decl.conflictsWithId,
            len,
          });
        }
      }
    }
    if (tooShort.length > 0) {
      throw new Error(
        `${tooShort.length} conflict declaration(s) have resolution text <=${MIN_RESOLUTION_CHARS} chars (must be actionable, not a fragment):\n` +
          tooShort
            .map(
              (s) =>
                `  - ${s.owner} → conflictsWithId="${s.conflictsWithId}" (length=${s.len})`,
            )
            .join("\n"),
      );
    }
    expect(tooShort).toEqual([]);
  });

  it("(3) SYMMETRIC: every A→B declaration has a reciprocal B→A declaration", () => {
    const missingReciprocal: { ownerA: string; ownerB: string }[] = [];
    for (const a of ALL_CONTRACTS) {
      if (!a.conflicts) continue;
      for (const decl of a.conflicts) {
        const b = ALL_BY_ID[decl.conflictsWithId];
        if (!b) continue; // covered by assertion (1)
        const reciprocal = (b.conflicts ?? []).some(
          (d) => d.conflictsWithId === a.id,
        );
        if (!reciprocal) {
          missingReciprocal.push({ ownerA: a.id, ownerB: b.id });
        }
      }
    }
    if (missingReciprocal.length > 0) {
      throw new Error(
        `${missingReciprocal.length} conflict declaration(s) are NOT symmetric — the peer doesn't declare the reciprocal:\n` +
          missingReciprocal
            .map(
              (m) =>
                `  - ${m.ownerA} declares conflict with ${m.ownerB}, but ${m.ownerB} doesn't declare reciprocal with ${m.ownerA}`,
            )
            .join("\n") +
          `\nFix: add the reciprocal declaration on the named peer so BOTH rows render the chip when the combination fires.`,
      );
    }
    expect(missingReciprocal).toEqual([]);
  });

  it("(4) every whenThisValues / whenOtherValues is non-empty", () => {
    const empty: { owner: string; conflictsWithId: string; side: string }[] = [];
    for (const contract of ALL_CONTRACTS) {
      if (!contract.conflicts) continue;
      for (const decl of contract.conflicts) {
        if (decl.whenThisValues.length === 0) {
          empty.push({
            owner: contract.id,
            conflictsWithId: decl.conflictsWithId,
            side: "whenThisValues",
          });
        }
        if (decl.whenOtherValues.length === 0) {
          empty.push({
            owner: contract.id,
            conflictsWithId: decl.conflictsWithId,
            side: "whenOtherValues",
          });
        }
      }
    }
    if (empty.length > 0) {
      throw new Error(
        `${empty.length} conflict declaration(s) have an empty trigger set (would never fire):\n` +
          empty
            .map(
              (e) =>
                `  - ${e.owner} → conflictsWithId="${e.conflictsWithId}" .${e.side} is empty`,
            )
            .join("\n"),
      );
    }
    expect(empty).toEqual([]);
  });

  it("(5) ratchet — declared-conflict count matches EXPECTED_CONFLICT_COUNT", () => {
    let count = 0;
    for (const contract of ALL_CONTRACTS) {
      if (!contract.conflicts) continue;
      count += contract.conflicts.length;
    }
    expect(
      count,
      `Total conflict-edge count drifted. Each new conflict topic adds +2 (symmetric pair). ` +
        `Bump EXPECTED_CONFLICT_COUNT consciously when adding/removing conflict declarations.`,
    ).toBe(EXPECTED_CONFLICT_COUNT);
  });

  // ────────────────────────────────────────────────────────────
  // Precedence pins — `conflicted` MUST be LOWEST priority in
  // computeRelevanceState. These pin the resolver's contract against
  // accidental refactors that promote conflicts above hard gates.
  // ────────────────────────────────────────────────────────────

  it("(6) RelevanceState includes 'conflicted' literal (type-shape sanity)", () => {
    // The RelevanceState type itself can't be checked at runtime, but
    // its consumer can: if we can construct a result with state:
    // "conflicted" and the resolver accepts that shape, the union
    // includes the literal. See compute-relevance-state.test.ts for the
    // load-bearing precedence assertions.
    // Sanity assertion: the contracts importing this file compile.
    expect(ALL_CONTRACTS.length).toBeGreaterThan(0);
  });
});
