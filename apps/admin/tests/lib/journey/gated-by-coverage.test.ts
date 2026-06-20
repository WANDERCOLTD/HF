/**
 * gated-by-coverage — Slice 5 of the Journey grey-out epic.
 *
 * Coverage-pillar test that validates every `gatedBy` declaration on
 * a `JourneySettingContract` is internally consistent:
 *
 *   1. parentId resolves to an existing contract in the same registry
 *      (no typos, no references to deleted parents).
 *   2. inactiveValues is non-empty (an empty array would gate the
 *      control off forever, which is bug-shaped).
 *   3. For toggle parents, inactiveValues only contains booleans.
 *   4. For select parents, every inactiveValues entry matches one of
 *      the parent's declared options (no orphan / typo values that
 *      would silently never gate).
 *
 * Born of the Slice 1 sweep (PR #journey-grey-out). 18 contracts
 * declared gatedBy in that PR; this test pins them.
 *
 * Companion rule: `.claude/rules/journey-grey-out-coverage.md`.
 */

import { describe, expect, it } from "vitest";

import {
  JOURNEY_SETTINGS,
  JOURNEY_SETTINGS_BY_ID,
} from "@/lib/journey/setting-contracts.entries";

describe("journey-grey-out — gatedBy coverage", () => {
  const settingsWithGate = JOURNEY_SETTINGS.filter((s) => s.gatedBy);

  it("at least one contract declares a gatedBy (sanity)", () => {
    expect(settingsWithGate.length).toBeGreaterThan(0);
  });

  it("every gatedBy.parentId resolves to a real contract", () => {
    const missing = settingsWithGate
      .filter((s) => !JOURNEY_SETTINGS_BY_ID[s.gatedBy!.parentId])
      .map((s) => `${s.id} → ${s.gatedBy!.parentId}`);
    expect(missing).toEqual([]);
  });

  it("every gatedBy.inactiveValues is non-empty", () => {
    const empty = settingsWithGate
      .filter((s) => s.gatedBy!.inactiveValues.length === 0)
      .map((s) => s.id);
    expect(empty).toEqual([]);
  });

  it("toggle-parent gates use only boolean inactiveValues", () => {
    const offenders: string[] = [];
    for (const s of settingsWithGate) {
      const parent = JOURNEY_SETTINGS_BY_ID[s.gatedBy!.parentId];
      if (parent?.control !== "toggle") continue;
      for (const v of s.gatedBy!.inactiveValues) {
        if (typeof v !== "boolean") {
          offenders.push(`${s.id} (parent ${parent.id} is a toggle but inactiveValue ${JSON.stringify(v)} is not boolean)`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("select-parent gates only use values from the parent's options[]", () => {
    const offenders: string[] = [];
    for (const s of settingsWithGate) {
      const parent = JOURNEY_SETTINGS_BY_ID[s.gatedBy!.parentId];
      if (parent?.control !== "select") continue;
      const allowed = new Set(parent.options?.map((o) => o.value) ?? []);
      for (const v of s.gatedBy!.inactiveValues) {
        if (!allowed.has(v as string)) {
          offenders.push(`${s.id} → parent ${parent.id} (value ${JSON.stringify(v)} not in options [${[...allowed].join(", ")}])`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no contract gates itself", () => {
    const selfGates = settingsWithGate
      .filter((s) => s.gatedBy!.parentId === s.id)
      .map((s) => s.id);
    expect(selfGates).toEqual([]);
  });
});
