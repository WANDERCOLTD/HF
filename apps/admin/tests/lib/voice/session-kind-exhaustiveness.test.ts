/**
 * Session.kind exhaustiveness — Lattice Coverage-pillar member (2026-06-17).
 *
 * **What this test pins:**
 *  Every member of `SessionKindString` (= the Prisma `SessionKind` enum)
 *  has an explicit decision in `deriveSkipStages` AND
 *  `initialCounterFlags` AT `lib/voice/session-rules.ts`. Both helpers
 *  use `switch + never` exhaustiveness, so a new SessionKind cannot
 *  silently default to "no skips" — TS fails at edit time. This test
 *  is the behavioural pin paired with that compile-time gate.
 *
 *  Pre-fix: `deriveSkipStages` used `if (kind === "ENROLLMENT" ||
 *  kind === "ASSESSMENT")` — any other kind silently produced zero
 *  skips at kind level. Adding a new SessionKind to the Prisma enum
 *  would silently default to "full pipeline" with no compile-time
 *  signal.
 *
 *  See `.claude/rules/session-kind-exhaustiveness.md` for the durable
 *  rule.
 */

import { describe, it, expect } from "vitest";
import {
  deriveSkipStages,
  initialCounterFlags,
  type SessionKindString,
} from "@/lib/voice/session-rules";

/**
 * Canonical enumeration of every SessionKind. If the Prisma enum
 * grows, add the new member here AND update deriveSkipStages /
 * initialCounterFlags. The compile-time `never` check forces the
 * latter; this list forces the former.
 */
const ALL_KINDS: readonly SessionKindString[] = [
  "ENROLLMENT",
  "ASSESSMENT",
  "VOICE_CALL",
  "SIM_CALL",
  "TEXT_CHAT",
] as const;

/**
 * Pinned kind→skipStages mapping. Update deliberately if rules change.
 * Stage skips at the OUTCOME level (FAILED / GHOST) are tested
 * separately at the bottom — these are the kind-level base values.
 */
const EXPECTED_KIND_LEVEL_SKIPS: Record<SessionKindString, readonly string[]> = {
  ENROLLMENT: ["EXTRACT", "PROSODY", "SCORE_AGENT"],
  ASSESSMENT: ["EXTRACT", "PROSODY", "SCORE_AGENT"],
  VOICE_CALL: [],
  SIM_CALL: [],
  TEXT_CHAT: [],
};

describe("Session.kind exhaustiveness (Lattice Coverage pillar)", () => {
  it("covers every SessionKindString member without sentinel gap", () => {
    // If a new kind is added to the union but missing from ALL_KINDS,
    // TypeScript flags the readonly tuple shape; this assertion is the
    // runtime backstop.
    expect(ALL_KINDS).toHaveLength(5);
    const set = new Set(ALL_KINDS);
    expect(set.size).toBe(ALL_KINDS.length);
  });

  it("deriveSkipStages returns the pinned mapping for every kind", () => {
    for (const kind of ALL_KINDS) {
      const result = deriveSkipStages({ kind });
      expect(
        result,
        `deriveSkipStages drift for kind=${kind}`,
      ).toEqual(EXPECTED_KIND_LEVEL_SKIPS[kind]);
    }
  });

  it("initialCounterFlags returns valid flags for every kind (no exhaustive throw)", () => {
    for (const kind of ALL_KINDS) {
      const flags = initialCounterFlags(kind);
      expect(
        typeof flags.countsTowardLearnerNumber,
        `initialCounterFlags missing countsTowardLearnerNumber for kind=${kind}`,
      ).toBe("boolean");
      expect(
        typeof flags.countsTowardPipelineNumber,
        `initialCounterFlags missing countsTowardPipelineNumber for kind=${kind}`,
      ).toBe("boolean");
    }
  });

  it("outcome=FAILED / GHOST adds the pinned set of additional skips (overrides VOICE_CALL/SIM_CALL/TEXT_CHAT base)", () => {
    const expectedFailedExtras = ["EXTRACT", "PROSODY", "REWARD", "SCORE_AGENT"];
    for (const kind of ALL_KINDS) {
      for (const outcome of ["FAILED", "GHOST"] as const) {
        const result = deriveSkipStages({ kind, outcome });
        // The override union always contains the 4 stages.
        for (const stage of expectedFailedExtras) {
          expect(
            result,
            `Expected ${kind}/${outcome} to skip ${stage}`,
          ).toContain(stage);
        }
      }
    }
  });

  it("outcome=COMPLETED leaves only the kind-level skips (no extras)", () => {
    for (const kind of ALL_KINDS) {
      const result = deriveSkipStages({ kind, outcome: "COMPLETED" });
      expect(
        result,
        `COMPLETED outcome shouldn't add stages beyond the kind base for ${kind}`,
      ).toEqual(EXPECTED_KIND_LEVEL_SKIPS[kind]);
    }
  });
});
