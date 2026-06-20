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

// ───────────────────────────────────────────────────────────────────
// #1955 (Boaz/Eldar pre-voice Unit 4.1 / 4.2) — topicFocus sibling.
// ───────────────────────────────────────────────────────────────────

import { selectTopicFocusCard } from "@/lib/voice/select-pinned-card";

const LR = "skill_lexical_resource_lr";
const FC = "skill_fluency_and_coherence_fc";

function part3Config(opts: { pinFocusArea?: boolean } = {}): PlaybookConfig {
  return {
    modules: [
      {
        id: "part3",
        settings: { pinFocusArea: opts.pinFocusArea },
      },
    ],
  } as unknown as PlaybookConfig;
}

describe("selectTopicFocusCard", () => {
  it("returns kind:'topicFocus' with the lowest-scored criterion label", () => {
    const card = selectTopicFocusCard({
      config: part3Config(),
      moduleSlug: "part3",
      callerTargets: [
        { parameterId: FC, currentScore: 0.7 },
        { parameterId: LR, currentScore: 0.4 },
      ],
    });
    expect(card).toEqual({
      kind: "topicFocus",
      topic: "Today's focus",
      focusArea: "Lexical Resource",
    });
  });

  it("returns null on a non-Part-3 module slug (drift guard)", () => {
    const card = selectTopicFocusCard({
      config: part3Config(),
      moduleSlug: "part2",
      callerTargets: [{ parameterId: LR, currentScore: 0.4 }],
    });
    expect(card).toBeNull();
  });

  it("returns null when pinFocusArea is explicitly false", () => {
    const card = selectTopicFocusCard({
      config: part3Config({ pinFocusArea: false }),
      moduleSlug: "part3",
      callerTargets: [{ parameterId: LR, currentScore: 0.4 }],
    });
    expect(card).toBeNull();
  });

  it("returns null when no scoring history exists", () => {
    const card = selectTopicFocusCard({
      config: part3Config(),
      moduleSlug: "part3",
      callerTargets: [],
    });
    expect(card).toBeNull();
  });

  it("returns null on null config / null moduleSlug", () => {
    expect(
      selectTopicFocusCard({ config: null, moduleSlug: "part3", callerTargets: [] }),
    ).toBeNull();
    expect(
      selectTopicFocusCard({
        config: part3Config(),
        moduleSlug: null,
        callerTargets: [],
      }),
    ).toBeNull();
  });
});

describe("pinned-card drift guard — kind discriminator", () => {
  it("cue card pool on a Part 2 slug still yields kind:'cueCard' (and topicFocus is gated out)", () => {
    // Same playbook config could theoretically declare BOTH on the same
    // module (config error). Verify the discriminator: which selector
    // fires depends on the slug. Part 2 slug → cueCard branch only.
    const config: PlaybookConfig = {
      modules: [
        {
          id: "part2",
          settings: {
            cueCardPool: [{ topic: "Trip", bullets: ["where", "who"] }],
            pinFocusArea: true, // hypothetical drift — should NOT trigger topicFocus
          },
        },
      ],
    } as unknown as PlaybookConfig;
    const cue = selectPinnedCardForModule({
      config,
      moduleSlug: "part2",
      sequenceNumber: 1,
    });
    expect(cue?.kind).toBe("cueCard");
    // topicFocus must refuse a Part 2 module by its own slug-shape gate
    const focus = selectTopicFocusCard({
      config,
      moduleSlug: "part2",
      callerTargets: [{ parameterId: LR, currentScore: 0.4 }],
    });
    expect(focus).toBeNull();
  });

  it("Part 3 slug yields topicFocus when scores exist, cueCard branch refuses on missing pool", () => {
    const config: PlaybookConfig = {
      modules: [
        {
          id: "part3",
          settings: {
            // No cueCardPool — selectPinnedCardForModule must return null.
            pinFocusArea: true,
          },
        },
      ],
    } as unknown as PlaybookConfig;
    const cue = selectPinnedCardForModule({
      config,
      moduleSlug: "part3",
      sequenceNumber: 1,
    });
    expect(cue).toBeNull();
    const focus = selectTopicFocusCard({
      config,
      moduleSlug: "part3",
      callerTargets: [{ parameterId: LR, currentScore: 0.4 }],
    });
    expect(focus?.kind).toBe("topicFocus");
  });
});
