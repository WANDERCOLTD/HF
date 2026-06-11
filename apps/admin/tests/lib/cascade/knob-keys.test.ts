/**
 * Pins the LISTED_KNOBS catalogue against the live cascade dispatch.
 * Every entry in `lib/cascade/knob-keys.ts::LISTED_KNOBS` MUST be
 * accepted by `lib/cascade/effective-value.ts::isResolvableKnob`,
 * otherwise the demo-knobs.json generator emits a knob the inspector
 * tray would 500 on. Failing this test means someone added an entry
 * without registering its family in FAMILIES, or vice versa.
 */

import { describe, it, expect } from "vitest";

import { LISTED_KNOBS } from "@/lib/cascade/knob-keys";
import { isResolvableKnob } from "@/lib/cascade/effective-value";

describe("LISTED_KNOBS ↔ isResolvableKnob invariant", () => {
  it.each(LISTED_KNOBS.map((k) => [k.knobKey, k.family]))(
    "%s (family=%s) is resolvable",
    (knobKey) => {
      expect(isResolvableKnob(knobKey)).toBe(true);
    },
  );

  it("every listed family is one of the five live families", () => {
    const allowed = new Set([
      "behavior-target",
      "welcome-message",
      "session-flow",
      "voice-config",
      "identity-spec",
    ]);
    for (const knob of LISTED_KNOBS) {
      expect(allowed.has(knob.family)).toBe(true);
    }
  });

  it("at least 4 demo-preset knobs are marked demoKnob:true", () => {
    const demoCount = LISTED_KNOBS.filter((k) => k.demoKnob).length;
    expect(demoCount).toBeGreaterThanOrEqual(4);
  });

  it("welcomeMessage and BEH-RESPONSE-LEN are demo-preset (the core OCEAN tune)", () => {
    const map = new Map(LISTED_KNOBS.map((k) => [k.knobKey, k]));
    expect(map.get("welcomeMessage")?.demoKnob).toBe(true);
    expect(map.get("BEH-RESPONSE-LEN")?.demoKnob).toBe(true);
  });
});
