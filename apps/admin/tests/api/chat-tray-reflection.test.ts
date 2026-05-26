/**
 * Tests for the bidirectional reflection parser + formatter (#873
 * follow-up). The chat route receives a `trayReflections` array from
 * the client and converts each into a synthetic user-role message that
 * the AI sees in conversation history.
 */

import { describe, it, expect } from "vitest";
import {
  parseTrayReflections,
  formatTrayReflection,
  buildReflectionMessages,
  type TrayReflection,
} from "@/app/api/chat/tray-reflection";

const validApplied = {
  action: "applied",
  entries: [
    {
      label: "TOL-MASTERY-THRESHOLD",
      scopeLabel: "Learner override",
      beforeValue: "0.7",
      afterValue: "0.55",
    },
  ],
  toggleCaller: true,
  toggleAll: false,
  callerInContext: "Brynn Moreau",
  decidedAt: "2026-05-26T14:42:44Z",
};

const validDiscarded = {
  action: "discarded",
  entries: [
    {
      label: "BEH-PRACTICE-EXERCISES",
      scopeLabel: "Learner override",
      beforeValue: "0.73",
      afterValue: "0.5",
    },
  ],
  callerInContext: "Brynn Moreau",
  decidedAt: "2026-05-26T14:43:00Z",
};

describe("parseTrayReflections", () => {
  it("accepts a valid applied reflection", () => {
    const result = parseTrayReflections([validApplied]);
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("applied");
    expect(result[0].entries).toHaveLength(1);
    expect(result[0].toggleCaller).toBe(true);
    expect(result[0].callerInContext).toBe("Brynn Moreau");
  });

  it("accepts a valid discarded reflection", () => {
    const result = parseTrayReflections([validDiscarded]);
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("discarded");
  });

  it("returns empty array for non-array input", () => {
    expect(parseTrayReflections(null)).toEqual([]);
    expect(parseTrayReflections(undefined)).toEqual([]);
    expect(parseTrayReflections("string")).toEqual([]);
    expect(parseTrayReflections({})).toEqual([]);
  });

  it("drops items with invalid action", () => {
    const bad = [{ ...validApplied, action: "bogus" }];
    expect(parseTrayReflections(bad)).toEqual([]);
  });

  it("drops items with non-array entries", () => {
    const bad = [{ ...validApplied, entries: "not-array" }];
    expect(parseTrayReflections(bad)).toEqual([]);
  });

  it("drops entries with missing string fields", () => {
    const bad = [
      {
        action: "applied",
        entries: [{ label: "L" /* missing scopeLabel/before/after */ }],
      },
    ];
    expect(parseTrayReflections(bad)).toEqual([]);
  });

  it("drops items with zero valid entries", () => {
    const bad = [{ action: "applied", entries: [] }];
    expect(parseTrayReflections(bad)).toEqual([]);
  });

  it("preserves multiple valid items in order", () => {
    const result = parseTrayReflections([validApplied, validDiscarded]);
    expect(result).toHaveLength(2);
    expect(result[0].action).toBe("applied");
    expect(result[1].action).toBe("discarded");
  });

  it("defaults optional toggles to undefined when omitted", () => {
    const minimal = {
      action: "discarded",
      entries: [validApplied.entries[0]],
    };
    const result = parseTrayReflections([minimal]);
    expect(result[0].toggleCaller).toBeUndefined();
    expect(result[0].toggleAll).toBeUndefined();
  });
});

describe("formatTrayReflection", () => {
  it("formats an applied reflection with recompose flags", () => {
    const parsed = parseTrayReflections([validApplied])[0];
    const text = formatTrayReflection(parsed);
    expect(text).toMatch(/\[tray\] User applied 1 pending change/);
    expect(text).toMatch(/Learner override · TOL-MASTERY-THRESHOLD: 0\.7 → 0\.55/);
    expect(text).toMatch(/recomposed Brynn Moreau/);
  });

  it("formats applied with neither toggle as lazy-recompose", () => {
    const parsed = parseTrayReflections([
      { ...validApplied, toggleCaller: false, toggleAll: false },
    ])[0];
    const text = formatTrayReflection(parsed);
    expect(text).toMatch(/no immediate recompose/);
  });

  it("formats applied with cohort fanout", () => {
    const parsed = parseTrayReflections([
      { ...validApplied, toggleCaller: false, toggleAll: true },
    ])[0];
    const text = formatTrayReflection(parsed);
    expect(text).toMatch(/recomposed cohort/);
  });

  it("formats a discarded reflection without toggle line", () => {
    const parsed = parseTrayReflections([validDiscarded])[0];
    const text = formatTrayReflection(parsed);
    expect(text).toMatch(/\[tray\] User discarded 1 pending change/);
    expect(text).not.toMatch(/Toggles:/);
    expect(text).not.toMatch(/recomposed/);
  });

  it("pluralises entry count correctly", () => {
    const multi: TrayReflection = {
      action: "applied",
      entries: [validApplied.entries[0], validApplied.entries[0]],
      toggleCaller: false,
      toggleAll: false,
    };
    const text = formatTrayReflection(multi);
    expect(text).toMatch(/2 pending changes/);
  });
});

describe("buildReflectionMessages", () => {
  it("returns one user-role message per reflection", () => {
    const reflections = parseTrayReflections([validApplied, validDiscarded]);
    const msgs = buildReflectionMessages(reflections);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].role).toBe("user");
    expect(msgs[0].content).toMatch(/applied/);
    expect(msgs[1].content).toMatch(/discarded/);
  });

  it("returns an empty array for no reflections", () => {
    expect(buildReflectionMessages([])).toEqual([]);
  });
});
