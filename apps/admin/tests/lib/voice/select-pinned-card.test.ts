/**
 * #1733 / #1744 (epic #1700 Theme 3) — selectPinnedCardForModule helper.
 *
 * Pinned acceptance:
 *   1. null config → null
 *   2. null moduleSlug → null
 *   3. moduleSlug not in config.modules → null
 *   4. module without cueCardPool → null
 *   5. round-robin: sequenceNumber=1 → pool[0]; =2 → pool[1]; =3 → pool[0]
 *   6. malformed pool entries (no topic / no bullets) skipped (returns null)
 *   7. shape: returns {kind:"cueCard", topic, bullets} preserving bullets order
 */

import { describe, it, expect } from "vitest";

import { selectPinnedCardForModule } from "@/lib/voice/select-pinned-card";
import type { PlaybookConfig } from "@/lib/types/json-fields";

function withPool(pool: unknown): PlaybookConfig {
  return {
    modules: [
      {
        id: "part2",
        settings: { cueCardPool: pool },
      },
    ],
  } as unknown as PlaybookConfig;
}

describe("selectPinnedCardForModule", () => {
  it("(1) null config → null", () => {
    expect(
      selectPinnedCardForModule({ config: null, moduleSlug: "part2", sequenceNumber: 1 }),
    ).toBeNull();
  });

  it("(2) null moduleSlug → null", () => {
    expect(
      selectPinnedCardForModule({
        config: withPool([{ topic: "x", bullets: ["a"] }]),
        moduleSlug: null,
        sequenceNumber: 1,
      }),
    ).toBeNull();
  });

  it("(3) moduleSlug not in modules → null", () => {
    expect(
      selectPinnedCardForModule({
        config: withPool([{ topic: "x", bullets: ["a"] }]),
        moduleSlug: "part3",
        sequenceNumber: 1,
      }),
    ).toBeNull();
  });

  it("(4) module without cueCardPool → null", () => {
    expect(
      selectPinnedCardForModule({
        config: { modules: [{ id: "part2", settings: {} }] } as unknown as PlaybookConfig,
        moduleSlug: "part2",
        sequenceNumber: 1,
      }),
    ).toBeNull();
  });

  it("(5) round-robin over the pool", () => {
    const pool = [
      { topic: "Card A", bullets: ["a1", "a2"] },
      { topic: "Card B", bullets: ["b1"] },
    ];
    const config = withPool(pool);
    expect(
      selectPinnedCardForModule({ config, moduleSlug: "part2", sequenceNumber: 1 }),
    ).toEqual({ kind: "cueCard", topic: "Card A", bullets: ["a1", "a2"] });
    expect(
      selectPinnedCardForModule({ config, moduleSlug: "part2", sequenceNumber: 2 }),
    ).toEqual({ kind: "cueCard", topic: "Card B", bullets: ["b1"] });
    expect(
      selectPinnedCardForModule({ config, moduleSlug: "part2", sequenceNumber: 3 }),
    ).toEqual({ kind: "cueCard", topic: "Card A", bullets: ["a1", "a2"] });
  });

  it("(6) malformed picked entry → null", () => {
    const cases: unknown[][] = [
      [{ topic: "", bullets: ["x"] }],
      [{ topic: "no-bullets" }],
      [{ topic: "blank-bullets", bullets: ["", "  "] }],
    ];
    for (const pool of cases) {
      expect(
        selectPinnedCardForModule({
          config: withPool(pool),
          moduleSlug: "part2",
          sequenceNumber: 1,
        }),
      ).toBeNull();
    }
  });

  it("(7) preserves bullets order; drops blanks", () => {
    const config = withPool([
      { topic: "Trip", bullets: ["where you went", "  ", "what you did", "who with"] },
    ]);
    const card = selectPinnedCardForModule({
      config,
      moduleSlug: "part2",
      sequenceNumber: 1,
    });
    expect(card).toEqual({
      kind: "cueCard",
      topic: "Trip",
      bullets: ["where you went", "what you did", "who with"],
    });
  });
});
