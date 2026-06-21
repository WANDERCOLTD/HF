/**
 * Behavioural tests for `lib/prompt/composition/transforms/session-focus.ts`
 * (#2145 Phase A — Generic SessionFocus 4th-layer substrate, S2).
 *
 * Pins:
 *   - Returns null when no `session_focus:next_*` CallerAttribute row exists
 *     (HONEST EMPTY STATE — per
 *     ~/.claude/projects/-Users-paulwander-projects-HF/memory/feedback_no_hardcoded_score_backfill.md
 *     the transform MUST NOT hardcode a fallback when no projection has fired).
 *   - Returns null when no module is locked (continuous mode).
 *   - Returns null when the CallerAttribute row exists but `stringValue` is empty.
 *   - Returns a directive + PinnedCardContent when the row exists.
 *   - The directive uses the LEARNER-facing label (NOT the internal source
 *     parameter id, slug, or criterion name).
 *   - The pinnedCard.focusArea echoes the projected label.
 *   - The lookup key matches `session_focus:next_{moduleSlug}` shape.
 */

import { describe, it, expect } from "vitest";
import {
  resolveSessionFocus,
  sessionFocusKeyFor,
  SESSION_FOCUS_KEY_PREFIX,
} from "@/lib/prompt/composition/transforms/session-focus";
import type {
  AssembledContext,
  CallerAttributeData,
} from "@/lib/prompt/composition/types";
import type { PlaybookConfig } from "@/lib/types/json-fields";

function buildContext(args: {
  lockedModule: { id?: string | null; slug?: string | null } | null;
  callerAttributes: Array<Partial<CallerAttributeData>>;
}): AssembledContext {
  const fullAttrs: CallerAttributeData[] = args.callerAttributes.map((a) => ({
    key: a.key ?? "",
    scope: a.scope ?? "test",
    domain: a.domain ?? null,
    valueType: a.valueType ?? "STRING",
    stringValue: a.stringValue ?? null,
    numberValue: a.numberValue ?? null,
    booleanValue: a.booleanValue ?? null,
    jsonValue: a.jsonValue ?? null,
    confidence: a.confidence ?? null,
    sourceSpecSlug: a.sourceSpecSlug ?? null,
  }));
  return {
    loadedData: {
      callerAttributes: fullAttrs,
      playbooks: [{ config: {} }],
    },
    sharedState: {
      lockedModule: args.lockedModule,
    },
  } as unknown as AssembledContext;
}

const EMPTY_CONFIG: PlaybookConfig = {} as PlaybookConfig;

describe("resolveSessionFocus", () => {
  describe("key shape", () => {
    it("sessionFocusKeyFor composes the canonical key", () => {
      expect(sessionFocusKeyFor("part3")).toBe("session_focus:next_part3");
      expect(sessionFocusKeyFor("ielts_p3")).toBe(
        "session_focus:next_ielts_p3",
      );
    });

    it("SESSION_FOCUS_KEY_PREFIX is exported and matches the writer convention", () => {
      expect(SESSION_FOCUS_KEY_PREFIX).toBe("session_focus:next_");
    });
  });

  describe("honest empty state — no hardcoded defaults", () => {
    it("returns null when no module is locked (continuous mode)", () => {
      const out = resolveSessionFocus(
        EMPTY_CONFIG,
        buildContext({ lockedModule: null, callerAttributes: [] }),
      );
      expect(out).toBeNull();
    });

    it("returns null when no CallerAttribute row exists for the locked module", () => {
      const out = resolveSessionFocus(
        EMPTY_CONFIG,
        buildContext({
          lockedModule: { id: "part3", slug: "part3" },
          callerAttributes: [],
        }),
      );
      expect(out).toBeNull();
    });

    it("returns null when the CallerAttribute row exists but stringValue is empty", () => {
      const out = resolveSessionFocus(
        EMPTY_CONFIG,
        buildContext({
          lockedModule: { id: "part3", slug: "part3" },
          callerAttributes: [
            {
              key: "session_focus:next_part3",
              stringValue: "   ",
            },
          ],
        }),
      );
      expect(out).toBeNull();
    });

    it("returns null when locked module has no slug or id", () => {
      const out = resolveSessionFocus(
        EMPTY_CONFIG,
        buildContext({
          lockedModule: { id: null, slug: null },
          callerAttributes: [
            {
              key: "session_focus:next_",
              stringValue: "giving reasons",
            },
          ],
        }),
      );
      expect(out).toBeNull();
    });
  });

  describe("emits directive + pinned card from projected label", () => {
    it("emits the directive when the CallerAttribute row is present", () => {
      const out = resolveSessionFocus(
        EMPTY_CONFIG,
        buildContext({
          lockedModule: { id: "part3", slug: "part3" },
          callerAttributes: [
            {
              key: "session_focus:next_part3",
              stringValue: "giving reasons",
            },
          ],
        }),
      );
      expect(out).not.toBeNull();
      expect(out!.label).toBe("giving reasons");
      expect(out!.moduleSlug).toBe("part3");
      expect(out!.directive).toContain("giving reasons");
      expect(out!.directive.length).toBeGreaterThan(50);
    });

    it("uses the LEARNER-facing label, NOT internal source parameter ids/slugs", () => {
      // The whole point of this substrate: the transform reads ONLY the
      // projected learner-safe label. Internal scoring parameter ids
      // (e.g. `skill_lexical_resource_lr`) and criterion names (e.g.
      // `Lexical Resource`) MUST NOT appear in either the directive or
      // the pinned card.
      const out = resolveSessionFocus(
        EMPTY_CONFIG,
        buildContext({
          lockedModule: { id: "part3", slug: "part3" },
          callerAttributes: [
            {
              key: "session_focus:next_part3",
              stringValue: "structuring an argument",
            },
          ],
        }),
      );
      expect(out).not.toBeNull();
      expect(out!.label).toBe("structuring an argument");
      // Negative assertions — these MUST NOT appear because the runner
      // already projected internal → external before writing the row.
      expect(out!.directive).not.toContain("skill_");
      expect(out!.directive).not.toContain("Lexical Resource");
      expect(out!.directive).not.toContain("Fluency and Coherence");
      expect(out!.directive).not.toContain("Pronunciation");
      expect(out!.directive).not.toContain("Grammatical Range");
      expect(out!.pinnedCard?.focusArea).toBe("structuring an argument");
    });

    it("populates a PinnedCardContent of kind=topicFocus", () => {
      const out = resolveSessionFocus(
        EMPTY_CONFIG,
        buildContext({
          lockedModule: { id: "part3", slug: "part3" },
          callerAttributes: [
            {
              key: "session_focus:next_part3",
              stringValue: "handling a challenge",
            },
          ],
        }),
      );
      expect(out!.pinnedCard).not.toBeNull();
      expect(out!.pinnedCard!.kind).toBe("topicFocus");
      expect(out!.pinnedCard!.focusArea).toBe("handling a challenge");
    });

    it("ignores CallerAttribute rows for OTHER module slugs", () => {
      const out = resolveSessionFocus(
        EMPTY_CONFIG,
        buildContext({
          lockedModule: { id: "part3", slug: "part3" },
          callerAttributes: [
            // Different module — should NOT match
            {
              key: "session_focus:next_part1",
              stringValue: "expanding an answer",
            },
            // Different attribute family entirely — should NOT match
            {
              key: "lo_mastery:part3:lo-1",
              stringValue: "0.5",
            },
          ],
        }),
      );
      expect(out).toBeNull();
    });

    it("prefers slug over id for the key suffix", () => {
      const out = resolveSessionFocus(
        EMPTY_CONFIG,
        buildContext({
          lockedModule: { id: "module-uuid-123", slug: "part3" },
          callerAttributes: [
            {
              key: "session_focus:next_part3",
              stringValue: "expanding an answer",
            },
          ],
        }),
      );
      expect(out).not.toBeNull();
      expect(out!.moduleSlug).toBe("part3");
    });
  });
});
