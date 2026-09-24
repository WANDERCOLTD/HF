/**
 * Behavioural tests for `lib/prompt/composition/transforms/instructions.ts`.
 *
 * Today this file pins ONE invariant — UX-A (Finding 1 of the 2026-06-22
 * Learner UX audit): the cue-card directive must declare the card is
 * visible on the learner's screen so the AI treats it as a SHARED
 * reference, not narrates it back verbatim. Sibling assertion to the
 * UX-A pin in `session-focus.test.ts`.
 *
 * Scope is deliberately narrow — the cue-card resolver has many other
 * branches (flag-off / no locked module / empty pool / missing topic) but
 * those are covered structurally by:
 *   - `tests/lib/prompt/composition/coverage-producer-consumer.test.ts`
 *     (producer ↔ renderer pairing)
 *   - `tests/lib/sim-chat/bdd-typed-unions-coverage.test.ts`
 *     (cue-card shape vs BDD union)
 *   - the ESLint sentinel `composition-directive-needs-renderer`.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { resolveModuleCueCard } from "@/lib/prompt/composition/transforms/instructions";
import type { AssembledContext } from "@/lib/prompt/composition/types";
import type { AuthoredModule, PlaybookConfig } from "@/lib/types/json-fields";

const ORIGINAL_FLAG = process.env.HF_FLAG_IELTS_MODULE_SETTINGS;

beforeAll(() => {
  process.env.HF_FLAG_IELTS_MODULE_SETTINGS = "true";
});

afterEach(() => {
  // Keep flag ON between tests; clear at the very end. Vitest runs
  // describe/it sequentially in this file so no interleaving.
});

afterAll(() => {
  if (ORIGINAL_FLAG === undefined) {
    delete process.env.HF_FLAG_IELTS_MODULE_SETTINGS;
  } else {
    process.env.HF_FLAG_IELTS_MODULE_SETTINGS = ORIGINAL_FLAG;
  }
});

function buildConfig(card: { topic: string; bullets: string[] }): PlaybookConfig {
  const authoredModule: AuthoredModule = {
    id: "part2",
    slug: "part2",
    title: "Part 2 — Long-turn cue cards",
    mode: "examiner",
    settings: {
      cueCardPool: [card],
    },
  } as unknown as AuthoredModule;
  return { modules: [authoredModule] } as unknown as PlaybookConfig;
}

function buildSharedState(): AssembledContext["sharedState"] {
  return {
    lockedModule: { id: "part2", slug: "part2" },
    callNumber: 1,
  } as unknown as AssembledContext["sharedState"];
}

describe("resolveModuleCueCard", () => {
  describe("UX-A — pinned-visual prompt clarity (audit Finding 1)", () => {
    it("directive declares the cue card is visible on the learner's screen", () => {
      // Without this signal the AI over-narrates ("Today your cue card is…").
      // The literal phrase is pinned so a future refactor can't silently
      // drop it.
      const out = resolveModuleCueCard(
        buildConfig({
          topic: "A book you enjoyed reading",
          bullets: ["what it was about", "who wrote it", "why you enjoyed it"],
        }),
        buildSharedState(),
      );
      expect(out).not.toBeNull();
      expect(out!.directive).toContain("visible on the learner's screen");
    });

    it("directive still carries the topic + bullets so the AI can anchor to them", () => {
      const out = resolveModuleCueCard(
        buildConfig({
          topic: "A time you felt proud",
          bullets: ["what happened", "who was there", "why it mattered"],
        }),
        buildSharedState(),
      );
      expect(out).not.toBeNull();
      expect(out!.directive).toContain("A time you felt proud");
      expect(out!.directive).toContain("what happened");
      expect(out!.directive).toContain("who was there");
      expect(out!.directive).toContain("why it mattered");
    });

    it("directive does NOT leak internal labels (criterion names, parameter ids)", () => {
      // Defensive pin sibling to `learner-ui-leak-coverage.test.ts`.
      // The cue-card pool carries learner-safe topic + bullets only —
      // confirm the directive does not splice in any internal taxonomy.
      const out = resolveModuleCueCard(
        buildConfig({
          topic: "A skill you learned",
          bullets: ["what skill", "how you learned it", "how you use it"],
        }),
        buildSharedState(),
      );
      expect(out).not.toBeNull();
      expect(out!.directive).not.toMatch(/Lexical Resource/);
      expect(out!.directive).not.toMatch(/Fluency and Coherence/);
      expect(out!.directive).not.toMatch(/Grammatical Range/);
      expect(out!.directive).not.toMatch(/skill_/);
    });
  });
});
